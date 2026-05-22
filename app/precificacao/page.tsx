"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ChannelKey = string;
type Regime = "simples" | "normal";
type MoneyMode = "percent" | "fixed";

type Product = { sku: string; name: string; cmv: number; updatedAt: string };

type ShopeeTier = { min: number; max: number | null; commissionPercent: number; taxFixed: number };

type Coupon = { id: string; name: string; code: string; discountMode: "percent" | "fixed"; discountValue: number; isActive: boolean };

type ChannelConfig = {
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

type SolvePORParams = {
  cmv: number; markupBase: number; frete: number;
  operMode: MoneyMode; operValue: number; adsMode: MoneyMode; adsValue: number;
  margemAlvoPercent: number;
  channel: { commissionPercent: number; taxFixed: number; mainTaxPercent: number; hasCredits: boolean; creditFretePercent: number; creditCommissionPercent: number; pisCofinsPercent?: number; cardFeePercent?: number; influencerPercent?: number; incentiveCreditPercent?: number };
  regime: Regime; rebateMode: MoneyMode; rebateValue: number; descontoMode: MoneyMode; descontoValue: number;
  cardFeePercent?: number;
  influencerMode?: MoneyMode;
  influencerValue?: number;
  incentiveCreditPercent?: number;
};

type BreakdownResult = {
  POR_sugerido: number; precoDE: number; descontoNecessarioPct: number; descontoNecessarioR$: number;
  breakdown: { comissao: number; imposto: number; pisCofins: number; taxaFixa: number; frete: number; cmv: number; operacionais: number; ads: number; taxaCartao: number; influencer: number; creditoFrete: number; creditoComissao: number; creditoIncentivo: number; rebate: number; margemContrib: number; margemPct: number; receitaLiquida: number };
};

type CalcResult = BreakdownResult & { channelUsed: SolvePORParams["channel"]; regimeUsed: Regime };

const STORAGE_PRODUCTS = "markup_products_v1";
const STORAGE_HISTORY = "markup_price_history_v1";
const DRAFT_KEY = "markup_precificacao_draft_v1";

function normalizeSku(s: string) { return (s || "").trim().toUpperCase(); }

const CHANNEL_LABEL: Record<string, string> = { magalu: "Magalu", meli: "Mercado Livre", shopee: "Shopee", site: "Site", site_modifika: "Site Modifika", amazon: "Amazon", loja_fisica: "Loja Física" };
function channelLabel(key: string) { return CHANNEL_LABEL[key] || key; }

function parseNumberPt(raw: unknown) {
  const cleaned = String(raw ?? "").trim().replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function fmtPt(n: number) { return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

function pickShopeeTier(sh: { tiers: ShopeeTier[] } | undefined, price: number): ShopeeTier {
  const tiers = sh?.tiers || [];
  for (const t of tiers) { if (price >= t.min && (t.max == null || price <= t.max)) return t; }
  return tiers[tiers.length - 1] || { min: 0, max: null, commissionPercent: 14, taxFixed: 26 };
}

function solvePOR(params: SolvePORParams): BreakdownResult {
  const { cmv, markupBase, frete, operMode, operValue, adsMode, adsValue, margemAlvoPercent, channel, regime, rebateMode, rebateValue } = params;
  const m = clamp(margemAlvoPercent / 100, 0, 0.95);
  const pVal = (channel.pisCofinsPercent ?? (regime === "normal" ? 9.25 : 0)) / 100;
  const porPago = (() => {
    const c = channel.commissionPercent / 100, t = channel.mainTaxPercent / 100;
    const pisCoeff = regime === "normal" ? pVal * (1 - t) : 0;
    const operCoeff = operMode === "percent" ? operValue / 100 : 0, adsCoeff = adsMode === "percent" ? adsValue / 100 : 0;
    const operFixed = operMode === "fixed" ? operValue : 0, adsFixed = adsMode === "fixed" ? adsValue : 0;
    const cardFeeCoeff = (channel.cardFeePercent ?? 0) / 100;
    const influencerCoeff = (channel.influencerPercent ?? 0) / 100;
    const credFrete = regime === "normal" && channel.hasCredits ? frete * (channel.creditFretePercent / 100) : 0;
    const credComissaoCoeff = regime === "normal" && channel.hasCredits ? c * (channel.creditCommissionPercent / 100) : 0;
    const credIncentivoCoeff = regime === "normal" ? (channel.incentiveCreditPercent ?? 0) / 100 : 0;
    const rebateFixed = rebateMode === "fixed" ? rebateValue : 0, rebateCoeff = rebateMode === "percent" ? rebateValue / 100 : 0;
    const leftCoeff = 1 - c - t - pisCoeff - operCoeff - adsCoeff - cardFeeCoeff - influencerCoeff + credComissaoCoeff + credIncentivoCoeff + rebateCoeff - m;
    const right = channel.taxFixed + frete + cmv + operFixed + adsFixed - credFrete - rebateFixed;
    if (leftCoeff <= 0.000001) return 0;
    return right / leftCoeff;
  })();
  const comissaoVal = porPago * (channel.commissionPercent / 100);
  const impostoVal = porPago * (channel.mainTaxPercent / 100);
  const pisVal = regime === "normal" ? pVal * (porPago - impostoVal) : 0;
  const operR$ = operMode === "percent" ? porPago * (operValue / 100) : operValue;
  const adsR$ = adsMode === "percent" ? porPago * (adsValue / 100) : adsValue;
  const cardFeeR$ = porPago * ((channel.cardFeePercent ?? 0) / 100);
  const influencerR$ = porPago * ((channel.influencerPercent ?? 0) / 100);
  const credFrete = regime === "normal" && channel.hasCredits ? frete * (channel.creditFretePercent / 100) : 0;
  const credComissao = regime === "normal" && channel.hasCredits ? comissaoVal * (channel.creditCommissionPercent / 100) : 0;
  const credIncentivo = regime === "normal" ? porPago * ((channel.incentiveCreditPercent ?? 0) / 100) : 0;
  const rebateVal = rebateMode === "percent" ? porPago * (rebateValue / 100) : rebateValue;
  const mc = porPago - comissaoVal - impostoVal - pisVal - channel.taxFixed - frete - cmv - operR$ - adsR$ - cardFeeR$ - influencerR$ + credFrete + credComissao + credIncentivo + rebateVal;
  const precoDE = cmv * markupBase;
  let porLista = porPago;
  if (params.descontoMode === "percent") { const pct = params.descontoValue / 100; porLista = pct >= 1 ? porPago : porPago / (1 - pct); }
  else porLista = porPago + params.descontoValue;
  return {
    POR_sugerido: porLista, precoDE, descontoNecessarioPct: precoDE > 0 ? (1 - porLista / precoDE) * 100 : 0, descontoNecessarioR$: precoDE - porLista,
    breakdown: { comissao: comissaoVal, imposto: impostoVal, pisCofins: pisVal, taxaFixa: channel.taxFixed, frete, cmv, operacionais: operR$, ads: adsR$, taxaCartao: cardFeeR$, influencer: influencerR$, creditoFrete: credFrete, creditoComissao: credComissao, creditoIncentivo: credIncentivo, rebate: rebateVal, margemContrib: mc, margemPct: porPago > 0 ? (mc / porPago) * 100 : 0, receitaLiquida: porPago - comissaoVal - impostoVal - pisVal - channel.taxFixed },
  };
}

function solveWithShopeeTiered(params: SolvePORParams & { channelRaw: ChannelConfig }): CalcResult {
  const sh = params.channelRaw?.shopee;
  if (!sh || sh.mode !== "tiered") return { ...solvePOR(params), channelUsed: params.channel, regimeUsed: params.regime };
  let guess = 200, lastTierKey = "";
  for (let i = 0; i < 12; i++) {
    const tier = pickShopeeTier(sh, guess);
    const tierKey = `${tier.min}-${tier.max}-${tier.commissionPercent}-${tier.taxFixed}`;
    const chUsed = { ...params.channel, commissionPercent: tier.commissionPercent, taxFixed: tier.taxFixed };
    const r = solvePOR({ ...params, channel: chUsed });
    const newTier = pickShopeeTier(sh, r.POR_sugerido);
    const newTierKey = `${newTier.min}-${newTier.max}-${newTier.commissionPercent}-${newTier.taxFixed}`;
    if (newTierKey === tierKey || newTierKey === lastTierKey) return { ...r, channelUsed: chUsed, regimeUsed: params.regime };
    lastTierKey = tierKey; guess = r.POR_sugerido;
  }
  const tier = pickShopeeTier(sh, guess);
  const chUsed = { ...params.channel, commissionPercent: tier.commissionPercent, taxFixed: tier.taxFixed };
  return { ...solvePOR({ ...params, channel: chUsed }), channelUsed: chUsed, regimeUsed: params.regime };
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
  const keys: ChannelKey[] = ["magalu", "meli", "shopee", "site", "outros", "site_modifika"];
  const channels: Record<ChannelKey, ChannelConfig> = {} as Record<ChannelKey, ChannelConfig>;
  for (const k of keys) {
    const inc: RawChannelData = (base.channels && base.channels[k]) || {};
    const mp = k !== "site" && k !== "site_modifika";
    channels[k] = { 
      commissionPercent: Number(inc.commissionPercent ?? 0), 
      taxFixed: Number(inc.taxFixed ?? 0), 
      mainTaxPercent: Number(inc.mainTaxPercent ?? mainTax), 
      hasCredits: typeof inc.hasCredits === "boolean" ? inc.hasCredits : (k === "site_modifika" || mp), 
      creditFretePercent: Number(inc.creditFretePercent ?? (k === "site_modifika" ? 12 : (mp ? 21.25 : 0))), 
      creditCommissionPercent: Number(inc.creditCommissionPercent ?? (mp ? 9.25 : 0)), 
      targetMarginPercent: Number(inc.targetMarginPercent ?? 10),
      pisCofinsPercent: inc.pisCofinsPercent !== undefined ? Number(inc.pisCofinsPercent) : undefined,
      cardFeePercent: inc.cardFeePercent !== undefined ? Number(inc.cardFeePercent) : undefined,
      influencerPercent: inc.influencerPercent !== undefined ? Number(inc.influencerPercent) : undefined,
      incentiveCreditPercent: inc.incentiveCreditPercent !== undefined ? Number(inc.incentiveCreditPercent) : undefined,
    };
    if (k === "meli") channels[k].meli = { classicCommissionPercent: base.meli?.classicCommissionPercent ?? 11.5, premiumCommissionPercent: base.meli?.premiumCommissionPercent ?? 16.5 };
    if (k === "shopee") { const tiers = Array.isArray(base.shopeeTiers) ? base.shopeeTiers : []; channels[k].shopee = { mode: tiers.length ? "tiered" : "flat", tiers }; }
  }
  return { regime, ufOrigem: base.ufOrigem ?? "RS", channels };
}

function InfoTip({ text }: { text: string }) {
  return <span title={text} className="ml-1 inline-grid h-4 w-4 place-items-center rounded-full bg-white/5 text-[11px] text-white/70 ring-1 ring-white/10 cursor-help select-none" aria-label={text}>ℹ</span>;
}

export default function PrecificacaoPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [selectedCouponId, setSelectedCouponId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function showToast(type: "ok" | "err", text: string) { setToast({ type, text }); window.setTimeout(() => setToast(null), 1600); }

  const [margemDirty, setMargemDirty] = useState(false);
  const [meliMode, setMeliMode] = useState<"classic" | "premium">("classic");
  const [magaluShipMode, setMagaluShipMode] = useState<"proprio" | "full">("proprio");
  const [query, setQuery] = useState("");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [manualName, setManualName] = useState("");
  const [manualCmv, setManualCmv] = useState("");
  const [channel, setChannel] = useState<ChannelKey>("magalu");
  const [regimeOverride, setRegimeOverride] = useState<"default" | Regime>("default");
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

  const markupBase = 4.3;

  // ✅ FIX 1: margem por canal via useMemo derivado — sem setState em useEffect
  const margemDefault = useMemo(() => {
    if (!settings) return "20,00";
    const ch = settings.channels[channel];
    return String(typeof ch?.targetMarginPercent === "number" ? ch.targetMarginPercent : 10).replace(".", ",");
  }, [settings, channel]);

  const margemEfetiva = margemDirty ? margem : margemDefault;

  // ✅ FIX 2: canal efetivo via useMemo — sem setState em useEffect
  const availableChannels = useMemo(() => settings ? Object.keys(settings.channels) : ["magalu", "meli", "shopee"], [settings]);

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
    // Cupons
    (async () => { try { const res = await fetch("/api/promotions"); if (res.ok) { const j = await res.json() as { promotions?: Coupon[] }; setCoupons((j?.promotions ?? []).filter((p) => p.isActive)); } } catch (e) { console.error("cupons", e); } })();
    // Settings
    (async () => {
      try {
        const res = await fetch("/api/settings/rulesets");
        if (res.ok) {
          const j = await res.json() as { rulesets?: RawRuleSet[] };
          const list = j?.rulesets ?? [];
          const active = list.find((r) => r.isActive) || list[0] || null;
          if (active) setSettings(mapRuleSetToSettings(active.data ? active.data : active));
        } else {
          const raw = localStorage.getItem("markup_settings_rulesets_v1");
          if (raw) { const store = JSON.parse(raw) as { ruleSets?: RawRuleSet[] }; const a = store?.ruleSets?.[0]; if (a) setSettings(mapRuleSetToSettings(a)); }
        }
      } catch { try { const raw = localStorage.getItem("markup_settings_rulesets_v1"); if (raw) { const store = JSON.parse(raw) as { ruleSets?: RawRuleSet[] }; const a = store?.ruleSets?.[0]; if (a) setSettings(mapRuleSetToSettings(a)); } } catch { /* ignore */ } }
    })();
    // Draft
    try {
      const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return;
      const d = JSON.parse(raw) as Record<string, string>;
      if (d.query) setQuery(d.query); if (d.selectedSku) setSelectedSku(d.selectedSku);
      if (d.manualName) setManualName(d.manualName); if (d.manualCmv) setManualCmv(d.manualCmv);
      if (d.channel) setChannel(d.channel);
      if (d.meliMode === "classic" || d.meliMode === "premium") setMeliMode(d.meliMode);
      if (d.magaluShipMode === "proprio" || d.magaluShipMode === "full") setMagaluShipMode(d.magaluShipMode);
      if (d.regimeOverride) setRegimeOverride(d.regimeOverride as "default" | Regime);
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
      if (d.descontoValue) setDescontoValue(d.descontoValue); if (d.selectedCouponId) setSelectedCouponId(d.selectedCouponId);
      if (d.rebateMode === "fixed" || d.rebateMode === "percent") setRebateMode(d.rebateMode);
      if (d.rebateValue) setRebateValue(d.rebateValue);
      if (d.commissionOverride) setCommissionOverride(d.commissionOverride); if (d.taxOverride) setTaxOverride(d.taxOverride);
      if (d.fixedOverride) setFixedOverride(d.fixedOverride); if (d.creditFreteOverride) setCreditFreteOverride(d.creditFreteOverride);
      if (d.creditComissaoOverride) setCreditComissaoOverride(d.creditComissaoOverride);
    } catch (e) { console.error("draft", e); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedCouponId) { const sel = coupons.find((c) => c.id === selectedCouponId); if (sel) { setDescontoMode(sel.discountMode); setDescontoValue(String(sel.discountValue).replace(".", ",")); } }
  }, [selectedCouponId, coupons]);

  const saveDraftDebounced = useDebouncedDraftSaver(250);
  useEffect(() => {
    saveDraftDebounced(DRAFT_KEY, { query, selectedSku, manualName, manualCmv, channel, meliMode, magaluShipMode, regimeOverride, frete, margem, operMode, operValue, adsMode, adsValue, cardFeeValue, influencerMode, influencerValue, incentiveCreditOverride, descontoMode, descontoValue, selectedCouponId, rebateMode, rebateValue, commissionOverride, taxOverride, fixedOverride, creditFreteOverride, creditComissaoOverride });
  }, [query, selectedSku, manualName, manualCmv, channel, meliMode, magaluShipMode, regimeOverride, frete, margem, operMode, operValue, adsMode, adsValue, cardFeeValue, influencerMode, influencerValue, incentiveCreditOverride, descontoMode, descontoValue, selectedCouponId, rebateMode, rebateValue, commissionOverride, taxOverride, fixedOverride, creditFreteOverride, creditComissaoOverride, saveDraftDebounced]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 10);
    return products.filter((p) => normalizeSku(p.sku).toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 10);
  }, [products, query]);

  const picked = useMemo(() => { if (!selectedSku) return null; const s = normalizeSku(selectedSku); return products.find((p) => normalizeSku(p.sku) === s) || null; }, [products, selectedSku]);

  const effectiveName = picked ? picked.name : manualName.trim() || "Produto sem cadastro";
  const effectiveCmv = picked ? picked.cmv : parseNumberPt(manualCmv);

  // ✅ FIX 3: recalcTick removido do useMemo (era desnecessário — useMemo não observa estado arbitrário)
  const result = useMemo((): CalcResult | null => {
    if (!settings || !effectiveCmv || effectiveCmv <= 0) return null;
    const baseCh = settings.channels[effectiveChannel]; if (!baseCh) return null;
    const regimeFinal: Regime = regimeOverride === "default" ? settings.regime : regimeOverride;
    const mainTaxPercent = taxOverride.trim() ? parseNumberPt(taxOverride) : (regimeOverride === "default" ? baseCh.mainTaxPercent : (regimeFinal === "normal" ? 18 : 14));
    let commissionPercent = baseCh.commissionPercent;
    if (effectiveChannel === "meli" && baseCh.meli) commissionPercent = meliMode === "premium" ? baseCh.meli.premiumCommissionPercent : baseCh.meli.classicCommissionPercent;
    if (commissionOverride.trim()) commissionPercent = parseNumberPt(commissionOverride);
    const taxFixed = fixedOverride.trim() ? parseNumberPt(fixedOverride) : baseCh.taxFixed;
    const creditFreteBase = creditFreteOverride.trim() ? parseNumberPt(creditFreteOverride) : baseCh.creditFretePercent;
    const creditFretePercent = effectiveChannel === "magalu" && magaluShipMode === "full" ? 0 : creditFreteBase;
    const creditCommissionPercent = creditComissaoOverride.trim() ? parseNumberPt(creditComissaoOverride) : baseCh.creditCommissionPercent;
    const ch = { commissionPercent, taxFixed, mainTaxPercent, hasCredits: baseCh.hasCredits, creditFretePercent, creditCommissionPercent, pisCofinsPercent: (baseCh as any).pisCofinsPercent, cardFeePercent: (baseCh as any).cardFeePercent, influencerPercent: (baseCh as any).influencerPercent, incentiveCreditPercent: (baseCh as any).incentiveCreditPercent };
    const common: SolvePORParams = { 
      cmv: effectiveCmv, markupBase, frete: parseNumberPt(frete), operMode, operValue: parseNumberPt(operValue), adsMode, adsValue: parseNumberPt(adsValue), 
      margemAlvoPercent: parseNumberPt(margemEfetiva) || (baseCh.targetMarginPercent ?? 20), channel: ch, regime: regimeFinal, rebateMode, rebateValue: parseNumberPt(rebateValue), descontoMode, descontoValue: parseNumberPt(descontoValue),
      cardFeePercent: cardFeeValue.trim() ? parseNumberPt(cardFeeValue) : undefined,
      influencerMode, influencerValue: parseNumberPt(influencerValue),
      incentiveCreditPercent: incentiveCreditOverride.trim() ? parseNumberPt(incentiveCreditOverride) : undefined
    };
    if (effectiveChannel === "shopee" && !commissionOverride.trim() && !fixedOverride.trim() && baseCh.shopee?.mode === "tiered") return solveWithShopeeTiered({ ...common, channelRaw: baseCh });
    return { ...solvePOR(common), channelUsed: ch, regimeUsed: regimeFinal };
  }, [settings, effectiveCmv, effectiveChannel, meliMode, magaluShipMode, frete, operMode, operValue, adsMode, adsValue, margemEfetiva, regimeOverride, descontoMode, descontoValue, rebateMode, rebateValue, commissionOverride, taxOverride, fixedOverride, creditFreteOverride, creditComissaoOverride]);

  const alerts = useMemo(() => {
    if (!result) return [];
    const list: { type: "warn" | "bad"; text: string }[] = [];
    const alvo = parseNumberPt(margemEfetiva);
    if (result.breakdown.margemPct < 0) list.push({ type: "bad", text: "Prejuízo: margem negativa." });
    if (result.breakdown.margemPct + 0.01 < alvo) list.push({ type: "warn", text: "Margem abaixo da meta." });
    if (result.POR_sugerido < effectiveCmv) list.push({ type: "bad", text: "POR abaixo do CMV." });
    if (commissionOverride.trim() || taxOverride.trim() || fixedOverride.trim()) list.push({ type: "warn", text: "Overrides ativos." });
    return list;
  }, [result, margemEfetiva, effectiveCmv, commissionOverride, taxOverride, fixedOverride]);

  function saveToHistory(quiet = false) {
    if (!result) return false;
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_HISTORY) || "[]") as unknown[];
      arr.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), sku: picked?.sku || "", name: effectiveName, channel: effectiveChannel, meliMode, magaluShipMode, regime: result.regimeUsed, por: result.POR_sugerido, margemPct: result.breakdown.margemPct, cmv: effectiveCmv, channelUsed: result.channelUsed });
      localStorage.setItem(STORAGE_HISTORY, JSON.stringify(arr));
      if (!quiet) alert("Salvo no histórico.");
      return true;
    } catch { if (!quiet) showToast("err", "Falha ao salvar histórico."); return false; }
  }

  function resetForNewPricing() {
    setQuery(""); setSelectedSku(null); setManualName(""); setManualCmv(""); setMargemDirty(false);
    setDescontoValue("0"); setRebateValue("0"); setCommissionOverride(""); setTaxOverride("");
    setFixedOverride(""); setCreditFreteOverride(""); setCreditComissaoOverride("");
  }

  async function copyPorToClipboard() {
    if (!result) return;
    try { await navigator.clipboard.writeText(fmtPt(result.POR_sugerido)); showToast("ok", "Preço POR copiado."); }
    catch { showToast("err", "Não consegui copiar."); }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">Precificação</h1>
        <p className="mt-1 text-sm text-white/60">Calcule o <b>Preço POR</b> para atingir a margem desejada, com impostos, taxas e créditos.</p>
      </section>

      {!settings && (
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6 text-sm text-amber-100">
          Ainda não encontrei Configurações salvas. Vá em <b>Configurações</b>, salve e volte aqui.
        </section>
      )}

      <section className="relative overflow-visible rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="relative overflow-visible isolate grid gap-4 md:grid-cols-2">
          {/* ESQUERDA */}
          <div className="grid gap-3 content-start">

            {/* ✅ SELECT DE CANAL — sempre visível */}
            <label className="grid gap-1">
              <span className="text-xs text-white/60">Canal de venda<InfoTip text="Selecione o marketplace para as taxas corretas." /></span>
              <select value={effectiveChannel} onChange={(e) => { setChannel(e.target.value as ChannelKey); setMargemDirty(false); }} className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60">
                {availableChannels.map((k) => <option key={k} value={k}>{channelLabel(k)}</option>)}
              </select>
            </label>

            {/* BUSCA */}
            <div className="grid gap-1 relative">
              <label className="grid gap-1">
                <span className="text-xs text-white/60">Buscar produto cadastrado<InfoTip text="Se não encontrar, preencha os campos manuais abaixo." /></span>
                <input value={query} onChange={(e) => { setQuery(e.target.value); if (!e.target.value.trim()) setSelectedSku(null); }} placeholder="Digite SKU ou nome..." className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60 w-full" />
              </label>
              {!!query.trim() && !selectedSku && (
                <div className="absolute top-[calc(100%+6px)] left-0 right-0 z-50 rounded-xl border border-white/10 bg-neutral-900/95 p-2 shadow-2xl backdrop-blur">
                  <p className="px-2 pb-2 text-[10px] uppercase font-bold text-white/40">Sugestões</p>
                  <div className="grid gap-2 max-h-60 overflow-y-auto">
                    {filteredProducts.length ? filteredProducts.map((p) => (
                      <button key={p.sku} type="button" onClick={() => { setSelectedSku(p.sku); setQuery(p.name); }} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-950/40 px-3 py-2 text-left hover:bg-neutral-950/60">
                        <div><p className="text-sm font-semibold text-white">{p.name}</p><p className="text-xs text-white/60">SKU: {p.sku} • CMV: R$ {fmtPt(p.cmv)}</p></div>
                        <span className="text-[10px] bg-white/5 px-2 py-1 rounded-md text-white/40">Selecionar</span>
                      </button>
                    )) : <div className="px-3 py-3 text-sm text-white/60">Nenhum produto encontrado.</div>}
                  </div>
                </div>
              )}
            </div>

            {/* ✅ CMV MANUAL — visível quando nenhum produto selecionado */}
            {!picked && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 grid gap-3">
                <p className="text-xs font-semibold text-white/60 uppercase tracking-wide">Produto manual<InfoTip text="O CMV é obrigatório para o cálculo." /></p>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1">
                    <span className="text-xs text-white/60">Nome do produto</span>
                    <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="ex: Poltrona Lisa NH" className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60" />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs text-white/60">CMV (R$) <span className="text-rose-400">*</span></span>
                    <input value={manualCmv} onChange={(e) => setManualCmv(e.target.value)} inputMode="decimal" placeholder="ex: 189,90" className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-emerald-500/60" />
                  </label>
                </div>
                {parseNumberPt(manualCmv) > 0 && <p className="text-xs text-emerald-400">CMV: R$ {fmtPt(parseNumberPt(manualCmv))} — pronto para calcular.</p>}
              </div>
            )}

            {picked && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
                <div><p className="text-sm font-semibold">{picked.name}</p><p className="text-xs text-white/60">SKU: {picked.sku} • CMV: R$ {fmtPt(picked.cmv)}</p></div>
                <button type="button" onClick={() => { setSelectedSku(null); setQuery(""); }} className="rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/70 ring-1 ring-white/10 hover:bg-white/10">Trocar</button>
              </div>
            )}

            <label className="grid gap-1">
              <span className="text-xs text-white/60">Regime tributário</span>
              <select value={regimeOverride} onChange={(e) => setRegimeOverride(e.target.value as "default" | Regime)} className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60">
                <option value="default">Usar Configurações</option>
                <option value="simples">Simples Nacional</option>
                <option value="normal">Regime normal</option>
              </select>
            </label>

            {/* ✅ MELI: Clássico / Premium */}
            {effectiveChannel === "meli" && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/60 font-semibold mb-2">Tipo de anúncio — Mercado Livre</p>
                <div className="flex gap-2">
                  {(["classic", "premium"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setMeliMode(m)} className={meliMode === m ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10" : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"}>
                      {m === "classic" ? "Clássico" : "Premium"}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-white/50">Comissões puxadas das Configurações.</p>
              </div>
            )}

            {effectiveChannel === "magalu" && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/60 font-semibold mb-2">Modalidade de envio — Magalu</p>
                <div className="flex gap-2">
                  {(["proprio", "full"] as const).map((m) => (
                    <button key={m} type="button" onClick={() => setMagaluShipMode(m)} className={magaluShipMode === m ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10" : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"}>
                      {m === "proprio" ? "Envio próprio" : "Full Magalu"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-white/60">Frete (R$)<InfoTip text="Frete fixo estimado." /></span>
                <input value={frete} onChange={(e) => setFrete(e.target.value)} inputMode="decimal" className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60" />
              </label>
              <label className="grid gap-1">
                <span className="text-xs text-white/60">Margem alvo (%)<InfoTip text="Ao trocar canal, volta para o padrão. Se digitar, fica travada." /></span>
                <input value={margemEfetiva} onChange={(e) => { setMargem(e.target.value); setMargemDirty(true); }} inputMode="decimal" className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60" />
              </label>
            </div>

            <Accordion title="Custos, Ads, Desconto e Rebate" subtitle="Ajuste somente quando necessário.">
              {(["fixed", "percent"] as MoneyMode[]).length > 0 && (
                <div className="grid gap-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between"><p className="text-sm font-semibold">Custos operacionais</p><ModeToggle value={operMode} onChange={setOperMode} /></div>
                      <input value={operValue} onChange={(e) => setOperValue(e.target.value)} inputMode="decimal" placeholder={operMode === "percent" ? "ex: 2,5" : "ex: 12,00"} className="mt-3 w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-sm font-semibold mb-3">Taxa cartão (%)</p>
                      <input value={cardFeeValue} onChange={(e) => setCardFeeValue(e.target.value)} inputMode="decimal" placeholder="Usa padrão do canal" className="w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
                    </div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between"><p className="text-sm font-semibold">Ads</p><ModeToggle value={adsMode} onChange={setAdsMode} /></div>
                      <input value={adsValue} onChange={(e) => setAdsValue(e.target.value)} inputMode="decimal" placeholder={adsMode === "percent" ? "ex: 3" : "ex: 25,00"} className="mt-3 w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center justify-between"><p className="text-sm font-semibold">Influencer</p><ModeToggle value={influencerMode} onChange={setInfluencerMode} percentFirst /></div>
                      <input value={influencerValue} onChange={(e) => setInfluencerValue(e.target.value)} inputMode="decimal" placeholder={influencerMode === "percent" ? "ex: 5" : "ex: 50,00"} className="mt-3 w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
                    </div>
                  </div>
                  {/* Desconto + Rebate */}
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-sm font-semibold mb-3">Desconto/Cupom</p>
                      {coupons.length > 0 && (
                        <select value={selectedCouponId || ""} onChange={(e) => setSelectedCouponId(e.target.value || null)} className="mb-3 w-full rounded-xl bg-neutral-950/60 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none">
                          <option value="">— Sem cupom —</option>
                          {coupons.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                        </select>
                      )}
                      <ModeToggle value={descontoMode} onChange={setDescontoMode} percentFirst />
                      <input value={descontoValue} onChange={(e) => { setDescontoValue(e.target.value); setSelectedCouponId(null); }} inputMode="decimal" className="mt-2 w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-sm font-semibold mb-3">Rebate</p>
                      <ModeToggle value={rebateMode} onChange={setRebateMode} percentFirst />
                      <input value={rebateValue} onChange={(e) => setRebateValue(e.target.value)} inputMode="decimal" className="mt-2 w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none" />
                    </div>
                  </div>
                </div>
              )}
            </Accordion>

            <Accordion title="Ajustes rápidos" subtitle="Deixe vazio para usar o padrão.">
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <SmallInput label="Comissão (%)" value={commissionOverride} onChange={setCommissionOverride} />
                  <SmallInput label="Imposto (%)" value={taxOverride} onChange={setTaxOverride} />
                  <SmallInput label="Taxa fixa (R$)" value={fixedOverride} onChange={setFixedOverride} />
                </div>
                <div className="grid gap-2">
                  <SmallInput label="Crédito frete (%)" value={creditFreteOverride} onChange={setCreditFreteOverride} />
                  <SmallInput label="Crédito comissão (%)" value={creditComissaoOverride} onChange={setCreditComissaoOverride} />
                  <SmallInput label="Crédito incentivo (%)" value={incentiveCreditOverride} onChange={setIncentiveCreditOverride} />
                </div>
              </div>
            </Accordion>
          </div>

          {/* DIREITA */}
          <div className="relative z-0 rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs font-medium tracking-wide text-white/60">RESULTADO</p>
            {!result ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                {!settings ? "Configure as Configurações e salve antes de calcular." : (!effectiveCmv || effectiveCmv <= 0) ? "Informe o CMV do produto (manual ou cadastrado)." : "Informe um CMV válido e verifique se Configurações estão salvas."}
              </div>
            ) : (
              <>
                {alerts.length > 0 && <div className="mt-4 space-y-2">{alerts.map((a, i) => <div key={i} className={a.type === "bad" ? "rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-100" : "rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-sm text-amber-100"}>{a.text}</div>)}</div>}
                <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-5">
                  <p className="text-xs text-white/60">Preço DE (CMV × {markupBase.toFixed(1)})</p>
                  <p className="mt-1 text-2xl font-semibold">R$ {fmtPt(result.precoDE)}</p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-white/60">Preço POR (sugerido)</p>
                      <p className="mt-1 text-3xl font-semibold">R$ {fmtPt(result.POR_sugerido)}</p>
                      <p className="mt-2 text-xs text-white/60">Margem: <b>{result.breakdown.margemPct.toFixed(2)}%</b></p>
                    </div>
                    <button type="button" onClick={copyPorToClipboard} className="h-11 shrink-0 rounded-xl bg-white/5 px-4 text-sm font-semibold ring-1 ring-white/10 hover:bg-white/10">Copiar POR</button>
                  </div>
                  <button onClick={() => saveToHistory(false)} className="mt-4 w-full rounded-xl bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20">Salvar no histórico</button>
                  <button type="button" onClick={() => { const ok = saveToHistory(true); if (ok) { resetForNewPricing(); showToast("ok", "Salvo!"); } }} className="mt-2 w-full rounded-xl bg-blue-500/12 px-4 py-3 text-sm font-semibold text-blue-100 ring-1 ring-blue-500/20 hover:bg-blue-500/16">Salvar e nova precificação</button>
                </div>
                <div className="mt-4 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-5">
                  <p className="text-xs font-semibold text-blue-100">PARA ATINGIR {parseNumberPt(margemEfetiva).toFixed(2)}% DE MARGEM</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs text-white/60">POR sugerido</p><p className="mt-1 text-xl font-semibold">R$ {fmtPt(result.POR_sugerido)}</p></div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs text-white/60">Desconto sugerido sobre DE</p><p className="mt-1 text-xl font-semibold">{result.descontoNecessarioPct.toFixed(2)}% <span className="text-sm text-white/60">(R$ {fmtPt(result.descontoNecessarioR$)})</span></p></div>
                  </div>
                </div>
                <div className="mt-4 space-y-2 text-sm">
                  <Row label={`Comissão (${result.channelUsed.commissionPercent.toFixed(2)}%)`} value={`R$ ${fmtPt(result.breakdown.comissao)}`} />
                  <Row label={`Imposto (${result.channelUsed.mainTaxPercent.toFixed(2)}%)`} value={`R$ ${fmtPt(result.breakdown.imposto)}`} />
                  <Row label={`PIS/COFINS ${result.regimeUsed === "normal" ? "(9,25%)" : "(não aplica)"}`} value={`R$ ${fmtPt(result.breakdown.pisCofins)}`} />
                  <Row label="Taxa fixa canal" value={`R$ ${fmtPt(result.breakdown.taxaFixa)}`} />
                  <div className="my-3 h-px bg-white/10" />
                  <Row label="Frete" value={`R$ ${fmtPt(result.breakdown.frete)}`} />
                  <Row label="CMV" value={`R$ ${fmtPt(result.breakdown.cmv)}`} />
                  <Row label="Custos operacionais" value={`R$ ${fmtPt(result.breakdown.operacionais)}`} />
                  <Row label="Ads" value={`R$ ${fmtPt(result.breakdown.ads)}`} />
                  {result.breakdown.taxaCartao > 0 && <Row label="Taxa de Cartão" value={`R$ ${fmtPt(result.breakdown.taxaCartao)}`} />}
                  {result.breakdown.influencer > 0 && <Row label="Influencer" value={`R$ ${fmtPt(result.breakdown.influencer)}`} />}
                  <div className="my-3 h-px bg-white/10" />
                  <Row label="Crédito de frete" value={`R$ ${fmtPt(result.breakdown.creditoFrete)}`} />
                  <Row label="Crédito de comissão" value={`R$ ${fmtPt(result.breakdown.creditoComissao)}`} />
                  {result.breakdown.creditoIncentivo > 0 && <Row label="Crédito Incentivo" value={`R$ ${fmtPt(result.breakdown.creditoIncentivo)}`} />}
                  <Row label="Rebate" value={`R$ ${fmtPt(result.breakdown.rebate)}`} />
                  <div className="my-3 h-px bg-white/10" />
                  <Row label="Receita líquida" value={`R$ ${fmtPt(result.breakdown.receitaLiquida)}`} strong />
                  <Row label="Margem de contribuição" value={`R$ ${fmtPt(result.breakdown.margemContrib)}`} strong />
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {toast && <div className="fixed bottom-4 right-4 z-50"><div className={"rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ring-1 " + (toast.type === "ok" ? "bg-emerald-500/15 text-emerald-100 ring-emerald-500/30" : "bg-rose-500/15 text-rose-100 ring-rose-500/30")}>{toast.text}</div></div>}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={strong ? "font-semibold text-white/90" : "text-white/70"}>{label}</span>
      <span className={strong ? "tabular-nums font-semibold text-white" : "tabular-nums text-white/85"}>{value}</span>
    </div>
  );
}

function SmallInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] text-white/60">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" className="h-10 rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60" />
    </label>
  );
}

function ModeToggle({ value, onChange, percentFirst = false }: { value: MoneyMode; onChange: (v: MoneyMode) => void; percentFirst?: boolean }) {
  const opts: MoneyMode[] = percentFirst ? ["percent", "fixed"] : ["fixed", "percent"];
  return (
    <div className="flex gap-2">
      {opts.map((m) => (
        <button key={m} type="button" onClick={() => onChange(m)} className={value === m ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10" : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"}>
          {m === "percent" ? "%" : "R$"}
        </button>
      ))}
    </div>
  );
}

function Accordion({ title, subtitle, defaultOpen = false, children }: { title: string; subtitle?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left">
        <div><p className="text-sm font-semibold text-white">{title}</p>{subtitle && <p className="mt-1 text-xs text-white/50">{subtitle}</p>}</div>
        <span className={"grid h-8 w-8 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10 transition " + (open ? "rotate-180" : "")} aria-hidden>
          <svg width="16" height="16" viewBox="0 0 24 24" className="text-white/70"><path fill="currentColor" d="M7 10l5 5 5-5z" /></svg>
        </span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
