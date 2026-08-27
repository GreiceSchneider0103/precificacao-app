// lib/tiny.ts
//
// Cliente para a API v2 do Tiny ERP (token único por conta, não OAuth v3) e o motor de
// sincronização de CMV por empresa.
//
// AVISO: o formato exato dos endpoints (`produtos.pesquisa.php`, `produto.obter.php`) e
// dos campos de resposta segue a documentação pública e historicamente estável da API
// v2, mas não pôde ser verificado contra uma conta real neste ambiente (rede sem acesso
// a tiny.com.br). `extractCostFromTinyProduto` é o único ponto a ajustar caso os campos
// reais tenham outro nome — hoje tenta `preco_custo_medio` (Custo médio, como aparece na
// tela do Tiny) antes de `preco_custo`.
import { prisma } from "@/lib/prisma";

const TINY_BASE = "https://api.tiny.com.br/api2";
const PACING_MS = 700; // intervalo entre chamadas ao Tiny, para não estourar limite de taxa
const MAX_RATE_LIMIT_RETRIES = 3;

// Erro específico para respostas de limite de requisições do Tiny (HTTP 429 ou texto do
// tipo "limite de requisições excedido"), tratado com retry/backoff em vez de falha
// definitiva — diferente de um erro real de SKU/token, que não se resolve tentando de novo.
export class TinyRateLimitError extends Error {}

const RATE_LIMIT_PATTERN = /limite de requisi|muitas requisi|too many requests|rate limit|excedeu o limite/i;

// Bloqueio "duro" de acessos do Tiny (cota da API excedida) — mensagem real observada:
// "API Bloqueada - Excedido o número de acessos a API, aguarde alguns minutos e tente
// novamente". Diferente de um 429 pontual, aqui TODAS as chamadas seguintes falham do
// mesmo jeito por alguns minutos: insistir com retry curto só desperdiça tentativas (foi
// o que aconteceu quando ~250 SKUs falharam de uma vez, todos com esse mesmo motivo).
// Por isso não tenta de novo — aborta a rodada inteira na hora e deixa a próxima chamada
// (o botão manual esperando mais tempo, ou o próximo elo da corrente do cron) continuar.
export class TinyApiBlockedError extends Error {}

const API_BLOCKED_PATTERN = /api bloqueada|excedido o n.mero de acessos|aguarde alguns minutos/i;

export type TinySyncError = { sku: string; message: string };

