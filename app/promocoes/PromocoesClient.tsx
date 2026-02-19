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

function solvePORLocal(params: Parameters<typeof solvePOR>[0]) {
  const p = { ...params, descontoMode: undefined as any, descontoValue: 0 };
  return solvePOR(p);
}

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
  precoFinalMarketplace: number;
  statusPromocao: string;
  acaoAnuncio: string;

  // ====== LIGAÇÃO COM BASE PRODUTOS ======
  sku: string;
  mlb: string;
  nomeProduto?: string;
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
  precoPagoAlvo: number;
  precoPublicado: number;
  margemPct: number;
  abaixoDaMeta: boolean;

  // ====== COMPARAÇÃO ======
  precoProposto: number;
};

const STORAGE_RULESETS = "markup_settings_rulesets_v1";
const STORAGE_PROMOS = "markup_promocoes_v1";
const STORAGE_PRODUCTS = "markup_products_v1";
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
  if (row && typeof row === "object" && !Array.isArray(row)) {
    const keys = Object.keys(row || {});
    for (const c of candidates) {
      const ck = normKey(c);
      const found = keys.find((k) => normKey(k) === ck);
      if (found != null) return row[found];
    }
    return undefined;
  }
  return undefined;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

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
  if (names.length === 0) return undefined;

  const exact = names.find((n) => {
    const nk = normKey(n);
    return nk === normKey("Promoções") || nk === normKey("Promocoes") || nk === "promocoes";
  });
  if (exact) return exact;

  const contains = names.find((n) => normKey(n).includes("promo"));
  if (contains) return contains;

  const firstNonAjuda = names.find((n) => !normKey(n).includes("ajuda"));
  return firstNonAjuda || names[0];
}

function aoaToObjects(aoa: any[][]) {
  if (!aoa?.length) return [];
  const header = (aoa[0] || []).map((h) => String(h ?? "").trim());
  const out: any[] = [];
  for (let i = 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    if (!row.some((c: any) => String(c ?? "").trim() !== "")) continue;
    const obj: any = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = row[j] ?? "";
    out.push(obj);
  }
  return out;
}

function findHeaderRowIndex(rows: any[][]) {
  const required = ["titulo", "numero", "sku", "preco", "final"];
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const line = (rows[i] || []).map((c) => normKey(String(c ?? "")));
    const hits = required.filter((r) => line.some((v) => v.includes(r))).length;
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

function safeNumberFromExcel(value: any): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  const str = String(value).trim();
  if (!str) return 0;
  const normalized = str.replace(/\./g, "").replace(",", ".");
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}

function buildDescontoFinalPriceMap(wb: XLSX.WorkBook) {
  const map = new Map<string, number>();

  const sheetName =
    (wb.SheetNames || []).find((n) => normKey(n) === normKey("Desconto")) ||
    (wb.SheetNames || []).find((n) => normKey(n).includes("desconto"));

  if (!sheetName) {
    console.warn("⚠️ Aba 'Desconto' não encontrada. Abas:", wb.SheetNames);
    return map;
  }

  const ws = wb.Sheets[sheetName];
  if (!ws) return map;

  const rowsMatrix = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: "",
  }) as any[][];

  if (!rowsMatrix?.length) return map;

  let headerIdx = -1;
  for (let i = 0; i < Math.min(rowsMatrix.length, 40); i++) {
    const line = (rowsMatrix[i] || []).map((c) => normKey(String(c ?? "")));
    const hasNumero = line.some((v) => v.includes("numero") && v.includes("anuncio"));
    const hasPrecoFinal = line.some((v) => v.includes("preco") && v.includes("final"));
    if (hasNumero && hasPrecoFinal) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0) {
    console.warn("⚠️ Header da aba 'Desconto' não encontrado.");
    return map;
  }

  const headerMain = rowsMatrix[headerIdx] || [];
  const headerSub = rowsMatrix[headerIdx + 1] || [];

  const headers = headerMain.map((h, i) => {
    const main = String(h ?? "").trim();
    if (main) return main;
    const sub = String(headerSub?.[i] ?? "").trim();
    return sub || "";
  });

  const dataStart = headerSub.some((c) => String(c ?? "").trim() !== "") ? headerIdx + 2 : headerIdx + 1;
  const dataRows = rowsMatrix.slice(dataStart);

  const json = dataRows
    .map((r) => rowArrayToObject(r, headers))
    .filter((obj) => {
      const all = Object.values(obj).map((v) => String(v ?? "").trim());
      return all.some((v) => v !== "");
    });

  for (const row of json) {
    const numeroAnuncioRaw = String(
      getCell(row, ["Número do anúncio", "Numero do anúncio", "Numero do anuncio", "número do anúncio"]) || ""
    ).trim();

    const mlb = normalizeMlb(numeroAnuncioRaw);
    if (!mlb) continue;

    const precoFinal = round2(safeNumberFromExcel(getCell(row, ["Preço final", "Preco final"])));

    if (precoFinal > 0) {
      map.set(mlb, precoFinal);
    }
  }

  console.log(`✓ Mapa Desconto carregado: ${map.size} itens (aba: ${sheetName})`);
  return map;
}


