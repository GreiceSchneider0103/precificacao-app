"use client";

import * as XLSX from "xlsx";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  type ChannelKey,
  type Regime,
  type MoneyMode,
  type Settings,
  parseNumberPt,
  fmtPt,
  solvePOR,
  solveWithShopeeTiered,
} from "../../lib/pricing";

type Product = {
  sku: string;
  name: string;
  cmv: number;
  mlb?: string | null;
  updatedAt: string;
};

type PromoRow = {
  id: string;

  // ====== COLUNAS MELI (armazenadas, não exibidas) ======
  tituloAnuncio: string;
  numeroAnuncio: string;
  skuPlanilha: string;
  precoOriginal: number;
  reducaoTarifas: number;
  descontoTotal: number;
  precoFinalMarketplace: number; // preço final do MELI (proposto/sugerido)
  statusPromocao: string;
  acaoAnuncio: string;

  // ====== LIGAÇÃO COM BASE PRODUTOS ======
  sku: string;
  mlb: string;
  cmv: number;
  frete: number;

  // ====== INPUTS "TEXTO" (para destravar edição) ======
  cmvTxt?: string;
  freteTxt?: string;
  cupomValueTxt?: string;
  rebateValueTxt?: string;

  // ====== CONTROLES ======
  cupomMode: MoneyMode;
  cupomValue: number;

  rebateMode: MoneyMode;
  rebateValue: number;

  // ====== CALCULADOS ======
  precoDe: number;
  precoPagoAlvo: number; // preço final pro cliente (após desconto/cupom)
  precoPublicado: number; // preço para publicar (antes do desconto/cupom)
  margemPct: number;
  abaixoDaMeta: boolean;

  // ====== COMPARAÇÃO ======
  precoProposto: number; // MELI "Preço final"
};

const STORAGE_RULESETS = "markup_settings_rulesets_v1";
const STORAGE_PROMOS = "markup_promocoes_v1";
const STORAGE_PRODUCTS = "markup_products_v1";

// ✅ Histórico (rascunhos)
const STORAGE_PROMOS_HISTORY = "markup_promocoes_history_v1";

function normalizeSku(s: string) {
  return (s || "").trim().toUpperCase();
}
function normalizeMlb(s: string) {
  const v = (s || "").trim().toUpperCase();
  const m = v.match(/MLB\d+/i);
  if (m?.[0]) return m[0].toUpperCase();
  if (/^\d+$/.test(v)) return `MLB${v}`;
  return v || "";
}
function normKey(s: string) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}
function getCell(row: any, candidates: string[]) {
  // caso 1: row é objeto (sheet_to_json padrão)
  if (row && typeof row === "object" && !Array.isArray(row)) {
    const keys = Object.keys(row || {});
    for (const c of candidates) {
      const ck = normKey(c);
      const found = keys.find((k) => normKey(k) === ck);
      if (found != null) return row[found];
    }
    return undefined;
  }

  // caso 2: row é array: quem chama precisa usar map de header->index
  return undefined;
}

// ✅ Arredondamento para 2 casas decimais
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Cupom afeta o preço PARA PUBLICAR:
 * - Se cupom %: publicar = final / (1 - %)
 * - Se cupom R$: publicar = final + R$
 */
function calcPublicadoFromPago(pagoFinalCliente: number, cupomMode: MoneyMode, cupomValue: number) {
  if (pagoFinalCliente <= 0) return 0;
  if (cupomMode === "percent") {
    const p = Math.min(Math.max(cupomValue / 100, 0), 0.95);
    const denom = 1 - p;
    return denom <= 0.000001 ? 0 : pagoFinalCliente / denom;
  }
  return pagoFinalCliente + Math.max(0, cupomValue);
}

function pickPromocoesSheet(wb: XLSX.WorkBook) {
  const names = wb.SheetNames || [];
  if (!names.length) return names[0];

  const exact = names.find((n) => normKey(n) === normKey("Promoções") || normKey(n) === normKey("Promocoes"));
  if (exact) return exact;

  const contains = names.find((n) => normKey(n).includes("promoc"));
  if (contains) return contains;

  const firstNonAjuda = names.find((n) => normKey(n) !== normKey("ajuda"));
  return firstNonAjuda || names[0];
}

// ✅ AOA -> objetos usando header (depois de descartar 4 linhas)
function aoaToObjects(aoa: any[][]) {
  if (!aoa?.length) return [];
  const header = (aoa[0] || []).map((h) => String(h ?? "").trim());
  const out: any[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    // ignora linhas vazias
    if (!row.some((c: any) => String(c ?? "").trim() !== "")) continue;
    const obj: any = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = row[j] ?? "";
    out.push(obj);
  }
  return out;
}

function findHeaderRowIndex(rows: any[][]) {
  // procura uma linha que tenha "cara" de cabeçalho do MELI
  const required = [
    "titulo do anuncio",
    "numero do anuncio",
    "sku",
    "preco original",
    "preco final",
  ].map(normKey);

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const line = (rows[i] || []).map((c) => normKey(String(c ?? "")));
    const hits = required.filter((r) => line.some((v) => v.includes(r))).length;

    // 3+ hits já é um sinal forte de que é a linha correta
    if (hits >= 3) return i;
  }
  return -1;
}