export type TinySyncBatchResult = {
  processed: number;
  total: number;
  updated: number;
  errors: TinySyncError[];
  done: boolean;
  // true = parou cedo porque o Tiny bloqueou o acesso à API (precisa esperar alguns
  // minutos); diferente de `done: false` por orçamento de tempo esgotado normalmente.
  blocked: boolean;
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
type TinyProdutoDetalhe = TinyProdutoResumo & {
  preco_custo?: string | number;
  preco_custo_medio?: string | number;
};

type TinyRetornoBase = { status?: string; erros?: { erro?: string }[] };

type TinyPesquisaResponse = {
  retorno?: TinyRetornoBase & { produtos?: { produto?: TinyProdutoResumo }[] };
};

type TinyObterResponse = {
  retorno?: TinyRetornoBase & { produto?: TinyProdutoDetalhe };
};

// Tiny normalmente detalha o motivo em retorno.erros quando status != "OK" (token
// inválido, sem permissão, parâmetro errado etc.) — expõe isso em vez de tratar como
// "SKU não encontrado", que é um caso bem diferente (e não deveria acontecer para TODOS
// os SKUs de uma vez, ao contrário de um problema de token/permissão).
function tinyErrorMessage(retorno: TinyRetornoBase | undefined, fallback: string): string {
  const erros = (retorno?.erros ?? []).map((e) => e.erro).filter((e): e is string => !!e);
  return erros.length > 0 ? erros.join("; ") : fallback;
}

/**
 * Busca o id interno do Tiny para um SKU. A busca (`pesquisa`) do Tiny é textual/fuzzy,
 * então o resultado é filtrado por código exato (case-insensitive) antes de aceitar.
 */
export async function tinySearchProdutoBySku(token: string, sku: string): Promise<{ id: string } | null> {
  const url = `${TINY_BASE}/produtos.pesquisa.php?token=${encodeURIComponent(token)}&formato=json&pesquisa=${encodeURIComponent(sku)}`;
  const res = await fetch(url);
  if (res.status === 429) throw new TinyRateLimitError(`Tiny limitou as requisições ao pesquisar SKU ${sku} (HTTP 429)`);
  if (!res.ok) throw new Error(`Tiny respondeu ${res.status} ao pesquisar SKU ${sku}`);
  const json = (await res.json()) as TinyPesquisaResponse;
  if (json.retorno?.status !== "OK") {
    const message = tinyErrorMessage(json.retorno, `Tiny recusou a pesquisa do SKU ${sku} (verifique o token)`);
    if (API_BLOCKED_PATTERN.test(message)) throw new TinyApiBlockedError(message);
    if (RATE_LIMIT_PATTERN.test(message)) throw new TinyRateLimitError(message);
    throw new Error(message);
  }

  const skuNorm = sku.trim().toUpperCase();
  const match = (json.retorno.produtos ?? [])
    .map((p) => p.produto)
    .find((p) => (p?.codigo ?? "").trim().toUpperCase() === skuNorm);

  return match?.id !== undefined ? { id: String(match.id) } : null;
}

/**
 * Único ponto a ajustar se os campos de custo reais do Tiny tiverem outro nome.
 * Prioriza "Custo médio" (preco_custo_medio) — é o que a tela do Tiny mostra por padrão
 * e vem preenchido a partir do histórico de entradas — caindo para preco_custo se ausente.
 */
export function extractCostFromTinyProduto(produto: TinyProdutoDetalhe | undefined | null): number | null {
  const medio = toNumber(produto?.preco_custo_medio);
  if (medio !== null && medio > 0) return medio;
  return toNumber(produto?.preco_custo);
}

export async function tinyObterProduto(token: string, id: string): Promise<{ cmv: number | null; nome: string | null } | null> {
  const url = `${TINY_BASE}/produto.obter.php?token=${encodeURIComponent(token)}&formato=json&id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  if (res.status === 429) throw new TinyRateLimitError(`Tiny limitou as requisições ao obter o produto ${id} (HTTP 429)`);
  if (!res.ok) throw new Error(`Tiny respondeu ${res.status} ao obter produto ${id}`);
  const json = (await res.json()) as TinyObterResponse;
  if (json.retorno?.status !== "OK") {
    const message = tinyErrorMessage(json.retorno, `Tiny recusou ao obter o produto ${id} (verifique o token)`);
    if (API_BLOCKED_PATTERN.test(message)) throw new TinyApiBlockedError(message);
    if (RATE_LIMIT_PATTERN.test(message)) throw new TinyRateLimitError(message);
    throw new Error(message);
  }
  if (!json.retorno.produto) return null;

  return {
    cmv: extractCostFromTinyProduto(json.retorno.produto),
    nome: json.retorno.produto.nome?.trim() || null,
  };
}

export type TinyFetchCostResult =
  | { ok: true; cmv: number; nome: string | null }
  | { ok: false; reason: "not_found" | "no_cost" };

export async function fetchTinyCostBySku(token: string, sku: string): Promise<TinyFetchCostResult> {
  const found = await tinySearchProdutoBySku(token, sku);
  if (!found) return { ok: false, reason: "not_found" };
  const detail = await tinyObterProduto(token, found.id);
  if (!detail || detail.cmv === null || detail.cmv <= 0) return { ok: false, reason: "no_cost" };
  return { ok: true, cmv: detail.cmv, nome: detail.nome };
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
  let blocked = false;
  const errors: TinySyncError[] = [];

  for (const product of products) {
    if (Date.now() - start > opts.budgetMs) break;

    // Limite de requisições do Tiny (HTTP 429 ou texto "limite excedido") é transitório —
    // tenta de novo com backoff crescente antes de desistir, em vez de marcar como erro
    // definitivo do SKU. Já um bloqueio "duro" (TinyApiBlockedError) não se resolve em
    // segundos — não insiste, aborta a rodada inteira (ver comentário na definição da
    // classe acima).
    let result: TinyFetchCostResult | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
      try {
        result = await fetchTinyCostBySku(token, product.sku);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        if (err instanceof TinyApiBlockedError) break;
        if (!(err instanceof TinyRateLimitError) || attempt === MAX_RATE_LIMIT_RETRIES) break;
        await sleep(PACING_MS * (attempt + 2));
      }
    }

    if (lastError instanceof TinyApiBlockedError) {
      blocked = true;
      errors.push({ sku: product.sku, message: lastError.message });
      // Não avança o updatedAt: este SKU nem chegou a ser tentado de verdade (foi
      // recusado de cara pelo bloqueio), então continua sendo o primeiro da fila quando
      // a sincronização for retomada.
      break;
    }

    if (lastError) {
      // Mesmo em erro, avança o updatedAt: senão este SKU some da "frente da fila"
      // (ordenação por mais antigo) e trava a rodada seguinte tentando ele de novo antes
      // de qualquer outro produto pendente.
      await prisma.product.update({ where: { id: product.id }, data: { updatedAt: new Date() } });
      errors.push({ sku: product.sku, message: lastError instanceof Error ? lastError.message : String(lastError) });
    } else if (result?.ok) {
      await prisma.product.update({
        where: { id: product.id },
        data: { cmv: result.cmv, name: result.nome ?? product.name, updatedAt: new Date() },
      });
      updated++;
    } else if (result) {
      await prisma.product.update({ where: { id: product.id }, data: { updatedAt: new Date() } });
      errors.push({
        sku: product.sku,
        message: result.reason === "not_found" ? "SKU não encontrado no Tiny" : "Tiny não retornou um custo válido para este SKU",
      });
    }

    processed++;
    if (processed < products.length) await sleep(PACING_MS);
  }

  const done = !blocked && processed === products.length && products.length >= total;
  if (done) {
    await prisma.markupRuleset.update({ where: { id: empresaId }, data: { tinyLastSyncAt: new Date() } });
  }

  return { processed, total, updated, errors, done, blocked };
}
