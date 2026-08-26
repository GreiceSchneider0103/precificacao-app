"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  solvePOR,
  solveWithShopeeTiered as solveWithShopeeTieredBase,
  parseNumberPt,
  fmtPt,
  type Regime,
  type MoneyMode,
  type ShopeeTier,
} from "@/lib/pricing";

type ChannelKey = string;

type Product = { sku: string; name: string; cmv: number; updatedAt: string };

type ChannelConfig = {
  enabled: boolean;
  commissionPercent: number; taxFixed: number; mainTaxPercent: number;
  hasCredits: boolean; creditFretePercent: number; creditCommissionPercent: number; targetMarginPercent: number;
  pisCofinsPercent?: number;
  cardFeePercent?: number;
  influencerPercent?: number;
  incentiveCreditPercent?: number;
  meli?: { classicCommissionPercent: number; premiumCommissionPercent: number };
  shopee?: { mode: "flat" | "tiered"; tiers: ShopeeTier[] };
};

type Settings = { regime: Regime; ufOrigem: string; channels: Record<ChannelKey, ChannelConfig> };

type RawChannelData = {
  enabled?: boolean;
  commissionPercent?: number | string; taxFixed?: number | string; mainTaxPercent?: number | string;
  hasCredits?: boolean; creditFretePercent?: number | string; creditCommissionPercent?: number | string; targetMarginPercent?: number | string;
  pisCofinsPercent?: number | string;
  cardFeePercent?: number | string;
  influencerPercent?: number | string;
  incentiveCreditPercent?: number | string;
};

type RawRuleSet = {
  regime?: string; ufOrigem?: string; channels?: Record<string, RawChannelData>;
  meli?: { classicCommissionPercent?: number; premiumCommissionPercent?: number };
  shopeeTiers?: ShopeeTier[]; data?: RawRuleSet; isActive?: boolean;
};

type EmpresaRow = { id: string; name: string; isActive: boolean; data: RawRuleSet };

// Tipos derivados diretamente da assinatura real de lib/pricing.ts, para nunca
// divergirem do motor de cálculo oficial (single source of truth do algoritmo).
type SolvePORParams = Parameters<typeof solvePOR>[0];
type BreakdownResult = ReturnType<typeof solvePOR>;
type CalcResult = BreakdownResult & { channelUsed: SolvePORParams["channel"]; regimeUsed: Regime };

const STORAGE_PRODUCTS = "markup_products_v1";
const DRAFT_KEY = "markup_precificacao_draft_v1";

function normalizeSku(s: string) { return (s || "").trim().toUpperCase(); }

const CHANNEL_LABEL: Record<string, string> = { magalu: "Magalu", meli: "Mercado Livre", shopee: "Shopee", site: "Site", site_modifika: "Site Modifika", outros: "Outros", amazon: "Amazon", loja_fisica: "Loja Física" };
function channelLabel(key: string) { return CHANNEL_LABEL[key] || key; }

// Wrapper fino: delega a convergência de faixa da Shopee para lib/pricing.ts
// e só acrescenta o regime efetivamente usado, que a tela precisa exibir.
function solveWithShopeeTiered(params: SolvePORParams & { channelRaw: ChannelConfig }): CalcResult {
  return { ...solveWithShopeeTieredBase(params), regimeUsed: params.regime };
}

function useDebouncedDraftSaver(delayMs: number) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (key: string, data: unknown) => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => { try { localStorage.setItem(key, JSON.stringify(data)); } catch { /* ignore */ } }, delayMs);
  };
}

function mapRuleSetToSettings(rs: RawRuleSet): Settings {
  const base = rs || {};
  const regime: Regime = base.regime === "simples" ? "simples" : "normal";
  const mainTax = regime === "normal" ? 18 : 14;
  // site_modifika removido dos canais de venda: vai virar uma empresa própria.
  const keys: ChannelKey[] = ["magalu", "meli", "shopee", "site", "outros"];
  const channels: Record<ChannelKey, ChannelConfig> = {} as Record<ChannelKey, ChannelConfig>;
  for (const k of keys) {
    const inc: RawChannelData = (base.channels && base.channels[k]) || {};
    const mp = k !== "site" && k !== "site_modifika";
    const isModifika = k === "site_modifika";
    channels[k] = {
      enabled: inc.enabled !== false,
      commissionPercent: Number(inc.commissionPercent ?? (isModifika ? 1 : 0)),
      taxFixed: Number(inc.taxFixed ?? 0), 
      mainTaxPercent: Number(inc.mainTaxPercent ?? (isModifika ? 18 : mainTax)), 
      hasCredits: typeof inc.hasCredits === "boolean" ? inc.hasCredits : (k === "site_modifika" || mp), 
      creditFretePercent: Number(inc.creditFretePercent ?? (k === "site_modifika" ? 12 : (mp ? 21.25 : 0))), 
      creditCommissionPercent: Number(inc.creditCommissionPercent ?? (mp ? 9.25 : 0)), 
      targetMarginPercent: Number(inc.targetMarginPercent ?? (isModifika ? 15 : 10)),
      pisCofinsPercent: inc.pisCofinsPercent !== undefined ? Number(inc.pisCofinsPercent) : (isModifika ? 6 : undefined),
      cardFeePercent: inc.cardFeePercent !== undefined ? Number(inc.cardFeePercent) : (isModifika ? 10 : undefined),
      influencerPercent: inc.influencerPercent !== undefined ? Number(inc.influencerPercent) : (isModifika ? 5 : undefined),
      incentiveCreditPercent: inc.incentiveCreditPercent !== undefined ? Number(inc.incentiveCreditPercent) : (isModifika ? 2 : undefined),
    };
    if (k === "meli") channels[k].meli = { classicCommissionPercent: base.meli?.classicCommissionPercent ?? 11.5, premiumCommissionPercent: base.meli?.premiumCommissionPercent ?? 16.5 };
    if (k === "shopee") { const tiers = Array.isArray(base.shopeeTiers) ? base.shopeeTiers : []; channels[k].shopee = { mode: tiers.length ? "tiered" : "flat", tiers }; }
  }
  return { regime, ufOrigem: base.ufOrigem ?? "RS", channels };
}