function rowArrayToObject(row: any[], headers: string[]) {
  const obj: Record<string, any> = {};
  for (let i = 0; i < headers.length; i++) {
    obj[headers[i]] = row[i] ?? "";
  }
  return obj;
}

// ✅ Função para extrair números do Excel com segurança
function safeNumberFromExcel(value: any): number {
  if (value == null || value === "") return 0;
  
  // Se já for número, retorna direto
  if (typeof value === "number") return value;
  
  // Se for string, tenta converter
  const str = String(value).trim();
  if (!str) return 0;
  
  // Remove separadores de milhares e troca vírgula por ponto
  const normalized = str
    .replace(/\./g, "")  // remove pontos (separador de milhar)
    .replace(",", ".");   // troca vírgula por ponto
  
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}


export default function PromocoesClient() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

  // Critérios globais
  const [channel, setChannel] = useState<ChannelKey>("meli");
  const [regimeOverride, setRegimeOverride] = useState<"default" | Regime>("default");
  const [meliMode, setMeliMode] = useState<"classic" | "premium">("classic");
  const [magaluShipMode, setMagaluShipMode] = useState<"proprio" | "full">("proprio");

  const [margemEsperada, setMargemEsperada] = useState("20,00");
  const [fretePadrao, setFretePadrao] = useState("0,00");

  const [cupomModeAll, setCupomModeAll] = useState<MoneyMode>("fixed");
  const [cupomValueAll, setCupomValueAll] = useState("0");

  const [rebateModeAll, setRebateModeAll] = useState<MoneyMode>("fixed");
  const [rebateValueAll, setRebateValueAll] = useState("0");

  // (seguindo sua precificação)
  const markupBase = 4.3;
  const operMode: MoneyMode = "fixed";
  const adsMode: MoneyMode = "fixed";
  const operValue = 0;
  const adsValue = 0;

  const [rows, setRows] = useState<PromoRow[]>([]);
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  // ✅ Modal de adicionar manual
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSku, setManualSku] = useState("");
  const [manualMlb, setManualMlb] = useState("");
  const [manualCmv, setManualCmv] = useState("");
  const [manualFrete, setManualFrete] = useState("");
  const [manualCupom, setManualCupom] = useState(""); // R$
  const [manualProposto, setManualProposto] = useState(""); // preço proposto

  function showToast(type: "ok" | "err", text: string) {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 1800);
  }

  // Load settings + promos + produtos
  useEffect(() => {
    try {
      const rawS = localStorage.getItem(STORAGE_RULESETS);
      if (rawS) {
        const store = JSON.parse(rawS);
        const active = store?.ruleSets?.find((r: any) => r.id === store.activeRuleId) || store?.ruleSets?.[0];
        if (active) setSettings(active);
      }
    } catch {}

    try {
      const rawP = localStorage.getItem(STORAGE_PRODUCTS);
      if (rawP) {
        const parsed = JSON.parse(rawP) as any[];
        const next: Product[] = (parsed || []).map((p) => ({
          sku: normalizeSku(p.sku),
          name: String(p.name ?? "").trim(),
          cmv: Number(p.cmv ?? 0) || 0,
          mlb: p.mlb ? normalizeMlb(String(p.mlb)) : undefined,
          updatedAt: String(p.updatedAt ?? new Date().toISOString()),
        }));
        setProducts(next);
      }
    } catch {}

    try {
      const raw = localStorage.getItem(STORAGE_PROMOS);
      if (raw) setRows(JSON.parse(raw));
    } catch {}
  }, []);

  // Autosave promos (✅ garante que não perde ao trocar de aba)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PROMOS, JSON.stringify(rows));
    } catch {}
  }, [rows]);

  const effectiveRegime: Regime = useMemo(() => {
    if (!settings) return "normal";
    return regimeOverride === "default" ? settings.regime : regimeOverride;
  }, [settings, regimeOverride]);

  function resolveChannelRule() {
    if (!settings) return null;
    const baseCh = settings.channels[channel];

    const mainTaxPercent = regimeOverride === "default" ? baseCh.mainTaxPercent : effectiveRegime === "normal" ? 18 : 14;

    let commissionPercent = baseCh.commissionPercent;
    if (channel === "meli" && baseCh.meli) {
      commissionPercent = meliMode === "premium" ? baseCh.meli.premiumCommissionPercent : baseCh.meli.classicCommissionPercent;
    }

    const taxFixed = baseCh.taxFixed;

    const hasCredits = baseCh.hasCredits;
    const creditFretePercent = channel === "magalu" && magaluShipMode === "full" ? 0 : baseCh.creditFretePercent;
    const creditCommissionPercent = baseCh.creditCommissionPercent;

    return {
      baseCh,
      ch: { commissionPercent, taxFixed, mainTaxPercent, hasCredits, creditFretePercent, creditCommissionPercent },
    };
  }

  function recalcAll(nextRows: PromoRow[]) {
    if (!settings) return nextRows;

    const resolved = resolveChannelRule();
    if (!resolved) return nextRows;

    const alvo = parseNumberPt(margemEsperada);
    const freteDefault = parseNumberPt(fretePadrao);

    return nextRows.map((r) => {
      const cmv = Number.isFinite(r.cmv) ? r.cmv : 0;
      const frete = Number.isFinite(r.frete) && r.frete > 0 ? r.frete : freteDefault;

      if (!cmv || cmv <= 0) {
        const finalCliente = 0;
        const publicar = 0;
        return {
          ...r,
          frete,
          precoDe: cmv * markupBase,
          precoPagoAlvo: round2(finalCliente),
          precoPublicado: round2(publicar),
          margemPct: 0,
          abaixoDaMeta: true,
        };
      }

      const baseCh = resolved.baseCh;
      const ch = resolved.ch;

      const rebateMode = r.rebateMode;
      const rebateValue = r.rebateValue;

      const shouldTierShopee = channel === "shopee" && baseCh.shopee?.mode === "tiered";

      const calc = shouldTierShopee
        ? solveWithShopeeTiered({
            cmv,
            markupBase,
            frete,
            operMode,
            operValue,
            adsMode,
            adsValue,
            margemAlvoPercent: alvo,
            channel: ch,
            channelRaw: baseCh,
            regime: effectiveRegime,
            rebateMode,
            rebateValue,
          })
        : ({
            ...solvePOR({
              cmv,
              markupBase,
              frete,
              operMode,
              operValue,
              adsMode,
              adsValue,
              margemAlvoPercent: alvo,
              channel: ch,
              regime: effectiveRegime,
              rebateMode,
              rebateValue,
            }),
            channelUsed: ch,
          } as any);

      // ✅ Agora:
      // - precoPagoAlvo = preço final pro cliente (após desconto/cupom)
      // - precoPublicado = preço para publicar (antes do desconto/cupom)
      const pago = round2(calc.POR_sugerido);
      const publicado = round2(calcPublicadoFromPago(pago, r.cupomMode, r.cupomValue));

      const margemPct = calc.breakdown.margemPct;
      const abaixo = margemPct + 0.01 < alvo;

      return {
        ...r,
        frete,
        precoDe: round2(calc.precoDE),
        precoPagoAlvo: pago,
        precoPublicado: publicado,
        margemPct,
        abaixoDaMeta: abaixo,
      };
    });
  }

  function applyAllCriteria() {
    setRows((prev) => {
      const next = prev.map((r) => ({
        ...r,
        frete: parseNumberPt(fretePadrao) || r.frete,
        cupomMode: cupomModeAll,
        cupomValue: parseNumberPt(cupomValueAll),
        cupomValueTxt: cupomValueAll,
        rebateMode: rebateModeAll,
        rebateValue: parseNumberPt(rebateValueAll),
        rebateValueTxt: rebateValueAll,
      }));
      return recalcAll(next);
    });
    showToast("ok", "Critérios aplicados e recalculados.");
  }

  // ✅ Aplicar apenas MARGEM ESPERADA
  function applyMargemOnly() {
    setRows((prev) => recalcAll([...prev])); // Só recalcula com a nova margem
    showToast("ok", "Margem esperada aplicada e recalculada.");
  }

  // ✅ Aplicar apenas FRETE PADRÃO
  function applyFreteOnly() {
    setRows((prev) => {
      const next = prev.map((r) => ({
        ...r,
        frete: parseNumberPt(fretePadrao) || r.frete,
        freteTxt: fretePadrao,
      }));
      return recalcAll(next);
    });
    showToast("ok", "Frete padrão aplicado e recalculado.");
  }

  // ✅ Aplicar apenas CUPOM/DESCONTO
  function applyCupomOnly() {
    setRows((prev) => {
      const next = prev.map((r) => ({
        ...r,
        cupomMode: cupomModeAll,
        cupomValue: parseNumberPt(cupomValueAll),
        cupomValueTxt: cupomValueAll,
      }));
      return recalcAll(next);
    });
    showToast("ok", "Cupom/Desconto aplicado e recalculado.");
  }

  // ✅ Aplicar apenas REBATE
  function applyRebateOnly() {
    setRows((prev) => {
      const next = prev.map((r) => ({
        ...r,
        rebateMode: rebateModeAll,
        rebateValue: parseNumberPt(rebateValueAll),
        rebateValueTxt: rebateValueAll,
      }));
      return recalcAll(next);
    });
    showToast("ok", "Rebate aplicado e recalculado.");
  }

  function resolveFromProducts(inputSku: string, inputNumero: string) {
    const sku = normalizeSku(inputSku);
    const mlbFromNumero = normalizeMlb(inputNumero);

    if (mlbFromNumero) {
      const pByMlb = products.find((p) => normalizeMlb(String(p.mlb || "")) === mlbFromNumero);
      if (pByMlb) return { sku: normalizeSku(pByMlb.sku), mlb: mlbFromNumero, cmv: Number(pByMlb.cmv || 0) };
    }

    if (sku) {
      const pBySku = products.find((p) => normalizeSku(p.sku) === sku);
      if (pBySku) return { sku, mlb: normalizeMlb(String(pBySku.mlb || mlbFromNumero || "")), cmv: Number(pBySku.cmv || 0) };
    }

    return { sku, mlb: mlbFromNumero, cmv: 0 };
  }

  // ✅ IMPORTAÇÃO: descarta 4 linhas do MELI
  function onImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });

        const sheetName = pickPromocoesSheet(wb);
        const ws = wb.Sheets[sheetName];
        if (!ws) {
          showToast("err", "Não encontrei a aba 'Promoções' nessa planilha.");
          return;
        }

        // ✅ LER COMO MATRIZ (raw: true mantém números como números)
        const rowsMatrix = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          raw: true,
          defval: "",
        }) as any[][];

        if (!rowsMatrix.length) {
          showToast("err", "A aba 'Promoções' está vazia.");
          return;
        }

        // ✅ acha a linha REAL do cabeçalho (mesmo com 4 linhas extras antes)
        const headerIdx = findHeaderRowIndex(rowsMatrix);
        if (headerIdx < 0) {
          showToast(
            "err",
            "Não achei a linha de cabeçalho do MELI. Confere se é a planilha nativa da aba 'Promoções'."
          );
          return;
        }

        const headers = (rowsMatrix[headerIdx] || []).map((h) => String(h ?? "").trim());
        const dataRows = rowsMatrix.slice(headerIdx + 1);

        // monta em objetos para reusar seu getCell + candidatos
        const json = dataRows
          .map((r) => rowArrayToObject(r, headers))
          .filter((obj) => {
            // descarta linhas vazias
            const all = Object.values(obj).map((v) => String(v ?? "").trim());
            return all.some((v) => v !== "");
          });

        const imported: PromoRow[] = json
          .map((row) => {
            // === colunas MELI (exatamente como no arquivo nativo) ===
            const tituloAnuncio = String(
              getCell(row, ["Título do anúncio", "Titulo do anúncio", "Titulo do anuncio", "titulo do anuncio"]) || ""
            ).trim();

            const numeroAnuncio = String(
              getCell(row, ["Número do anúncio", "Numero do anúncio", "Numero do anuncio", "número do anúncio"]) || ""
            ).trim();

            const skuPlanilha = normalizeSku(String(getCell(row, ["SKU", "Sku"]) || "").trim());

            // ✅ CORREÇÃO: Usar safeNumberFromExcel para converter corretamente
            const precoOriginal = round2(safeNumberFromExcel(getCell(row, ["Preço original", "Preco original"])));
            
            // ✅ CORREÇÃO: Puxar da coluna correta "Redução nas suas tarifas de venda"
            const reducaoTarifas = round2(
              safeNumberFromExcel(getCell(row, ["Redução nas suas tarifas de venda", "Reducao nas suas tarifas de venda", "Redução nas duas tarifas de venda"]))
            );
            
            const descontoTotal = round2(safeNumberFromExcel(getCell(row, ["Desconto total"])));
            const precoFinal = round2(safeNumberFromExcel(getCell(row, ["Preço final", "Preco final"])));

            const statusPromocao = String(getCell(row, ["Status da promoção", "Status da promocao"]) || "").trim();
            const acaoAnuncio = String(
              getCell(row, ["O que você quer fazer com este anúncio?", "O que voce quer fazer com este anuncio?"]) || ""
            ).trim();

            // ✅ Ignorar linhas tipo "NÃO ALTERE ESTA COLUNA" - regex mais robusto
            const anyNaoAltere =
              /n[aã]o\s+altere/i.test(tituloAnuncio) ||
              /n[aã]o\s+altere/i.test(numeroAnuncio) ||
              /n[aã]o\s+altere/i.test(skuPlanilha) ||
              /n[aã]o\s+altere/i.test(statusPromocao);

            if (anyNaoAltere) return null;

            // também ignora linhas vazias
            if (!numeroAnuncio && !skuPlanilha && !tituloAnuncio) return null;

            // === resolve SKU/MLB/CMV com base produtos ===
            const resolved = resolveFromProducts(skuPlanilha, numeroAnuncio);

            // ✅ Cupom/Desconto: vem de "Desconto total" (R$). Se vier vazio, calcula (original - final)
            const descontoRs = descontoTotal > 0 ? descontoTotal : round2(Math.max(0, precoOriginal - precoFinal));

            // ✅ Rebate: puxar da coluna "Redução nas suas tarifas de venda" (R$)
            const rebateRs = round2(Math.max(0, reducaoTarifas || 0));

            return {
              id: crypto.randomUUID(),

              tituloAnuncio,
              numeroAnuncio,
              skuPlanilha,

              precoOriginal,
              reducaoTarifas,
              descontoTotal: descontoRs,
              precoFinalMarketplace: precoFinal,

              statusPromocao,
              acaoAnuncio,

              sku: resolved.sku,
              mlb: resolved.mlb,
              cmv: round2(resolved.cmv),
              frete: 0,

              // ✅ Cupom/Desconto (linha)
              cupomMode: "fixed" as MoneyMode,
              cupomValue: descontoRs || 0,

              // ✅ Rebate (linha) - agora em R$ fixo
              rebateMode: "fixed" as MoneyMode,
              rebateValue: rebateRs || 0,

              precoDe: 0,
              precoPagoAlvo: 0,
              precoPublicado: 0,
              margemPct: 0,
              abaixoDaMeta: true,

              // ✅ Preço proposto = "Preço final" da planilha
              precoProposto: precoFinal || 0,
            } as PromoRow;
          })
          .filter(Boolean) as PromoRow[];

        if (!imported.length) {
          showToast("err", "Importado 0 linhas. (Planilha lida, mas sem dados depois do cabeçalho.)");
          return;
        }

        setRows((prev) => recalcAll([...imported, ...prev]));
        showToast("ok", `Importado (${sheetName}): ${imported.length} linhas.`);
      } catch (e) {
        console.error(e);
        showToast("err", "Falha ao importar planilha.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function updateRow(id: string, patch: Partial<PromoRow>) {
    setRows((prev) => recalcAll(prev.map((r) => (r.id === id ? { ...r, ...patch } : r))));
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function clearAll() {
    setRows([]);
    try {
      localStorage.removeItem(STORAGE_PROMOS);
    } catch {}
    showToast("ok", "Lista de promoções limpa.");
  }

  // ✅ Salvar rascunho no histórico
  function saveDraftToHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_PROMOS_HISTORY);
      const history = raw ? JSON.parse(raw) : [];
      const snap = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        channel,
        regimeOverride,
        meliMode,
        magaluShipMode,
        margemEsperada,
        fretePadrao,
        rows,
      };
      const next = [snap, ...(Array.isArray(history) ? history : [])].slice(0, 30);
      localStorage.setItem(STORAGE_PROMOS_HISTORY, JSON.stringify(next));
      showToast("ok", "Rascunho salvo no histórico.");
    } catch {
      showToast("err", "Não consegui salvar no histórico (storage).");
    }
  }

  // ✅ Adicionar manual
  function addManualRow() {
    const sku = normalizeSku(manualSku);
    const mlb = normalizeMlb(manualMlb);

    // tenta resolver CMV pela base se não preenchido
    const resolved = resolveFromProducts(sku, mlb);
    const cmv = parseNumberPt(manualCmv) || Number(resolved.cmv || 0);
    const frete = parseNumberPt(manualFrete);
    const cupomRs = parseNumberPt(manualCupom);
    const proposto = parseNumberPt(manualProposto);

    const r: PromoRow = {
      id: crypto.randomUUID(),

      // planilha (vazio no manual)
      tituloAnuncio: "",
      numeroAnuncio: mlb || "",
      skuPlanilha: "",
      precoOriginal: 0,
      reducaoTarifas: 0,
      descontoTotal: cupomRs,
      precoFinalMarketplace: proposto, // se quiser usar como referência
      statusPromocao: "",
      acaoAnuncio: "",

      sku: sku || resolved.sku || "",
      mlb: mlb || resolved.mlb || "",
      cmv,
      frete,

      cmvTxt: cmv ? fmtPt(cmv) : "",
      freteTxt: frete ? fmtPt(frete) : "",
      cupomValueTxt: cupomRs ? fmtPt(cupomRs) : "",
      rebateValueTxt: rebateValueAll ? String(rebateValueAll) : "",

      cupomMode: "fixed",
      cupomValue: cupomRs,

      rebateMode: "fixed",
      rebateValue: parseNumberPt(rebateValueAll),

      precoDe: 0,
      precoPagoAlvo: 0,
      precoPublicado: 0,
      margemPct: 0,
      abaixoDaMeta: true,

      precoProposto: proposto,
    };

    setRows((prev) => recalcAll([r, ...prev]));
    setManualOpen(false);
    setManualSku("");
    setManualMlb("");
    setManualCmv("");
    setManualFrete("");
    setManualCupom("");
    setManualProposto("");
    showToast("ok", "Item manual adicionado.");
  }

  // ✅ EXPORTAÇÃO
  function exportPlanilha() {
    try {
      if (!rows.length) {
        showToast("err", "Não há itens para exportar.");
        return;
      }

      const exportRows = rows.map((r) => ({
        // colunas da planilha (mantidas no export)
        "Título do anúncio": r.tituloAnuncio,
        "Número do anúncio": r.numeroAnuncio,
        "SKU (planilha)": r.skuPlanilha,
        "Preço original": r.precoOriginal || 0,
        "Redução nas suas tarifas de venda": r.reducaoTarifas || 0,
        "Desconto total": r.descontoTotal || 0,
        "Preço final (proposto)": r.precoProposto || 0,
        "Status da promoção": r.statusPromocao,
        "O que fazer?": r.acaoAnuncio,

        // sistema
        SKU: r.sku,
        MLB: r.mlb,
        CMV: r.cmv || 0,
        Frete: r.frete || 0,

        "Cupom/Desconto (modo)": r.cupomMode === "percent" ? "%" : "R$",
        "Cupom/Desconto (valor)": r.cupomValue || 0,

        "Rebate (modo)": r.rebateMode === "percent" ? "%" : "R$",
        "Rebate (valor)": r.rebateValue || 0,

        "Preço DE": r.precoDe || 0,
        "Preço para publicar (antes desconto)": r.precoPublicado || 0,
        "Preço final pro cliente (c/ desconto)": r.precoPagoAlvo || 0,

        "MC %": Number.isFinite(r.margemPct) ? Number(r.margemPct.toFixed(2)) : 0,
        "Abaixo da meta": r.abaixoDaMeta ? "SIM" : "NÃO",
      }));

      const ws = XLSX.utils.json_to_sheet(exportRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Promocoes");

      const safeChannel = channel === "meli" ? "mercado_livre" : channel === "magalu" ? "magalu" : "shopee";
      const fileName = `promocoes_${safeChannel}_margem-${String(margemEsperada).replace(",", ".")}.xlsx`;

      XLSX.writeFile(wb, fileName);
      showToast("ok", "Planilha exportada com sucesso.");
    } catch (e) {
      console.error(e);
      showToast("err", "Falha ao exportar planilha.");
    }
  }

  const meta = useMemo(() => {
    const total = rows.length;
    const ruins = rows.filter((r) => r.abaixoDaMeta).length;
    return { total, ruins };
  }, [rows]);

  const needProductsWarn = useMemo(() => {
    if (!rows.length) return false;
    const semCmv = rows.filter((r) => !r.cmv || r.cmv <= 0).length;
    return semCmv > Math.max(3, Math.floor(rows.length * 0.2));
  }, [rows]);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">Promoções</h1>
        <p className="mt-1 text-sm text-white/60">
          Importa a aba <b>Promoções</b> do Mercado Livre, ignora os cabeçalhos extras e calcula:
          <br />• <b>Preço para publicar</b> (antes do desconto) e • <b>Preço final pro cliente</b> (com desconto).
        </p>
      </section>

      {!settings ? (
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6 text-sm text-amber-100">
          Não encontrei Configurações salvas. Vá em <b>Configurações</b>, salve e volte aqui.
        </section>
      ) : null}

      {needProductsWarn ? (
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6 text-sm text-amber-100">
          Atenção: muitos itens ficaram sem <b>CMV</b>. Confere se a aba <b>Produtos</b> já tem MLB cadastrado (SKU ⇄ MLB).
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
            >
              Importar planilha (XLSX / XLS)
            </button>

            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportFile(f);
                e.currentTarget.value = "";
              }}
            />

            <button
              type="button"
              onClick={() => setManualOpen(true)}
              className="rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
            >
              + Adicionar item manual
            </button>

            <button
              type="button"
              onClick={saveDraftToHistory}
              className="rounded-xl bg-indigo-500/15 px-4 py-3 text-sm font-semibold text-indigo-200 ring-1 ring-indigo-500/20 hover:bg-indigo-500/20"
            >
              Salvar rascunho no histórico
            </button>

            <button
              type="button"
              onClick={exportPlanilha}
              disabled={!rows.length}
              className="rounded-xl bg-sky-500/15 px-4 py-3 text-sm font-semibold text-sky-200 ring-1 ring-sky-500/20 hover:bg-sky-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Exportar planilha
            </button>

            <button
              type="button"
              onClick={applyAllCriteria}
              className="rounded-xl bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20"
            >
              Aplicar critérios em todos
            </button>

            <button
              type="button"
              onClick={clearAll}
              className="rounded-xl bg-rose-500/15 px-4 py-3 text-sm font-semibold text-rose-200 ring-1 ring-rose-500/20 hover:bg-rose-500/20"
            >
              Limpar lista
            </button>
          </div>

          <div className="text-sm text-white/70">
            <b>{meta.total}</b> itens •{" "}
            <span className={meta.ruins ? "text-rose-200" : "text-emerald-200"}>
              <b>{meta.ruins}</b> abaixo da margem
            </span>
          </div>
        </div>

        {/* CRITÉRIOS (mantidos) */}
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-xs text-white/60">Canal</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as ChannelKey)}
              className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
            >
              <option value="meli">Mercado Livre</option>
              <option value="magalu">Magalu</option>
              <option value="shopee">Shopee</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-white/60">Regime</span>
            <select
              value={regimeOverride}
              onChange={(e) => setRegimeOverride(e.target.value as any)}
              className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
            >
              <option value="default">Usar Configurações</option>
              <option value="simples">Simples Nacional</option>
              <option value="normal">Regime normal</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-white/60">Margem esperada (%)</span>
            <div className="flex gap-2">
              <input
                value={margemEsperada}
                onChange={(e) => setMargemEsperada(e.target.value)}
                inputMode="decimal"
                className="flex-1 rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
              />
              <button
                type="button"
                onClick={applyMargemOnly}
                className="rounded-xl bg-blue-500/15 px-3 py-2 text-xs font-semibold text-blue-200 ring-1 ring-blue-500/20 hover:bg-blue-500/20 whitespace-nowrap"
                title="Aplicar apenas margem esperada em todos os itens"
              >
                Aplicar
              </button>
            </div>
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <label className="grid gap-1">
            <span className="text-xs text-white/60">Frete padrão (R$)</span>
            <div className="flex gap-2">
              <input
                value={fretePadrao}
                onChange={(e) => setFretePadrao(e.target.value)}
                inputMode="decimal"
                className="flex-1 rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
              />
              <button
                type="button"
                onClick={applyFreteOnly}
                className="rounded-xl bg-blue-500/15 px-3 py-2 text-xs font-semibold text-blue-200 ring-1 ring-blue-500/20 hover:bg-blue-500/20 whitespace-nowrap"
                title="Aplicar apenas frete padrão em todos os itens"
              >
                Aplicar
              </button>
            </div>
          </label>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-white/60">Cupom/Desconto (global)</p>
              <button
                type="button"
                onClick={applyCupomOnly}
                className="rounded-xl bg-blue-500/15 px-3 py-1.5 text-xs font-semibold text-blue-200 ring-1 ring-blue-500/20 hover:bg-blue-500/20"
                title="Aplicar apenas cupom/desconto em todos os itens"
              >
                Aplicar
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setCupomModeAll("percent")}
                className={
                  cupomModeAll === "percent"
                    ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                    : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                }
              >
                %
              </button>
              <button
                type="button"
                onClick={() => setCupomModeAll("fixed")}
                className={
                  cupomModeAll === "fixed"
                    ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                    : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                }
              >
                R$
              </button>
            </div>
            <input
              value={cupomValueAll}
              onChange={(e) => setCupomValueAll(e.target.value)}
              inputMode="decimal"
              className="mt-3 w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
              placeholder={cupomModeAll === "percent" ? "ex: 10" : "ex: 30,00"}
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-white/60">Rebate (global)</p>
              <button
                type="button"
                onClick={applyRebateOnly}
                className="rounded-xl bg-blue-500/15 px-3 py-1.5 text-xs font-semibold text-blue-200 ring-1 ring-blue-500/20 hover:bg-blue-500/20"
                title="Aplicar apenas rebate em todos os itens"
              >
                Aplicar
              </button>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setRebateModeAll("percent")}
                className={
                  rebateModeAll === "percent"
                    ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                    : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                }
              >
                %
              </button>
              <button
                type="button"
                onClick={() => setRebateModeAll("fixed")}
                className={
                  rebateModeAll === "fixed"
                    ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                    : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                }
              >
                R$
              </button>
            </div>
            <input
              value={rebateValueAll}
              onChange={(e) => setRebateValueAll(e.target.value)}
              inputMode="decimal"
              className="mt-3 w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
              placeholder={rebateModeAll === "percent" ? "ex: 4,5" : "ex: 20,00"}
            />
          </div>
        </div>

        {channel === "meli" ? (
          <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="text-xs text-white/60">Mercado Livre</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => setMeliMode("classic")}
                className={
                  meliMode === "classic"
                    ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                    : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                }
              >
                Clássico
              </button>
              <button
                type="button"
                onClick={() => setMeliMode("premium")}
                className={
                  meliMode === "premium"
                    ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                    : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                }
              >
                Premium
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {/* TABELA (colunas da planilha ocultas aqui) */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-xs font-medium tracking-wide text-white/60">ITENS DA PROMOÇÃO</p>

        {!rows.length ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">Importe uma planilha ou adicione manualmente.</div>
        ) : (
          <div className="mt-4 overflow-auto rounded-2xl border border-white/10">
            <table className="min-w-[1400px] w-full text-left text-sm">
              <thead className="bg-white/5">
                <tr className="text-xs text-white/60">
                  <th className="px-3 py-3">SKU</th>
                  <th className="px-3 py-3">MLB</th>
                  <th className="px-3 py-3 text-right">CMV</th>
                  <th className="px-3 py-3 text-right">Frete</th>
                  <th className="px-3 py-3">Cupom/Desconto</th>
                  <th className="px-3 py-3">Rebate</th>

                  <th className="px-3 py-3 text-right">Preço p/ publicar</th>
                  <th className="px-3 py-3 text-right">Preço final cliente</th>

                  <th className="px-3 py-3 text-right">Preço proposto (MELI)</th>
                  <th className="px-3 py-3 text-right">Dif. (final - proposto)</th>

                  <th className="px-3 py-3 text-right">MC%</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>

              <tbody>
                {rows.map((r) => {
                  const diff = (r.precoPagoAlvo || 0) - (r.precoProposto || 0);
                  const diffTxt = diff === 0 ? "0,00" : fmtPt(diff);

                  return (
                    <tr key={r.id} className={"border-t border-white/10 " + (r.abaixoDaMeta ? "bg-rose-500/10" : "bg-transparent")}>
                      <td className="px-3 py-3">
                        <input
                          value={r.sku}
                          onChange={(e) => updateRow(r.id, { sku: normalizeSku(e.target.value) })}
                          className="h-10 w-40 rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none"
                        />
                      </td>

                      <td className="px-3 py-3">
                        <input
                          value={r.mlb}
                          onChange={(e) => updateRow(r.id, { mlb: normalizeMlb(e.target.value) })}
                          className="h-10 w-44 rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none"
                        />
                      </td>

                      {/* CMV (txt destravado) */}
                      <td className="px-3 py-3">
                        <input
                          value={r.cmvTxt ?? (r.cmv ? fmtPt(r.cmv) : "")}
                          onChange={(e) => updateRow(r.id, { cmvTxt: e.target.value, cmv: parseNumberPt(e.target.value) })}
                          inputMode="decimal"
                          placeholder="0,00"
                          className="h-10 w-28 rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none text-right"
                        />
                      </td>

                      {/* Frete (txt destravado) */}
                      <td className="px-3 py-3">
                        <input
                          value={r.freteTxt ?? (r.frete ? fmtPt(r.frete) : "")}
                          onChange={(e) => updateRow(r.id, { freteTxt: e.target.value, frete: parseNumberPt(e.target.value) })}
                          inputMode="decimal"
                          placeholder={fretePadrao}
                          className="h-10 w-28 rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none text-right"
                        />
                      </td>

                      {/* Cupom/Desconto */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <select
                            value={r.cupomMode}
                            onChange={(e) => updateRow(r.id, { cupomMode: e.target.value as any })}
                            className="h-10 w-16 rounded-xl bg-neutral-950/60 px-2 text-sm text-white ring-1 ring-white/10 outline-none"
                          >
                            <option value="percent">%</option>
                            <option value="fixed">R$</option>
                          </select>
                          <input
                            value={r.cupomValueTxt ?? (r.cupomValue ? fmtPt(r.cupomValue) : "")}
                            onChange={(e) => updateRow(r.id, { cupomValueTxt: e.target.value, cupomValue: parseNumberPt(e.target.value) })}
                            inputMode="decimal"
                            className="h-10 w-28 rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none text-right"
                          />
                        </div>
                      </td>

                      {/* Rebate */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <select
                            value={r.rebateMode}
                            onChange={(e) => updateRow(r.id, { rebateMode: e.target.value as any })}
                            className="h-10 w-16 rounded-xl bg-neutral-950/60 px-2 text-sm text-white ring-1 ring-white/10 outline-none"
                          >
                            <option value="percent">%</option>
                            <option value="fixed">R$</option>
                          </select>
                          <input
                            value={r.rebateValueTxt ?? (r.rebateValue ? fmtPt(r.rebateValue) : "")}
                            onChange={(e) => updateRow(r.id, { rebateValueTxt: e.target.value, rebateValue: parseNumberPt(e.target.value) })}
                            inputMode="decimal"
                            className="h-10 w-28 rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none text-right"
                          />
                        </div>
                      </td>

                      <td className="px-3 py-3 tabular-nums text-right text-white/85">R$ {fmtPt(r.precoPublicado || 0)}</td>
                      <td className="px-3 py-3 tabular-nums text-right font-semibold text-white">R$ {fmtPt(r.precoPagoAlvo || 0)}</td>

                      <td className="px-3 py-3 tabular-nums text-right text-white/85">R$ {fmtPt(r.precoProposto || 0)}</td>

                      <td className="px-3 py-3 tabular-nums text-right">
                        <span className={diff > 0 ? "text-amber-200" : diff < 0 ? "text-sky-200" : "text-white/70"}>
                          R$ {diffTxt}
                        </span>
                      </td>

                      <td className="px-3 py-3 tabular-nums text-right">
                        <span className={r.abaixoDaMeta ? "text-rose-200 font-semibold" : "text-emerald-200 font-semibold"}>
                          {Number.isFinite(r.margemPct) ? r.margemPct.toFixed(2) : "0.00"}%
                        </span>
                      </td>

                      <td className="px-3 py-3">
                        <button
                          type="button"
                          onClick={() => removeRow(r.id)}
                          className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 ring-1 ring-white/10 hover:bg-white/10"
                        >
                          Remover
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="p-3 text-xs text-white/50">
              * Em vermelho: itens com margem abaixo da meta (considerando o <b>preço final pro cliente</b>).
              <br />
              * Dif. (final - proposto): se positivo, seu preço final está acima do MELI; se negativo, está abaixo.
            </div>
          </div>
        )}
      </section>

      {/* MODAL: adicionar manual */}
      {manualOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-950 p-5">
            <h3 className="text-lg font-semibold">Adicionar item manual</h3>
            <p className="mt-1 text-sm text-white/60">Use isso para montar uma campanha manual, mesmo sem importar planilha.</p>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-white/60">SKU</span>
                <input value={manualSku} onChange={(e) => setManualSku(e.target.value)} className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-white/60">MLB</span>
                <input value={manualMlb} onChange={(e) => setManualMlb(e.target.value)} className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs text-white/60">CMV (R$)</span>
                  <input value={manualCmv} onChange={(e) => setManualCmv(e.target.value)} inputMode="decimal" className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-white/60">Frete (R$)</span>
                  <input value={manualFrete} onChange={(e) => setManualFrete(e.target.value)} inputMode="decimal" className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs text-white/60">Cupom/Desconto (R$)</span>
                  <input value={manualCupom} onChange={(e) => setManualCupom(e.target.value)} inputMode="decimal" className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-white/60">Preço proposto (MELI)</span>
                  <input value={manualProposto} onChange={(e) => setManualProposto(e.target.value)} inputMode="decimal" className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
                </label>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setManualOpen(false)} className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/10">
                Cancelar
              </button>
              <button onClick={addManualRow} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500">
                Adicionar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-4 right-4 z-50">
          <div
            className={
              "rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ring-1 " +
              (toast.type === "ok"
                ? "bg-emerald-500/15 text-emerald-100 ring-emerald-500/30"
                : "bg-rose-500/15 text-rose-100 ring-rose-500/30")
            }
          >
            {toast.text}
          </div>
        </div>
      ) : null}
    </div>
  );
}