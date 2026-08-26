// lib/tiny.ts
//
// Cliente para a API v2 do Tiny ERP (token único por conta, não OAuth v3) e o motor de
// sincronização de CMV por empresa.
//
// AVISO: o formato exato dos endpoints (`produtos.pesquisa.php`, `produto.obter.php`) e
// dos campos de resposta (em especial `preco_custo`) segue a documentação pública e
// historicamente estável da API v2, mas não pôde ser verificado contra uma conta real
// neste ambiente (rede sem acesso a tiny.com.br). `extractCostFromTinyProduto` é o único
// ponto a ajustar caso o campo real tenha outro nome.
import { prisma } from "@/lib/prisma";

const TINY_BASE = "https://api.tiny.com.br/api2";
const PACING_MS = 350; // intervalo entre chamadas ao Tiny, para não estourar limite de taxa

export type TinySyncError = { sku: string; message: string };

export type TinySyncBatchResult = {
  processed: number;
  total: number;
  updated: number;
  errors: TinySyncError[];
  done: boolean;
};

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// O Tiny v2 é inconsistente quanto a number vs string nos campos numéricos.
function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

type TinyProdutoResumo = { id?: string | number; codigo?: string; nome?: string };
type TinyProdutoDetalhe = TinyProdutoResumo & { preco_custo?: string | number };

type TinyPesquisaResponse = {
  retorno?: { status?: string; produtos?: { produto?: TinyProdutoResumo }[] };
};

type TinyObterResponse = {
  retorno?: { status?: string; produto?: TinyProdutoDetalhe };
};

/**
 * Busca o id interno do Tiny para um SKU. A busca (`pesquisa`) do Tiny é textual/fuzzy,
 * então o resultado é filtrado por código exato (case-insensitive) antes de aceitar.
 */
export async function tinySearchProdutoBySku(token: string, sku: string): Promise<{ id: string } | null> {
  const url = `${TINY_BASE}/produtos.pesquisa.php?token=${encodeURIComponent(token)}&formato=json&pesquisa=${encodeURIComponent(sku)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tiny respondeu ${res.status} ao pesquisar SKU ${sku}`);
  const json = (await res.json()) as TinyPesquisaResponse;
  if (json.retorno?.status !== "OK") return null;

  const skuNorm = sku.trim().toUpperCase();
  const match = (json.retorno.produtos ?? [])
    .map((p) => p.produto)
    .find((p) => (p?.codigo ?? "").trim().toUpperCase() === skuNorm);

  return match?.id !== undefined ? { id: String(match.id) } : null;
}

/** Único ponto a ajustar se o campo de custo real do Tiny tiver outro nome. */
export function extractCostFromTinyProduto(produto: TinyProdutoDetalhe | undefined | null): number | null {
  return toNumber(produto?.preco_custo);
}

export async function tinyObterProduto(token: string, id: string): Promise<{ cmv: number | null; nome: string | null } | null> {
  const url = `${TINY_BASE}/produto.obter.php?token=${encodeURIComponent(token)}&formato=json&id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tiny respondeu ${res.status} ao obter produto ${id}`);
  const json = (await res.json()) as TinyObterResponse;
  if (json.retorno?.status !== "OK" || !json.retorno.produto) return null;

  return {
    cmv: extractCostFromTinyProduto(json.retorno.produto),
    nome: json.retorno.produto.nome?.trim() || null,
  };
}

export async function fetchTinyCostBySku(token: string, sku: string): Promise<{ cmv: number; nome: string | null } | null> {
  const found = await tinySearchProdutoBySku(token, sku);
  if (!found) return null;
  const detail = await tinyObterProduto(token, found.id);
  if (!detail || detail.cmv === null || detail.cmv <= 0) return null;
  return { cmv: detail.cmv, nome: detail.nome };
}

/**
 * Processa produtos de uma empresa dentro de um orçamento de tempo (`budgetMs`),
 * pedindo o custo mais recente ao Tiny SKU a SKU. Ordena pelos produtos há mais tempo
 * sem sincronizar primeiro, para que chamadas repetidas (botão manual várias vezes, ou
 * o cron semanal seguinte) progridam pelo catálogo inteiro mesmo que uma única execução
 * não dê conta de tudo — por isso o orçamento é de TEMPO, não de quantidade fixa de
 * SKUs: fica seguro em qualquer limite de duração de função serverless.
 */
export async function runTinySyncBatch(empresaId: string, opts: { budgetMs: number }): Promise<TinySyncBatchResult> {
  const empresa = await prisma.markupRuleset.findUnique({ where: { id: empresaId } });
  if (!empresa?.tinyApiToken) {
    throw new Error("Empresa sem token da API do Tiny configurado");
  }
  const token = empresa.tinyApiToken;

  const total = await prisma.product.count({ where: { empresaId, deletedAt: null } });
  const products = await prisma.product.findMany({
    where: { empresaId, deletedAt: null },
    orderBy: { updatedAt: "asc" },
    take: 500, // teto de segurança; o corte real de cada chamada é por tempo (budgetMs)
  });

  const start = Date.now();
  let processed = 0;
  let updated = 0;
  const errors: TinySyncError[] = [];

  for (const product of products) {
    if (Date.now() - start > opts.budgetMs) break;

    try {
      const result = await fetchTinyCostBySku(token, product.sku);
      if (result) {
        await prisma.product.update({
          where: { id: product.id },
          data: { cmv: result.cmv, name: result.nome ?? product.name, updatedAt: new Date() },
        });
        updated++;
      }
    } catch (err) {
      errors.push({ sku: product.sku, message: err instanceof Error ? err.message : String(err) });
    }

    processed++;
    if (processed < products.length) await sleep(PACING_MS);
  }

  const done = processed === products.length && products.length >= total;
  if (done) {
    await prisma.markupRuleset.update({ where: { id: empresaId }, data: { tinyLastSyncAt: new Date() } });
  }

  return { processed, total, updated, errors, done };
}