export default function PromocoesClient() {
  const fileRef = useRef<HTMLInputElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [tableRealWidth, setTableRealWidth] = useState(1800);

  const [settings, setSettings] = useState<Settings | null>(null);
  const [products, setProducts] = useState<Product[]>([]);

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

  const markupBase = 4.3;
  const operMode: MoneyMode = "fixed";
  const adsMode: MoneyMode = "fixed";
  const operValue = 0;
  const adsValue = 0;

  const [rows, setRows] = useState<PromoRow[]>([]);
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualSku, setManualSku] = useState("");
  const [manualMlb, setManualMlb] = useState("");
  const [manualCmv, setManualCmv] = useState("");
  const [manualFrete, setManualFrete] = useState("");
  const [manualCupom, setManualCupom] = useState("");
  const [manualProposto, setManualProposto] = useState("");

  function showToast(type: "ok" | "err", text: string) {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 1800);
  }

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings/rulesets');
        if (res.ok) {
          const json = await res.json();
          const list = Array.isArray(json?.rulesets) ? json.rulesets : [];
          const active = list.find((r: any) => r.isActive) || list[0] || null;
          if (active) {
            const raw = active.data ? active.data : active;
            const regime: "simples" | "normal" = raw.regime === "simples" ? "simples" : "normal";
            const mainTax = regime === "normal" ? 18 : 14;
            const meli = raw.channels?.meli || {};
            const mapped = {
              ...raw,
              channels: {
                ...raw.channels,
                meli: {
                  ...meli,
                  mainTaxPercent: typeof meli.mainTaxPercent === "number" ? meli.mainTaxPercent : mainTax,
                  hasCredits: typeof meli.hasCredits === "boolean" ? meli.hasCredits : true,
                  creditFretePercent: typeof meli.creditFretePercent === "number" ? meli.creditFretePercent : 21.25,
                  creditCommissionPercent: typeof meli.creditCommissionPercent === "number" ? meli.creditCommissionPercent : 9.25,
                  meli: {
                    classicCommissionPercent: raw.meli?.classicCommissionPercent ?? 11.5,
                    premiumCommissionPercent: raw.meli?.premiumCommissionPercent ?? 16.5,
                  },
                },
              },
            };
            setSettings(mapped);
          }
        }
      } catch {}
    })();

    async function loadProducts() {
      try {
        const response = await fetch("/api/products");
        if (!response.ok) {
          console.warn("⚠️ Erro ao buscar produtos da API:", response.statusText);
          return;
        }
        const data = await response.json();
        const parsed = (data.products || data || []) as any[];
        const next: Product[] = parsed.map((p) => ({
          sku: normalizeSku(p.sku),
          name: String(p.name ?? "").trim(),
          cmv: Number(p.cmv ?? 0) || 0,
          mlb: p.mlb ? normalizeMlb(String(p.mlb)) : undefined,
          updatedAt: String(p.updatedAt ?? new Date().toISOString()),
        }));
        setProducts(next);
        if (next.length > 0) {
          console.log(`✓ Carregados ${next.length} produtos com CMV > 0`);
          if (data.filtered && data.filtered > 0) {
            console.log(`ℹ️ ${data.filtered} produtos ignorados por ter CMV = 0`);
          }
        } else {
          console.warn("⚠️ Nenhum produto com CMV > 0 encontrado.");
        }
      } catch (e) {
        console.error("❌ Erro ao carregar produtos da API:", e);
      }
    }

    loadProducts();

    try {
      const raw = localStorage.getItem(STORAGE_PROMOS);
      if (raw) setRows(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PROMOS, JSON.stringify(rows));
    } catch {}
  }, [rows]);

  // Medir largura real da tabela para sincronizar scrollbar do topo
  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const update = () => setTableRealWidth(el.scrollWidth + 4);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [rows]);

  // Recalcula ao trocar canal, regime, meliMode ou magaluShipMode
  useEffect(() => {
    if (!settings || !rows.length) return;
    setRows((prev) => recalcAll([...prev]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, regimeOverride, meliMode, magaluShipMode, settings]);

  const effectiveRegime: Regime = useMemo(() => {
    if (!settings) return "normal";
    return regimeOverride === "default" ? settings.regime : regimeOverride;
  }, [settings, regimeOverride]);

  // ====== AJUSTE 1: Clássico/Premium com taxas corretas ======
  function resolveChannelRule() {
    if (!settings) return null;
    const baseCh = settings.channels[channel];
    const mainTaxPercent =
      regimeOverride === "default"
        ? baseCh.mainTaxPercent
        : effectiveRegime === "normal"
        ? 18
        : 14;

    let commissionPercent = baseCh.commissionPercent;
    if (channel === "meli") {
      const meliCfg = baseCh.meli || (settings as any).meli;
      if (meliCfg) {
        commissionPercent =
          meliMode === "premium"
            ? (meliCfg.premiumCommissionPercent ?? 16.5)
            : (meliCfg.classicCommissionPercent ?? 11.5);
      }
    }

    const taxFixed = baseCh.taxFixed;
    const hasCredits = baseCh.hasCredits;
    const creditFretePercent =
      channel === "magalu" && magaluShipMode === "full" ? 0 : baseCh.creditFretePercent;
    const creditCommissionPercent = baseCh.creditCommissionPercent;

    return {
      baseCh,
      ch: {
        commissionPercent,
        taxFixed,
        mainTaxPercent,
        hasCredits,
        creditFretePercent,
        creditCommissionPercent,
      },
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
        return {
          ...r,
          frete,
          precoDe: cmv * markupBase,
          precoPagoAlvo: round2(0),
          precoPublicado: round2(0),
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
        ? (() => {
            const res = solveWithShopeeTiered({
              cmv, markupBase, frete, operMode, operValue, adsMode, adsValue,
              margemAlvoPercent: alvo, channel: ch, channelRaw: baseCh,
              regime: effectiveRegime, rebateMode, rebateValue,
              descontoMode: "fixed" as any, descontoValue: 0,
            });
            return { ...res, breakdown: { ...res.breakdown } };
          })()
        : ({
            ...solvePORLocal({
              cmv, markupBase, frete, operMode, operValue, adsMode, adsValue,
              margemAlvoPercent: alvo, channel: ch,
              regime: effectiveRegime, rebateMode, rebateValue,
              descontoMode: "fixed" as any, descontoValue: 0,
            }),
            channelUsed: ch,
          } as any);

      const pago = round2(calc.POR_sugerido);
      const publicado = round2(calc.precoDE);
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

  function applyMargemOnly() {
    setRows((prev) => recalcAll([...prev]));
    showToast("ok", "Margem esperada aplicada e recalculada.");
  }

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

  // ====== AJUSTE 3 + 4: resolveFromProducts retorna nome, prioridade correta ======
  function resolveFromProducts(inputSku: string, inputNumero: string) {
    const sku = normalizeSku(inputSku);
    const mlbFromNumero = normalizeMlb(inputNumero);

    if (mlbFromNumero) {
      const pByMlb = products.find(
        (p) => normalizeMlb(String(p.mlb || "")) === mlbFromNumero
      );
      if (pByMlb) {
        return {
          sku: normalizeSku(pByMlb.sku),
          mlb: mlbFromNumero,
          cmv: Number(pByMlb.cmv || 0),
          nome: pByMlb.name,
        };
      }
    }
    if (sku) {
      const pBySku = products.find((p) => normalizeSku(p.sku) === sku);
      if (pBySku) {
        return {
          sku,
          mlb: normalizeMlb(String(pBySku.mlb || mlbFromNumero || "")),
          cmv: Number(pBySku.cmv || 0),
          nome: pBySku.name,
        };
      }
    }
    return { sku, mlb: mlbFromNumero, cmv: 0, nome: "" };
  }

  // ====== IMPORTAÇÃO ======
  function onImportFile(file: File) {
    console.log("Importando arquivo:", file.name, "Tamanho:", file.size);
    if (!products.length) {
      console.warn("⚠️ Aviso: Nenhum produto carregado.");
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = new Uint8Array(reader.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        console.log("Abas encontradas:", wb.SheetNames);

        const descontoFinalMap = buildDescontoFinalPriceMap(wb);

        const sheetName = pickPromocoesSheet(wb);
        if (!sheetName) {
          showToast("err", `Nenhuma aba encontrada. Abas: ${(wb.SheetNames || []).join(", ") || "nenhuma"}`);
          return;
        }
        const ws = wb.Sheets[sheetName];
        if (!ws) {
          showToast("err", `Aba não encontrada. Abas: ${(wb.SheetNames || []).join(", ") || "nenhuma"}`);
          return;
        }

        const rowsMatrix = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          raw: true,
          defval: "",
        }) as any[][];

        if (!rowsMatrix.length) {
          showToast("err", "A aba 'Promoções' está vazia.");
          return;
        }

        const headerIdx = findHeaderRowIndex(rowsMatrix);
        if (headerIdx < 0) {
          showToast("err", "Cabeçalho não encontrado. Verifique se é a planilha nativa de Promoções do Mercado Livre.");
          return;
        }

        const headerMain = rowsMatrix[headerIdx] || [];
        const headerSub = rowsMatrix[headerIdx + 1] || [];

        let currentGroup = "";
        const headers = headerMain.map((h, i) => {
          const group = String(h ?? "").trim();
          if (group) currentGroup = group;
          const sub = String(headerSub?.[i] ?? "").trim();
          if (!sub) return currentGroup || group || "";
          return (currentGroup ? `${currentGroup} - ${sub}` : sub).trim();
        });

        const dataRows = rowsMatrix.slice(headerIdx + 2);

        const json = dataRows
          .map((r) => rowArrayToObject(r, headers))
          .filter((obj) => {
            const all = Object.values(obj).map((v) => String(v ?? "").trim());
            return all.some((v) => v !== "");
          });

        const imported: PromoRow[] = json
          .map((row) => {
            const tituloAnuncio = String(
              getCell(row, ["Título do anúncio", "Titulo do anúncio", "Titulo do anuncio", "titulo do anuncio"]) || ""
            ).trim();

            const numeroAnuncio = String(
              getCell(row, ["Número do anúncio", "Numero do anúncio", "Numero do anuncio", "número do anúncio"]) || ""
            ).trim();

            const skuPlanilha = normalizeSku(
              String(getCell(row, ["SKU", "Sku"]) || "").trim()
            );

            const precoOriginal = round2(
              safeNumberFromExcel(getCell(row, ["Preço original", "Preco original"]))
            );

            const reducaoTarifas = round2(
              safeNumberFromExcel(
                getCell(row, [
                  "Redução nas suas tarifas de venda",
                  "Reducao nas suas tarifas de venda",
                  "Redução nas duas tarifas de venda",
                ])
              )
            );

            const descontoPct = round2(
              safeNumberFromExcel(
                getCell(row, [
                  "Desconto - Porcentagem",
                  "Desconto - Porcentagem ",
                  "Desconto - %",
                  "Porcentagem",
                ])
              )
            );

            const precoFinalMeli = round2(
              safeNumberFromExcel(
                getCell(row, [
                  "Desconto - Preço final",
                  "Desconto - Preco final",
                  "Preço final",
                  "Preco final",
                ])
              )
            );

            const descontoTotal = round2(
              safeNumberFromExcel(getCell(row, ["Desconto total"]))
            );

            const mlbKey = normalizeMlb(numeroAnuncio);
            const precoFinalDesconto = round2(descontoFinalMap.get(mlbKey) || 0);

            const statusPromocao = String(
              getCell(row, ["Status da promoção", "Status da promocao"]) || ""
            ).trim();
            const acaoAnuncio = String(
              getCell(row, [
                "O que você quer fazer com este anúncio?",
                "O que voce quer fazer com este anuncio?",
              ]) || ""
            ).trim();

            const anyNaoAltere =
              /n[aã]o\s+altere/i.test(tituloAnuncio) ||
              /n[aã]o\s+altere/i.test(numeroAnuncio) ||
              /n[aã]o\s+altere/i.test(skuPlanilha) ||
              /n[aã]o\s+altere/i.test(statusPromocao);

            if (anyNaoAltere) return null;
            if (!numeroAnuncio && !skuPlanilha && !tituloAnuncio) return null;

            // ====== AJUSTE 3: resolve nome do produto ======
            const resolved = resolveFromProducts(skuPlanilha, numeroAnuncio);

            const descontoRs =
              descontoTotal > 0
                ? descontoTotal
                : round2(Math.max(0, precoOriginal - precoFinalMeli));

            const precoFinal = precoFinalMeli;
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
              // ====== AJUSTE 3: nomeProduto ======
              nomeProduto: resolved.nome || tituloAnuncio || "",
              cmv: round2(resolved.cmv),
              frete: 0,

              cupomMode: "fixed" as MoneyMode,
              cupomValue: descontoRs || 0,

              rebateMode: "fixed" as MoneyMode,
              rebateValue: rebateRs || 0,

              precoDe: 0,
              precoPagoAlvo: 0,
              precoPublicado: 0,
              margemPct: 0,
              abaixoDaMeta: true,

              precoProposto: precoFinalDesconto || precoFinal || 0,
            } as PromoRow;
          })
          .filter(Boolean) as PromoRow[];

        if (!imported.length) {
          console.warn("No rows imported. Total processable rows:", json.length);
          showToast("err", `Importado 0 linhas. Verifique a estrutura da planilha (${json.length} linhas lidas).`);
          return;
        }

        setRows((prev) => recalcAll([...imported, ...prev]));
        showToast("ok", `Importado (${sheetName}): ${imported.length} linhas.`);
      } catch (e) {
        console.error("Erro ao importar planilha:", e);
        const errorMessage = e instanceof Error ? e.message : String(e);
        showToast("err", `Erro: ${errorMessage || "Falha ao importar planilha"}`);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function updateRow(id: string, patch: Partial<PromoRow>) {
    setRows((prev) => recalcAll(prev.map((r) => (r.id === id ? { ...r, ...patch } : r))));
  }

  function autoFillBySku(rowId: string, skuInput: string) {
    if (!skuInput || !skuInput.trim()) return;
    const normalizedSku = normalizeSku(skuInput);
    const produto = products.find((p) => p.sku === normalizedSku);
    if (produto) {
      updateRow(rowId, {
        sku: normalizedSku,
        mlb: produto.mlb || "",
        cmv: produto.cmv || 0,
        nomeProduto: produto.name || "",
        cmvTxt: undefined,
      });
    } else {
      updateRow(rowId, { sku: normalizedSku });
    }
  }

  function autoFillByMlb(rowId: string, mlbInput: string) {
    if (!mlbInput || !mlbInput.trim()) return;
    const normalizedMlb = normalizeMlb(mlbInput);
    const produto = products.find((p) => p.mlb === normalizedMlb);
    if (produto) {
      updateRow(rowId, {
        sku: produto.sku,
        mlb: normalizedMlb,
        cmv: produto.cmv || 0,
        nomeProduto: produto.name || "",
        cmvTxt: undefined,
      });
    } else {
      updateRow(rowId, { mlb: normalizedMlb });
    }
  }

  function handleSkuChange(id: string, value: string) {
    const normalizedSku = normalizeSku(value);
    updateRow(id, { sku: normalizedSku });
    if (normalizedSku.length >= 3) {
      autoFillBySku(id, normalizedSku);
    }
  }

  function handleMlbChange(id: string, value: string) {
    const normalizedMlb = normalizeMlb(value);
    updateRow(id, { mlb: normalizedMlb });
    if (normalizedMlb.length >= 6) {
      autoFillByMlb(id, normalizedMlb);
    }
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

  function addManualRow() {
    const inputSku = normalizeSku(manualSku);
    const inputMlb = normalizeMlb(manualMlb);

    let finalSku = inputSku;
    let finalMlb = inputMlb;
    let finalCmv = parseNumberPt(manualCmv);
    let finalNome = "";

    if (inputSku && !inputMlb) {
      const resolved = resolveFromProducts(inputSku, "");
      finalSku = resolved.sku || inputSku;
      finalMlb = resolved.mlb || "";
      finalNome = resolved.nome || "";
      if (!manualCmv) finalCmv = resolved.cmv || 0;
    } else if (inputMlb && !inputSku) {
      const resolved = resolveFromProducts("", inputMlb);
      finalSku = resolved.sku || "";
      finalMlb = resolved.mlb || inputMlb;
      finalNome = resolved.nome || "";
      if (!manualCmv) finalCmv = resolved.cmv || 0;
    } else if (inputSku && inputMlb) {
      const resolved = resolveFromProducts(inputSku, inputMlb);
      finalNome = resolved.nome || "";
      if (!manualCmv) finalCmv = resolved.cmv || 0;
    }

    const frete = parseNumberPt(manualFrete);
    const cupomRs = parseNumberPt(manualCupom);
    const proposto = parseNumberPt(manualProposto);

    const r: PromoRow = {
      id: crypto.randomUUID(),

      tituloAnuncio: "",
      numeroAnuncio: finalMlb || "",
      skuPlanilha: "",
      precoOriginal: 0,
      reducaoTarifas: 0,
      descontoTotal: cupomRs,
      precoFinalMarketplace: proposto,
      statusPromocao: "",
      acaoAnuncio: "",

      sku: finalSku,
      mlb: finalMlb,
      nomeProduto: finalNome,
      cmv: finalCmv,
      frete,

      cmvTxt: manualCmv ? String(manualCmv) : "",
      freteTxt: manualFrete ? String(manualFrete) : "",
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

  function exportPlanilha() {
    try {
      if (!rows.length) {
        showToast("err", "Não há itens para exportar.");
        return;
      }

      const exportRows = rows.map((r) => ({
        "Título do anúncio": r.tituloAnuncio,
        "Número do anúncio": r.numeroAnuncio,
        "SKU (planilha)": r.skuPlanilha,
        "Preço original": r.precoOriginal || 0,
        "Redução nas suas tarifas de venda": r.reducaoTarifas || 0,
        "Desconto total": r.descontoTotal || 0,
        "Preço final (proposto)": r.precoProposto || 0,
        "Status da promoção": r.statusPromocao,
        "O que fazer?": r.acaoAnuncio,

        SKU: r.sku,
        MLB: r.mlb,
        "Nome do produto": r.nomeProduto || "",
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

      const safeChannel =
        channel === "meli" ? "mercado_livre" : channel === "magalu" ? "magalu" : "shopee";
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
      {!products.length && (
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6 text-sm text-amber-100">
          ⚠️ <b>Nenhum produto com CMV cadastrado!</b>
          <br />
          <br />
          Para usar a resolução automática de SKU/MLB e precificação:
          <ol className="mt-2 ml-4 space-y-1">
            <li>1. Vá na aba <b>Produtos</b></li>
            <li>2. Cadastre ou edite seus produtos</li>
            <li>3. Preencha o <b>CMV</b> (Custo de Mercadoria Vendida)</li>
            <li>4. Volte para esta aba</li>
          </ol>
          <br />
          <small className="text-amber-200/70">
            📊 Produtos com CMV = 0 não podem ser precificados e não aparecem aqui.
          </small>
        </section>
      )}

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
              title="Clique para selecionar um arquivo XLSX ou XLS"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white ring-1 ring-blue-500/30 hover:bg-blue-500 transition-colors"
            >
              📄 Importar planilha (XLSX / XLS)
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

        {/* CRITÉRIOS */}
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

      {/* TABELA */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <p className="text-xs font-medium tracking-wide text-white/60">ITENS DA PROMOÇÃO</p>

        {!rows.length ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
            Importe uma planilha ou adicione manualmente.
          </div>
        ) : (
          // ====== AJUSTE 2: Barra de rolagem dupla (topo e base) ======
          <div className="mt-4 rounded-2xl border border-white/10">
            {/* Scrollbar do TOPO — espelha o scroll da tabela via ref */}
            <div
              ref={topScrollRef}
              className="overflow-x-auto"
              style={{ height: "12px" }}
              onScroll={(e) => {
                if (tableScrollRef.current && tableScrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
                  tableScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
            >
              <div style={{ width: `${tableRealWidth}px`, height: "1px" }} />
            </div>

            {/* Wrapper da tabela — scroll real */}
            <div
              ref={tableScrollRef}
              className="overflow-x-auto"
              onScroll={(e) => {
                if (topScrollRef.current && topScrollRef.current.scrollLeft !== e.currentTarget.scrollLeft) {
                  topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
            >
              <table ref={tableRef} className="min-w-[1600px] w-full text-left text-sm">
                <thead className="bg-white/5">
                  <tr className="text-xs text-white/60">
                    {/* ====== AJUSTE 3: ordem SKU → MLB → Nome ====== */}
                    <th className="px-3 py-3">SKU</th>
                    <th className="px-3 py-3">MLB</th>
                    <th className="px-3 py-3">Nome</th>
                    <th className="px-3 py-3 text-right">CMV</th>
                    <th className="px-3 py-3 text-right">Frete</th>
                    <th className="px-3 py-3">Cupom/Desconto</th>
                    <th className="px-3 py-3">Rebate</th>
                    <th className="px-3 py-3 text-right">Preço original</th>
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
                    const diff = (r.precoProposto || 0) - (r.precoPagoAlvo || 0);
                    const diffTxt = diff === 0 ? "0,00" : fmtPt(diff);

                    // ====== AJUSTE 5: MC% baseado no preço proposto (MELI) ======
                    const mcProposto = (() => {
                      if (!r.precoProposto || r.precoProposto <= 0 || !r.cmv) return null;
                      const p = r.precoProposto;
                      const resolved = resolveChannelRule();
                      const ch = resolved?.ch || null;
                      if (!ch) return null;
                      const regime = effectiveRegime;
                      const c = ch.commissionPercent / 100;
                      const t = ch.mainTaxPercent / 100;
                      const pis = regime === "normal" ? 0.0925 * (p - p * t) : 0;
                      const credFrete =
                        regime === "normal" && ch.hasCredits
                          ? r.frete * (ch.creditFretePercent / 100)
                          : 0;
                      const credComissao =
                        regime === "normal" && ch.hasCredits
                          ? p * c * (ch.creditCommissionPercent / 100)
                          : 0;
                      const rebate =
                        r.rebateMode === "fixed"
                          ? r.rebateValue
                          : p * (r.rebateValue / 100);
                      const mc =
                        p -
                        p * c -
                        p * t -
                        pis -
                        ch.taxFixed -
                        r.frete -
                        r.cmv +
                        credFrete +
                        credComissao +
                        rebate;
                      return p > 0 ? (mc / p) * 100 : 0;
                    })();

                    return (
                      <tr
                        key={r.id}
                        className={
                          "border-t border-white/10 " +
                          (r.abaixoDaMeta ? "bg-rose-500/10" : "bg-transparent")
                        }
                      >
                        {/* SKU */}
                        <td className="px-3 py-3">
                          <input
                            value={r.sku}
                            onChange={(e) => handleSkuChange(r.id, e.target.value)}
                            onBlur={(e) => autoFillBySku(r.id, e.target.value)}
                            className="h-10 w-32 rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none"
                            placeholder="SKU"
                            title="Digite o SKU e pressione Tab para auto-completar MLB e CMV"
                          />
                        </td>

                        {/* MLB */}
                        <td className="px-3 py-3">
                          <input
                            value={r.mlb}
                            onChange={(e) => handleMlbChange(r.id, e.target.value)}
                            onBlur={(e) => autoFillByMlb(r.id, e.target.value)}
                            className="h-10 w-44 rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none"
                            placeholder="MLB ou número"
                            title="Digite o MLB e pressione Tab para auto-completar SKU e CMV"
                          />
                        </td>

                        {/* ====== AJUSTE 3: Nome do produto (após MLB) ====== */}
                        <td
                          className="px-3 py-3 text-white/70 text-xs max-w-[160px] truncate"
                          title={r.nomeProduto || r.tituloAnuncio || ""}
                        >
                          {r.nomeProduto || r.tituloAnuncio || "—"}
                        </td>

                        {/* CMV */}
                        <td className="px-3 py-3">
                          <div className="relative">
                            <input
                              value={r.cmvTxt ?? (r.cmv ? fmtPt(r.cmv) : "")}
                              onChange={(e) =>
                                updateRow(r.id, {
                                  cmvTxt: e.target.value,
                                  cmv: parseNumberPt(e.target.value),
                                })
                              }
                              inputMode="decimal"
                              placeholder="0,00"
                              className={
                                "h-10 w-28 rounded-xl px-3 text-sm text-white ring-1 outline-none text-right " +
                                (r.cmv > 0 && !r.cmvTxt
                                  ? "bg-emerald-500/20 ring-emerald-500/30"
                                  : "bg-neutral-950/60 ring-white/10")
                              }
                              title={
                                r.cmv > 0 && !r.cmvTxt
                                  ? "✓ Preenchido automaticamente da base de produtos"
                                  : ""
                              }
                            />
                            {r.cmv > 0 && !r.cmvTxt && (
                              <span
                                className="absolute right-2 top-2 text-emerald-400 text-lg"
                                title="Valor da base de produtos"
                              >
                                ✓
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Frete */}
                        <td className="px-3 py-3">
                          <input
                            value={r.freteTxt ?? (r.frete ? fmtPt(r.frete) : "")}
                            onChange={(e) =>
                              updateRow(r.id, {
                                freteTxt: e.target.value,
                                frete: parseNumberPt(e.target.value),
                              })
                            }
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
                              onChange={(e) =>
                                updateRow(r.id, { cupomMode: e.target.value as any })
                              }
                              className="h-10 w-16 rounded-xl bg-neutral-950/60 px-2 text-sm text-white ring-1 ring-white/10 outline-none"
                            >
                              <option value="percent">%</option>
                              <option value="fixed">R$</option>
                            </select>
                            <input
                              value={r.cupomValueTxt ?? (r.cupomValue ? fmtPt(r.cupomValue) : "")}
                              onChange={(e) =>
                                updateRow(r.id, {
                                  cupomValueTxt: e.target.value,
                                  cupomValue: parseNumberPt(e.target.value),
                                })
                              }
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
                              onChange={(e) =>
                                updateRow(r.id, { rebateMode: e.target.value as any })
                              }
                              className="h-10 w-16 rounded-xl bg-neutral-950/60 px-2 text-sm text-white ring-1 ring-white/10 outline-none"
                            >
                              <option value="percent">%</option>
                              <option value="fixed">R$</option>
                            </select>
                            <input
                              value={
                                r.rebateValueTxt ?? (r.rebateValue ? fmtPt(r.rebateValue) : "")
                              }
                              onChange={(e) =>
                                updateRow(r.id, {
                                  rebateValueTxt: e.target.value,
                                  rebateValue: parseNumberPt(e.target.value),
                                })
                              }
                              inputMode="decimal"
                              className="h-10 w-28 rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none text-right"
                            />
                          </div>
                        </td>

                        {/* Preços */}
                        <td className="px-3 py-3 tabular-nums text-right text-white/60">
                          R$ {fmtPt(r.precoOriginal || 0)}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-right text-white/85">
                          R$ {fmtPt(r.precoPublicado || 0)}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-right font-semibold text-white">
                          R$ {fmtPt(r.precoPagoAlvo || 0)}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-right text-white/85">
                          R$ {fmtPt(r.precoProposto || 0)}
                        </td>

                        {/* Diferença */}
                        <td className="px-3 py-3 tabular-nums text-right">
                          <span
                            className={
                              diff > 0
                                ? "text-amber-200"
                                : diff < 0
                                ? "text-sky-200"
                                : "text-white/70"
                            }
                          >
                            R$ {diffTxt}
                          </span>
                        </td>

                        {/* ====== AJUSTE 5: MC% com duas linhas (calc + meli) ====== */}
                        <td className="px-3 py-3 tabular-nums text-right">
                          <div className="flex flex-col items-end gap-0.5">
                            <span
                              className={
                                r.abaixoDaMeta
                                  ? "text-rose-200 font-semibold text-xs"
                                  : "text-emerald-200 font-semibold text-xs"
                              }
                              title="MC% pelo seu preço calculado"
                            >
                              calc: {Number.isFinite(r.margemPct) ? r.margemPct.toFixed(2) : "0.00"}%
                            </span>
                            {mcProposto !== null && (
                              <span
                                className={
                                  mcProposto < 0
                                    ? "text-rose-300 text-xs"
                                    : mcProposto < 10
                                    ? "text-amber-300 text-xs"
                                    : "text-sky-300 text-xs"
                                }
                                title="MC% se vender pelo preço proposto do MELI"
                              >
                                meli: {mcProposto.toFixed(2)}%
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Remover */}
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
                * Em vermelho: itens com margem abaixo da meta (considerando o{" "}
                <b>preço final pro cliente</b>).
                <br />
                * Dif. (final - proposto): se positivo, o preço proposto do MELI está acima do seu
                preço final; se negativo, está abaixo.
              </div>
            </div>
          </div>
        )}
      </section>

      {/* MODAL: adicionar manual */}
      {manualOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-950 p-5">
            <h3 className="text-lg font-semibold">Adicionar item manual</h3>
            <p className="mt-1 text-sm text-white/60">
              Use isso para montar uma campanha manual, mesmo sem importar planilha.
            </p>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-white/60">SKU</span>
                <input
                  value={manualSku}
                  onChange={(e) => setManualSku(e.target.value)}
                  className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-white/60">MLB</span>
                <input
                  value={manualMlb}
                  onChange={(e) => setManualMlb(e.target.value)}
                  className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none"
                />
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs text-white/60">CMV (R$)</span>
                  <input
                    value={manualCmv}
                    onChange={(e) => setManualCmv(e.target.value)}
                    inputMode="decimal"
                    className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-white/60">Frete (R$)</span>
                  <input
                    value={manualFrete}
                    onChange={(e) => setManualFrete(e.target.value)}
                    inputMode="decimal"
                    className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="text-xs text-white/60">Cupom/Desconto (R$)</span>
                  <input
                    value={manualCupom}
                    onChange={(e) => setManualCupom(e.target.value)}
                    inputMode="decimal"
                    className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none"
                  />
                </label>

                <label className="grid gap-1">
                  <span className="text-xs text-white/60">Preço proposto (MELI)</span>
                  <input
                    value={manualProposto}
                    onChange={(e) => setManualProposto(e.target.value)}
                    inputMode="decimal"
                    className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none"
                  />
                </label>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setManualOpen(false)}
                className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                onClick={addManualRow}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
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