function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="ml-1 inline-grid h-4 w-4 place-items-center rounded-full text-[11px] cursor-help select-none"
      style={{ background: "var(--surface-soft)", color: "var(--muted)" }}
      aria-label={text}
    >
      ⓘ
    </span>
  );
}

function Step({ n, label, children }: { n: number; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3.5">
      <div
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold"
        style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
      >
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>{label}</div>
        {children}
      </div>
    </div>
  );
}

export default function PrecificacaoPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaRow[]>([]);
  const [selectedEmpresaId, setSelectedEmpresaId] = useState<string>("");
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function showToast(type: "ok" | "err", text: string) { setToast({ type, text }); window.setTimeout(() => setToast(null), 1600); }

  const settings = useMemo((): Settings | null => {
    const emp = empresas.find((e) => e.id === selectedEmpresaId) ?? empresas[0];
    if (!emp) return null;
    return mapRuleSetToSettings(emp.data ?? emp);
  }, [empresas, selectedEmpresaId]);

  const [margemDirty, setMargemDirty] = useState(false);
  const [meliMode, setMeliMode] = useState<"classic" | "premium">("classic");
  const [magaluShipMode, setMagaluShipMode] = useState<"proprio" | "full">("proprio");
  const [query, setQuery] = useState("");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualMarkup, setManualMarkup] = useState("");
  const [manualCmv, setManualCmv] = useState("");
  const [channel, setChannel] = useState<ChannelKey>("magalu");
  const [frete, setFrete] = useState("40,00");
  const [operMode, setOperMode] = useState<MoneyMode>("fixed");
  const [operValue, setOperValue] = useState("0,00");
  const [adsMode, setAdsMode] = useState<MoneyMode>("fixed");
  const [adsValue, setAdsValue] = useState("0,00");
  const [margem, setMargem] = useState("20,00");
  const [cardFeeValue, setCardFeeValue] = useState("");
  const [influencerMode, setInfluencerMode] = useState<MoneyMode>("percent");
  const [influencerValue, setInfluencerValue] = useState("");
  const [incentiveCreditOverride, setIncentiveCreditOverride] = useState("");
  const [descontoMode, setDescontoMode] = useState<MoneyMode>("percent");
  const [descontoValue, setDescontoValue] = useState("0");
  const [rebateMode, setRebateMode] = useState<MoneyMode>("percent");
  const [rebateValue, setRebateValue] = useState("0");
  const [commissionOverride, setCommissionOverride] = useState("");
  const [taxOverride, setTaxOverride] = useState("");
  const [fixedOverride, setFixedOverride] = useState("");
  const [creditFreteOverride, setCreditFreteOverride] = useState("");
  const [creditComissaoOverride, setCreditComissaoOverride] = useState("");

  // Estados aplicados para cards que exigem confirmação manual
  const [appliedCustos, setAppliedCustos] = useState({
    operMode: "fixed" as MoneyMode,
    operValue: "0,00",
    adsMode: "fixed" as MoneyMode,
    adsValue: "0,00",
    cardFeeValue: "",
    influencerMode: "percent" as MoneyMode,
    influencerValue: "",
    descontoMode: "percent" as MoneyMode,
    descontoValue: "0",
    rebateMode: "percent" as MoneyMode,
    rebateValue: "0"
  });

  const [appliedAjustes, setAppliedAjustes] = useState({
    commissionOverride: "",
    taxOverride: "",
    fixedOverride: "",
    creditFreteOverride: "",
    creditComissaoOverride: "",
    incentiveCreditOverride: ""
  });

  const handleApplyCustos = () => setAppliedCustos({ operMode, operValue, adsMode, adsValue, cardFeeValue, influencerMode, influencerValue, descontoMode, descontoValue, rebateMode, rebateValue });
  const handleApplyAjustes = () => setAppliedAjustes({ commissionOverride, taxOverride, fixedOverride, creditFreteOverride, creditComissaoOverride, incentiveCreditOverride });

  // Troca de empresa não deve carregar ajustes especiais de outra empresa: zera tanto
  // os campos dos painéis quanto o que estava efetivamente aplicado ao cálculo.
  function resetAjustesEspeciais() {
    setOperMode("fixed"); setOperValue("0,00");
    setAdsMode("fixed"); setAdsValue("0,00");
    setCardFeeValue("");
    setInfluencerMode("percent"); setInfluencerValue("");
    setIncentiveCreditOverride("");
    setDescontoMode("percent"); setDescontoValue("0");
    setRebateMode("percent"); setRebateValue("0");
    setCommissionOverride(""); setTaxOverride(""); setFixedOverride("");
    setCreditFreteOverride(""); setCreditComissaoOverride("");
    setAppliedCustos({
      operMode: "fixed", operValue: "0,00",
      adsMode: "fixed", adsValue: "0,00",
      cardFeeValue: "",
      influencerMode: "percent", influencerValue: "",
      descontoMode: "percent", descontoValue: "0",
      rebateMode: "percent", rebateValue: "0",
    });
    setAppliedAjustes({
      commissionOverride: "", taxOverride: "", fixedOverride: "",
      creditFreteOverride: "", creditComissaoOverride: "", incentiveCreditOverride: "",
    });
  }

  const effectiveMarkup = manualMarkup.trim() ? parseNumberPt(manualMarkup) : 3.7;

  // ✅ FIX 1: margem por canal via useMemo derivado — sem setState em useEffect
  const margemDefault = useMemo(() => {
    if (!settings) return "20,00";
    const ch = settings.channels[channel];
    return String(typeof ch?.targetMarginPercent === "number" ? ch.targetMarginPercent : 10).replace(".", ",");
  }, [settings, channel]);

  const margemEfetiva = margemDirty ? margem : margemDefault;

  // ✅ FIX 2: canal efetivo via useMemo — sem setState em useEffect
  const availableChannels = useMemo(() => {
    if (!settings) return ["magalu", "meli", "shopee"];
    const enabled = Object.keys(settings.channels).filter((k) => settings.channels[k].enabled);
    return enabled.length > 0 ? enabled : Object.keys(settings.channels);
  }, [settings]);

  const effectiveChannel: ChannelKey = useMemo(() => {
    if (settings && !settings.channels[channel] && availableChannels.length > 0) return availableChannels[0];
    return channel;
  }, [settings, channel, availableChannels]);

  // Sync state apenas quando effectiveChannel diverge por indisponibilidade
  useEffect(() => {
    if (effectiveChannel !== channel) { setChannel(effectiveChannel); setMargemDirty(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveChannel]);

  useEffect(() => {
    // Produtos
    (async () => {
      const res = await fetch("/api/products", { cache: "no-store" });
      if (!res.ok) { const raw = localStorage.getItem(STORAGE_PRODUCTS); if (raw) setProducts(JSON.parse(raw) as Product[]); return; }
      const data = await res.json() as { products?: Record<string, unknown>[] };
      setProducts((data.products || []).map((p) => ({ sku: String(p.sku ?? "").trim().toUpperCase(), name: String(p.name ?? "").trim(), cmv: Number(p.cmv ?? 0), updatedAt: String(p.updatedAt ?? new Date().toISOString()) })));
    })();
    // Empresas (rulesets)
    (async () => {
      try {
        const res = await fetch("/api/settings/rulesets");
        if (res.ok) {
          const j = await res.json() as { rulesets?: EmpresaRow[] };
          const list = j?.rulesets ?? [];
          setEmpresas(list);
          setSelectedEmpresaId((prev) => (prev && list.some((e) => e.id === prev)) ? prev : (list.find((e) => e.isActive)?.id ?? list[0]?.id ?? ""));
        }
      } catch { /* sem empresas carregadas — a tela mostra o aviso de Configurações pendente */ }
    })();
    // Draft
    try {
      const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return;
      const d = JSON.parse(raw) as Record<string, string>;
      if (d.selectedEmpresaId) setSelectedEmpresaId(d.selectedEmpresaId);
      if (d.query) setQuery(d.query); if (d.selectedSku) setSelectedSku(d.selectedSku);
      if (d.manualName) setManualName(d.manualName); if (d.manualCmv) setManualCmv(d.manualCmv);
      if (d.manualMarkup) setManualMarkup(d.manualMarkup);
      if (d.channel) setChannel(d.channel);
      if (d.meliMode === "classic" || d.meliMode === "premium") setMeliMode(d.meliMode);
      if (d.magaluShipMode === "proprio" || d.magaluShipMode === "full") setMagaluShipMode(d.magaluShipMode);
      if (d.frete) setFrete(d.frete); if (d.margem) { setMargem(d.margem); setMargemDirty(true); }
      if (d.operMode === "fixed" || d.operMode === "percent") setOperMode(d.operMode);
      if (d.operValue) setOperValue(d.operValue);
      if (d.adsMode === "fixed" || d.adsMode === "percent") setAdsMode(d.adsMode);
      if (d.adsValue) setAdsValue(d.adsValue);
      if (d.cardFeeValue) setCardFeeValue(d.cardFeeValue);
      if (d.influencerMode) setInfluencerMode(d.influencerMode as MoneyMode);
      if (d.influencerValue) setInfluencerValue(d.influencerValue);
      if (d.incentiveCreditOverride) setIncentiveCreditOverride(d.incentiveCreditOverride);
      if (d.descontoMode === "fixed" || d.descontoMode === "percent") setDescontoMode(d.descontoMode);
      if (d.descontoValue) setDescontoValue(d.descontoValue);
      if (d.rebateMode === "fixed" || d.rebateMode === "percent") setRebateMode(d.rebateMode);
      if (d.rebateValue) setRebateValue(d.rebateValue);
      if (d.commissionOverride) setCommissionOverride(d.commissionOverride); if (d.taxOverride) setTaxOverride(d.taxOverride);
      if (d.fixedOverride) setFixedOverride(d.fixedOverride); if (d.creditFreteOverride) setCreditFreteOverride(d.creditFreteOverride);
      if (d.creditComissaoOverride) setCreditComissaoOverride(d.creditComissaoOverride);

      // Sincroniza estados aplicados com o rascunho carregado
      setAppliedCustos({
        operMode: (d.operMode as MoneyMode) || "fixed",
        operValue: d.operValue || "0,00",
        adsMode: (d.adsMode as MoneyMode) || "fixed",
        adsValue: d.adsValue || "0,00",
        cardFeeValue: d.cardFeeValue || "",
        influencerMode: (d.influencerMode as MoneyMode) || "percent",
        influencerValue: d.influencerValue || "",
        descontoMode: (d.descontoMode as MoneyMode) || "percent",
        descontoValue: d.descontoValue || "0",
        rebateMode: (d.rebateMode as MoneyMode) || "percent",
        rebateValue: d.rebateValue || "0"
      });
      setAppliedAjustes({
        commissionOverride: d.commissionOverride || "", taxOverride: d.taxOverride || "", fixedOverride: d.fixedOverride || "",
        creditFreteOverride: d.creditFreteOverride || "", creditComissaoOverride: d.creditComissaoOverride || "", incentiveCreditOverride: d.incentiveCreditOverride || ""
      });
    } catch (e) { console.error("draft", e); }
  }, []);

  const saveDraftDebounced = useDebouncedDraftSaver(250);
  useEffect(() => {
    saveDraftDebounced(DRAFT_KEY, { selectedEmpresaId, query, selectedSku, manualName, manualCmv, channel, meliMode, magaluShipMode, frete, margem, operMode, operValue, adsMode, adsValue, cardFeeValue, influencerMode, influencerValue, incentiveCreditOverride, descontoMode, descontoValue, rebateMode, rebateValue, commissionOverride, taxOverride, fixedOverride, creditFreteOverride, creditComissaoOverride });
  }, [selectedEmpresaId, query, selectedSku, manualName, manualCmv, channel, meliMode, magaluShipMode, frete, margem, operMode, operValue, adsMode, adsValue, cardFeeValue, influencerMode, influencerValue, incentiveCreditOverride, descontoMode, descontoValue, rebateMode, rebateValue, commissionOverride, taxOverride, fixedOverride, creditFreteOverride, creditComissaoOverride, saveDraftDebounced]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 10);
    return products.filter((p) => normalizeSku(p.sku).toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 10);
  }, [products, query]);

  const picked = useMemo(() => { if (!selectedSku) return null; const s = normalizeSku(selectedSku); return products.find((p) => normalizeSku(p.sku) === s) || null; }, [products, selectedSku]);

  const effectiveCmv = picked ? picked.cmv : parseNumberPt(manualCmv);

  // ✅ FIX 3: recalcTick removido do useMemo (era desnecessário — useMemo não observa estado arbitrário)
  const result = useMemo((): CalcResult | null => {
    if (!settings || !effectiveCmv || effectiveCmv <= 0) return null;
    const baseCh = settings.channels[effectiveChannel]; if (!baseCh) return null;
    const regimeFinal: Regime = settings.regime;
    const mainTaxPercent = appliedAjustes.taxOverride.trim() ? parseNumberPt(appliedAjustes.taxOverride) : baseCh.mainTaxPercent;
    let commissionPercent = baseCh.commissionPercent;
    if (effectiveChannel === "meli" && baseCh.meli) commissionPercent = meliMode === "premium" ? baseCh.meli.premiumCommissionPercent : baseCh.meli.classicCommissionPercent;
    if (appliedAjustes.commissionOverride.trim()) commissionPercent = parseNumberPt(appliedAjustes.commissionOverride);
    const taxFixed = appliedAjustes.fixedOverride.trim() ? parseNumberPt(appliedAjustes.fixedOverride) : baseCh.taxFixed;
    const creditFreteBase = appliedAjustes.creditFreteOverride.trim() ? parseNumberPt(appliedAjustes.creditFreteOverride) : baseCh.creditFretePercent;
    const creditFretePercent = effectiveChannel === "magalu" && magaluShipMode === "full" ? 0 : creditFreteBase;
    const creditCommissionPercent = appliedAjustes.creditComissaoOverride.trim() ? parseNumberPt(appliedAjustes.creditComissaoOverride) : baseCh.creditCommissionPercent;
    const ch = { commissionPercent, taxFixed, mainTaxPercent, hasCredits: baseCh.hasCredits, creditFretePercent, creditCommissionPercent, pisCofinsPercent: baseCh.pisCofinsPercent, cardFeePercent: baseCh.cardFeePercent, influencerPercent: baseCh.influencerPercent, incentiveCreditPercent: baseCh.incentiveCreditPercent };
    const common: SolvePORParams = { 
      cmv: effectiveCmv, markupBase: effectiveMarkup, frete: parseNumberPt(frete), 
      operMode: appliedCustos.operMode, operValue: parseNumberPt(appliedCustos.operValue), 
      adsMode: appliedCustos.adsMode, adsValue: parseNumberPt(appliedCustos.adsValue), 
      margemAlvoPercent: parseNumberPt(margemEfetiva) || (baseCh.targetMarginPercent ?? 20), channel: ch, regime: regimeFinal, 
      rebateMode: appliedCustos.rebateMode, rebateValue: parseNumberPt(appliedCustos.rebateValue), 
      descontoMode: appliedCustos.descontoMode, descontoValue: parseNumberPt(appliedCustos.descontoValue),
      cardFeePercent: appliedCustos.cardFeeValue.trim() ? parseNumberPt(appliedCustos.cardFeeValue) : undefined,
      influencerMode: appliedCustos.influencerMode, influencerValue: appliedCustos.influencerValue.trim() ? parseNumberPt(appliedCustos.influencerValue) : undefined,
      incentiveCreditPercent: appliedAjustes.incentiveCreditOverride.trim() ? parseNumberPt(appliedAjustes.incentiveCreditOverride) : undefined
    };
    if (effectiveChannel === "shopee" && !appliedAjustes.commissionOverride.trim() && !appliedAjustes.taxOverride.trim() && !appliedAjustes.fixedOverride.trim() && baseCh.shopee?.mode === "tiered") return solveWithShopeeTiered({ ...common, channelRaw: baseCh });
    return { ...solvePOR(common), channelUsed: ch, regimeUsed: regimeFinal };
  }, [settings, effectiveCmv, effectiveMarkup, effectiveChannel, meliMode, magaluShipMode, frete, margemEfetiva, appliedCustos, appliedAjustes]);

  const alerts = useMemo(() => {
    if (!result) return [];
    const list: { type: "warn" | "bad"; text: string }[] = [];
    const alvo = parseNumberPt(margemEfetiva);
    if (result.breakdown.margemPct < 0) list.push({ type: "bad", text: "Prejuízo: margem negativa." });
    if (result.breakdown.margemPct + 0.01 < alvo) list.push({ type: "warn", text: "Margem abaixo da meta." });
    if (result.POR_sugerido < effectiveCmv) list.push({ type: "bad", text: "POR abaixo do CMV." });
    if (appliedAjustes.commissionOverride.trim() || appliedAjustes.taxOverride.trim() || appliedAjustes.fixedOverride.trim()) list.push({ type: "warn", text: "Ajustes especiais ativos" });
    return list;
  }, [result, margemEfetiva, effectiveCmv, appliedAjustes]);

  async function copyPorToClipboard() {
    if (!result) return;
    try { await navigator.clipboard.writeText(fmtPt(result.POR_sugerido)); showToast("ok", "Preço POR copiado."); }
    catch { showToast("err", "Não consegui copiar."); }
  }

  return (
    <div className="space-y-7">
      {empresas.length === 0 && (
        <div className="rounded-2xl border p-5 text-sm" style={{ borderColor: "var(--warn-soft)", background: "var(--warn-soft)", color: "var(--warn)" }}>
          Ainda não encontrei nenhuma empresa cadastrada. Vá em <b>Configurações</b>, cadastre uma empresa e volte aqui.
        </div>
      )}

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
      {/* COLUNA ESQUERDA — formulário */}
      <div className="max-w-2xl space-y-7">

      {/* PASSO 1 — EMPRESA */}
      <Step n={1} label="Empresa">
        <select
          value={selectedEmpresaId}
          onChange={(e) => { setSelectedEmpresaId(e.target.value); setMargemDirty(false); resetAjustesEspeciais(); }}
          className="w-full rounded-xl border px-3.5 py-3 text-sm outline-none"
          style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
        >
          {empresas.length === 0 && <option value="">Nenhuma empresa cadastrada</option>}
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        {settings && (
          <p className="mt-1.5 text-[12px]" style={{ color: "var(--muted)" }}>
            {settings.regime === "normal" ? `Regime Normal · imposto ${settings.channels[availableChannels[0]]?.mainTaxPercent ?? 18}%` : "Simples Nacional · imposto 14%"} · UF {settings.ufOrigem}
          </p>
        )}
      </Step>

      {/* PASSO 2 — PRODUTO */}
      <Step n={2} label="Produto">
        <div className="relative">
          <div className="flex items-center gap-2.5 rounded-xl border px-3.5 py-3" style={{ background: "var(--surface)", borderColor: picked ? "var(--accent-soft-border)" : "var(--border)" }}>
            <svg width="16" height="16" viewBox="0 0 20 20" style={{ stroke: "var(--muted)", flexShrink: 0 }} fill="none" strokeWidth="1.6" strokeLinecap="round">
              <circle cx="8.6" cy="8.6" r="5.4" /><path d="M16.8 16.8l-3.9-3.9" />
            </svg>
            {picked ? (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>{picked.name}</p>
                  <p className="text-[12px]" style={{ color: "var(--muted)" }}>SKU: {picked.sku} · CMV R$ {fmtPt(picked.cmv)}</p>
                </div>
                <button type="button" onClick={() => { setSelectedSku(null); setQuery(""); }} className="shrink-0 text-[12px] font-semibold" style={{ color: "var(--accent)" }}>trocar</button>
              </>
            ) : (
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) setSelectedSku(null); }}
                placeholder="Buscar produto cadastrado por SKU ou nome..."
                className="w-full bg-transparent text-sm outline-none"
                style={{ color: "var(--text)" }}
              />
            )}
          </div>

          {!!query.trim() && !selectedSku && (
            <div className="absolute top-[calc(100%+6px)] left-0 right-0 z-50 rounded-xl border p-2 shadow-lg" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <p className="px-2 pb-2 text-[10px] font-bold uppercase" style={{ color: "var(--muted)" }}>Sugestões</p>
              <div className="grid max-h-60 gap-1.5 overflow-y-auto">
                {filteredProducts.length ? filteredProducts.map((p) => (
                  <button
                    key={p.sku}
                    type="button"
                    onClick={() => { setSelectedSku(p.sku); setQuery(p.name); }}
                    className="flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left"
                    style={{ background: "var(--surface-soft)" }}
                  >
                    <div><p className="text-sm font-semibold">{p.name}</p><p className="text-xs" style={{ color: "var(--muted)" }}>SKU: {p.sku} · CMV R$ {fmtPt(p.cmv)}</p></div>
                    <span className="rounded-md px-2 py-1 text-[10px]" style={{ background: "var(--surface)", color: "var(--muted)" }}>Selecionar</span>
                  </button>
                )) : <div className="px-3 py-3 text-sm" style={{ color: "var(--muted)" }}>Nenhum produto encontrado.</div>}
              </div>
            </div>
          )}

          {!picked && (
            <div className="mt-3 grid gap-3 rounded-xl border p-4 md:grid-cols-2" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <label className="grid gap-1">
                <span className="text-xs" style={{ color: "var(--muted)" }}>Markup desejado (DE)<InfoTip text="Multiplicador do CMV para o preço DE. Padrão: 3,7" /></span>
                <input value={manualMarkup} onChange={(e) => setManualMarkup(e.target.value)} inputMode="decimal" placeholder="ex: 3,7" className="rounded-lg border px-3.5 py-2.5 text-sm outline-none" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs" style={{ color: "var(--muted)" }}>CMV (R$) <span style={{ color: "var(--crit)" }}>*</span></span>
                <input value={manualCmv} onChange={(e) => setManualCmv(e.target.value)} inputMode="decimal" placeholder="ex: 189,90" className="rounded-lg border px-3.5 py-2.5 text-sm outline-none" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }} />
              </label>
              {parseNumberPt(manualCmv) > 0 && <p className="text-xs md:col-span-2" style={{ color: "var(--good)" }}>CMV: R$ {fmtPt(parseNumberPt(manualCmv))} — pronto para calcular.</p>}
            </div>
          )}
        </div>
      </Step>

      {/* PASSO 3 — CANAL */}
      <Step n={3} label="Canal de venda">
        <div className="flex flex-wrap gap-2">
          {availableChannels.map((k) => {
            const active = effectiveChannel === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => { setChannel(k); setMargemDirty(false); }}
                className="rounded-full px-4 py-2 text-[13px] font-semibold"
                style={active ? { background: "var(--accent)", color: "var(--accent-ink)" } : { background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)" }}
              >
                {channelLabel(k)}
              </button>
            );
          })}
        </div>

        {effectiveChannel === "meli" && (
          <div className="mt-3 flex items-center gap-2.5">
            <span className="text-xs" style={{ color: "var(--muted)" }}>Anúncio:</span>
            {(["classic", "premium"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMeliMode(m)}
                className="rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold"
                style={meliMode === m ? { background: "var(--surface-soft)", color: "var(--text)" } : { color: "var(--muted)" }}
              >
                {m === "classic" ? "Clássico" : "Premium"}
              </button>
            ))}
          </div>
        )}
      </Step>

      {/* PASSO 4 — CUSTOS E MARGEM */}
      <Step n={4} label="Custos e margem">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-xs" style={{ color: "var(--muted)" }}>Frete (R$)<InfoTip text="Frete fixo estimado." /></span>
            <input value={frete} onChange={(e) => setFrete(e.target.value)} inputMode="decimal" className="rounded-lg border px-3.5 py-2.5 text-sm outline-none" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }} />
          </label>
          <label className="grid gap-1">
            <span className="text-xs" style={{ color: "var(--muted)" }}>Margem alvo (%)<InfoTip text="Ao trocar canal, volta para o padrão. Se digitar, fica travada." /></span>
            <input value={margemEfetiva} onChange={(e) => { setMargem(e.target.value); setMargemDirty(true); }} inputMode="decimal" className="rounded-lg border px-3.5 py-2.5 text-sm outline-none" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }} />
          </label>
        </div>

        <div className="mt-3 grid gap-2.5">
          <Accordion title="Custos, ads, desconto e rebate" subtitle="Ajuste somente quando necessário.">
            <div className="grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between"><p className="text-[13px] font-semibold">Custos operacionais</p><ModeToggle value={operMode} onChange={setOperMode} /></div>
                  <input value={operValue} onChange={(e) => setOperValue(e.target.value)} inputMode="decimal" placeholder={operMode === "percent" ? "ex: 2,5" : "ex: 12,00"} className="mt-2.5 w-full rounded-lg border px-3 py-2 text-sm outline-none" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }} />
                </div>
                <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--border)" }}>
                  <p className="mb-2.5 text-[13px] font-semibold">Taxa cartão (%)</p>
                  <input value={cardFeeValue} onChange={(e) => setCardFeeValue(e.target.value)} inputMode="decimal" placeholder="Usa padrão do canal" className="w-full rounded-lg border px-3 py-2 text-sm outline-none" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between"><p className="text-[13px] font-semibold">Ads</p><ModeToggle value={adsMode} onChange={setAdsMode} /></div>
                  <input value={adsValue} onChange={(e) => setAdsValue(e.target.value)} inputMode="decimal" placeholder={adsMode === "percent" ? "ex: 3" : "ex: 25,00"} className="mt-2.5 w-full rounded-lg border px-3 py-2 text-sm outline-none" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }} />
                </div>
                <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between"><p className="text-[13px] font-semibold">Influencer</p><ModeToggle value={influencerMode} onChange={setInfluencerMode} percentFirst /></div>
                  <input value={influencerValue} onChange={(e) => setInfluencerValue(e.target.value)} inputMode="decimal" placeholder={influencerMode === "percent" ? "ex: 5" : "ex: 50,00"} className="mt-2.5 w-full rounded-lg border px-3 py-2 text-sm outline-none" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }} />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--border)" }}>
                  <p className="mb-2.5 text-[13px] font-semibold">Desconto/Cupom</p>
                  <ModeToggle value={descontoMode} onChange={setDescontoMode} percentFirst />
                  <input value={descontoValue} onChange={(e) => setDescontoValue(e.target.value)} inputMode="decimal" className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }} />
                </div>
                <div className="rounded-xl border p-3.5" style={{ borderColor: "var(--border)" }}>
                  <p className="mb-2.5 text-[13px] font-semibold">Rebate</p>
                  <ModeToggle value={rebateMode} onChange={setRebateMode} percentFirst />
                  <input value={rebateValue} onChange={(e) => setRebateValue(e.target.value)} inputMode="decimal" className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }} />
                </div>
              </div>
              <button type="button" onClick={handleApplyCustos} className="w-full rounded-full py-2.5 text-sm font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Aplicar mudanças</button>
            </div>
          </Accordion>

          <Accordion title="Ajustes rápidos" subtitle="Deixe vazio para usar o padrão.">
            <div className="grid gap-3 md:grid-cols-2">
              <SmallInput label="Comissão (%)" value={commissionOverride} onChange={setCommissionOverride} />
              <SmallInput label="Imposto (%)" value={taxOverride} onChange={setTaxOverride} />
              <SmallInput label="Taxa fixa (R$)" value={fixedOverride} onChange={setFixedOverride} />
              <SmallInput label="Crédito frete (%)" value={creditFreteOverride} onChange={setCreditFreteOverride} />
              <SmallInput label="Crédito comissão (%)" value={creditComissaoOverride} onChange={setCreditComissaoOverride} />
              <SmallInput label="Crédito incentivo (%)" value={incentiveCreditOverride} onChange={setIncentiveCreditOverride} />
              <div className="md:col-span-2">
                <button type="button" onClick={handleApplyAjustes} className="w-full rounded-full py-2.5 text-sm font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>Aplicar ajustes</button>
              </div>
            </div>
          </Accordion>
        </div>
      </Step>

      </div>
      {/* fim coluna esquerda */}

      {/* COLUNA DIREITA — resultado, fixo ao rolar */}
      <div className="space-y-4 lg:sticky lg:top-6">
      {/* RESULTADO */}
      {!result ? (
        <div className="rounded-2xl border p-5 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}>
          {!settings ? "Cadastre uma empresa em Configurações antes de calcular." : (!effectiveCmv || effectiveCmv <= 0) ? "Informe o CMV do produto (manual ou cadastrado)." : "Informe um CMV válido para calcular."}
        </div>
      ) : (
        <>
          {alerts.length > 0 && (
            <div className="space-y-2">
              {alerts.map((a, i) => (
                <div
                  key={i}
                  className="rounded-xl border px-4 py-2.5 text-sm"
                  style={a.type === "bad" ? { borderColor: "var(--crit-soft)", background: "var(--crit-soft)", color: "var(--crit)" } : { borderColor: "var(--warn-soft)", background: "var(--warn-soft)", color: "var(--warn)" }}
                >
                  {a.text}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-[22px] border p-6 shadow-sm sm:p-7" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-[13px]" style={{ color: "var(--muted)" }}>Vender por</p>
                <div className="flex items-center gap-2.5">
                  <p className="text-[42px] font-semibold leading-none" style={{ fontFamily: "var(--font-serif), serif" }}>R$ {fmtPt(result.POR_sugerido)}</p>
                  <button
                    type="button"
                    onClick={copyPorToClipboard}
                    title="Copiar preço"
                    aria-label="Copiar preço"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                  >
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="7" y="7" width="9.5" height="9.5" rx="1.4" />
                      <path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-8A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14H6" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[13px] line-through" style={{ color: "var(--muted)" }}>De R$ {fmtPt(result.precoDE)}</p>
                <span className="mt-1 inline-block rounded-full px-3 py-1 text-[12.5px] font-semibold" style={{ background: "var(--good-soft)", color: "var(--good)" }}>
                  {result.breakdown.margemPct.toFixed(2)}% de margem
                </span>
              </div>
            </div>

            <div className="my-5 h-px" style={{ background: "var(--border)" }} />

            <div className="rounded-xl p-4 text-sm" style={{ background: "var(--accent-soft)" }}>
              <p className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--accent)" }}>
                Para atingir {parseNumberPt(margemEfetiva).toFixed(2)}% de margem
              </p>
              <p className="mt-1.5" style={{ color: "var(--text)" }}>
                Desconto sugerido sobre o preço DE: <b>{result.descontoNecessarioPct.toFixed(2)}%</b> (R$ {fmtPt(result.descontoNecessarioR$)})
              </p>
            </div>

            <div className="mt-5 grid gap-y-2 text-[13px]">
              {result.breakdown.comissao >= 0.005 && <Row label={`${effectiveChannel === 'site_modifika' ? 'Taxa Marketplace' : 'Comissão'} (${result.channelUsed.commissionPercent.toFixed(2)}%)`} value={`R$ ${fmtPt(result.breakdown.comissao)}`} />}
              {result.breakdown.imposto >= 0.005 && <Row label={`Imposto (${result.channelUsed.mainTaxPercent.toFixed(2)}%)`} value={`R$ ${fmtPt(result.breakdown.imposto)}`} />}
              {result.breakdown.pisCofins >= 0.005 && <Row label={`PIS/COFINS ${result.regimeUsed === "normal" ? `(${(result.channelUsed.pisCofinsPercent ?? 9.25).toString().replace(".", ",")}%)` : "(não aplica)"}`} value={`R$ ${fmtPt(result.breakdown.pisCofins)}`} />}
              {result.breakdown.taxaFixa >= 0.005 && <Row label="Taxa fixa canal" value={`R$ ${fmtPt(result.breakdown.taxaFixa)}`} />}
              <Row label="Frete" value={`R$ ${fmtPt(result.breakdown.frete)}`} />
              <Row label="CMV" value={`R$ ${fmtPt(result.breakdown.cmv)}`} />
              {result.breakdown.operacionais >= 0.005 && <Row label="Custos operacionais" value={`R$ ${fmtPt(result.breakdown.operacionais)}`} />}
              {result.breakdown.ads >= 0.005 && <Row label="Ads" value={`R$ ${fmtPt(result.breakdown.ads)}`} />}
              {result.breakdown.taxaCartao >= 0.005 && <Row label="Taxa de Cartão" value={`R$ ${fmtPt(result.breakdown.taxaCartao)}`} />}
              {result.breakdown.influencer >= 0.005 && <Row label="Influencer" value={`R$ ${fmtPt(result.breakdown.influencer)}`} />}
              {result.breakdown.creditoFrete >= 0.005 && <Row label="Crédito de frete" value={`R$ ${fmtPt(result.breakdown.creditoFrete)}`} />}
              {result.breakdown.creditoComissao >= 0.005 && <Row label="Crédito de comissão" value={`R$ ${fmtPt(result.breakdown.creditoComissao)}`} />}
              {result.breakdown.creditoIncentivo >= 0.005 && <Row label="Crédito Incentivo" value={`R$ ${fmtPt(result.breakdown.creditoIncentivo)}`} />}
              {result.breakdown.rebate !== 0 && <Row label="Rebate" value={`R$ ${fmtPt(result.breakdown.rebate)}`} />}
            </div>

            <div className="my-5 h-px" style={{ background: "var(--border)" }} />

            <div className="flex items-center justify-between">
              <span className="text-[14.5px] font-semibold">Margem de contribuição</span>
              <span className="text-[19px] font-semibold" style={{ fontFamily: "var(--font-serif), serif", color: "var(--good)" }}>R$ {fmtPt(result.breakdown.margemContrib)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[13px]" style={{ color: "var(--muted)" }}>
              <span>Receita líquida</span>
              <span className="tabular-nums font-medium" style={{ color: "var(--text)" }}>R$ {fmtPt(result.breakdown.receitaLiquida)}</span>
            </div>
          </div>
        </>
      )}
      </div>
      {/* fim coluna direita */}
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50">
          <div
            className="rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg"
            style={toast.type === "ok" ? { borderColor: "var(--good-soft)", background: "var(--good-soft)", color: "var(--good)" } : { borderColor: "var(--crit-soft)", background: "var(--crit-soft)", color: "var(--crit)" }}
          >
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span style={strong ? { fontWeight: 600, color: "var(--text)" } : { color: "var(--muted)" }}>{label}</span>
      <span className="tabular-nums" style={strong ? { fontWeight: 600, color: "var(--text)" } : { color: "var(--text)" }}>{value}</span>
    </div>
  );
}

function SmallInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px]" style={{ color: "var(--muted)" }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        className="h-9 rounded-lg border px-3 text-sm outline-none"
        style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
      />
    </label>
  );
}

function ModeToggle({ value, onChange, percentFirst = false }: { value: MoneyMode; onChange: (v: MoneyMode) => void; percentFirst?: boolean }) {
  const opts: MoneyMode[] = percentFirst ? ["percent", "fixed"] : ["fixed", "percent"];
  return (
    <div className="flex gap-1.5">
      {opts.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className="rounded-md px-2.5 py-1 text-[11px] font-semibold"
          style={value === m ? { background: "var(--surface-soft)", color: "var(--text)" } : { color: "var(--muted)" }}
        >
          {m === "percent" ? "%" : "R$"}
        </button>
      ))}
    </div>
  );
}

function Accordion({ title, subtitle, defaultOpen = false, children }: { title: string; subtitle?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--border)" }}>
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left">
        <div>
          <p className="text-[13.5px] font-semibold">{title}</p>
          {subtitle && <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--muted)" }}>{subtitle}</p>}
        </div>
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full transition-transform"
          style={{ background: "var(--surface-soft)", transform: open ? "rotate(180deg)" : undefined }}
          aria-hidden
        >
          <svg width="14" height="14" viewBox="0 0 24 24" style={{ color: "var(--muted)" }}><path fill="currentColor" d="M7 10l5 5 5-5z" /></svg>
        </span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
