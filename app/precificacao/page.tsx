"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ChannelKey = string;
type Regime = "simples" | "normal";
type MoneyMode = "percent" | "fixed";

type Product = {
  sku: string;
  name: string;
  cmv: number;
  updatedAt: string;
};

type ShopeeTier = {
  min: number;
  max: number | null;
  commissionPercent: number;
  taxFixed: number;
};

type Coupon = {
  id: string;
  name: string;
  code: string;
  discountMode: "percent" | "fixed";
  discountValue: number;
  isActive: boolean;
};

type Settings = {
  // ✅ agora settings é o RuleSet ativo vindo de "markup_settings_rulesets_v1"
  regime: Regime;
  ufOrigem: string;
  channels: Record<
    ChannelKey,
    {
      commissionPercent: number; // % base (fallback)
      taxFixed: number; // R$
      mainTaxPercent: number; // % (padrão do preset)
      hasCredits: boolean;
      creditFretePercent: number; // %
      creditCommissionPercent: number; // %
      targetMarginPercent: number; // ✅ margem padrão por canal

      // ✅ especiais (vindos do preset)
      meli?: {
        classicCommissionPercent: number;
        premiumCommissionPercent: number;
      };

      shopee?: {
        mode: "flat" | "tiered";
        tiers: ShopeeTier[];
      };
    }
  >;
};

const STORAGE_PRODUCTS = "markup_products_v1";
const STORAGE_HISTORY = "markup_price_history_v1";
const DRAFT_KEY = "markup_precificacao_draft_v1";

function normalizeSku(s: string) {
  return (s || "").trim().toUpperCase();
}

const CHANNEL_LABEL: Record<string, string> = {
  magalu: "Magalu",
  meli: "Mercado Livre",
  shopee: "Shopee",
  site: "Site",
  amazon: "Amazon",
  loja_fisica: "Loja Física",
};

function channelLabel(key: string) {
  return CHANNEL_LABEL[key] || key; // fallback: mostra a chave mesmo
}

function parseNumberPt(raw: unknown) {
  const cleaned = String(raw ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function fmtPt(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** ========= SHOPEE (tiered) ========= */
function pickShopeeTier(sh: { tiers: ShopeeTier[] } | undefined, price: number) {
  const tiers = sh?.tiers || [];
  for (const t of tiers) {
    const minOk = price >= t.min;
    const maxOk = t.max == null ? true : price <= t.max;
    if (minOk && maxOk) return t;
  }
  return tiers[tiers.length - 1] || { min: 0, max: null, commissionPercent: 14, taxFixed: 26 };
}

/**
 * Resolve POR com Shopee tiered iterando até estabilizar a faixa.
 * Só aplica quando channel.shopee.mode === "tiered".
 */
function solveWithShopeeTiered(params: Parameters<typeof solvePOR>[0] & { channelRaw: any }) {
  const sh = params.channelRaw?.shopee;
  if (!sh || sh.mode !== "tiered") {
    // fallback: normal
    const r = solvePOR(params);
    return { ...r, channelUsed: params.channel, regimeUsed: params.regime };
  }

  let guess = 200;
  let lastTierKey = "";

  for (let i = 0; i < 12; i++) {
    const tier = pickShopeeTier(sh, guess);
    const tierKey = `${tier.min}-${tier.max}-${tier.commissionPercent}-${tier.taxFixed}`;

    const chUsed = { ...params.channel, commissionPercent: tier.commissionPercent, taxFixed: tier.taxFixed };
    const r = solvePOR({ ...params, channel: chUsed });

    const newGuess = r.POR_sugerido;
    const newTier = pickShopeeTier(sh, newGuess);
    const newTierKey = `${newTier.min}-${newTier.max}-${newTier.commissionPercent}-${newTier.taxFixed}`;

    if (newTierKey === tierKey || newTierKey === lastTierKey) {
      return { ...r, channelUsed: chUsed, regimeUsed: params.regime };
    }

    lastTierKey = tierKey;
    guess = newGuess;
  }

  // fallback final
  const tier = pickShopeeTier(sh, guess);
  const chUsed = { ...params.channel, commissionPercent: tier.commissionPercent, taxFixed: tier.taxFixed };
  const r = solvePOR({ ...params, channel: chUsed });
  return { ...r, channelUsed: chUsed, regimeUsed: params.regime };
}

/**
 * Resolve POR_sugerido (preço final ao cliente) que atinge margem alvo (% sobre POR).
 * Inclui: comissão, imposto, PIS/COFINS (normal), taxa fixa, frete, CMV, oper/ads (R$ ou %),
 * créditos (normal): frete + comissão, rebate (R$ ou %).
 */
function solvePOR(params: {
  cmv: number;
  markupBase: number;
  frete: number;

  operMode: MoneyMode;
  operValue: number;

  adsMode: MoneyMode;
  adsValue: number;

  margemAlvoPercent: number;

  channel: {
    commissionPercent: number;
    taxFixed: number;
    mainTaxPercent: number;
    hasCredits: boolean;
    creditFretePercent: number;
    creditCommissionPercent: number;
  };

  regime: Regime;

  rebateMode: MoneyMode;
  rebateValue: number;
  descontoMode: MoneyMode;
  descontoValue: number;
}) {
  const {
    cmv,
    markupBase,
    frete,
    operMode,
    operValue,
    adsMode,
    adsValue,
    margemAlvoPercent,
    channel,
    regime,
    rebateMode,
    rebateValue,
  } = params;

  const m = clamp(margemAlvoPercent / 100, 0, 0.95);

  // Solve for POR_pago (preço efetivamente pago pelo cliente após cupom)
  const porPago = (() => {
    const c = channel.commissionPercent / 100;
    const t = channel.mainTaxPercent / 100;

    // PIS/COFINS 9,25% sobre (POR - imposto) => coef = 0,0925*(1 - t)
    const pisCoeff = regime === "normal" ? 0.0925 * (1 - t) : 0;

    const operCoeff = operMode === "percent" ? operValue / 100 : 0;
    const adsCoeff = adsMode === "percent" ? adsValue / 100 : 0;

    const operFixed = operMode === "fixed" ? operValue : 0;
    const adsFixed = adsMode === "fixed" ? adsValue : 0;

    const fixedCosts = channel.taxFixed + frete + cmv + operFixed + adsFixed;

    const credFrete = regime === "normal" && channel.hasCredits ? frete * (channel.creditFretePercent / 100) : 0;

    const credComissaoCoeff =
      regime === "normal" && channel.hasCredits ? c * (channel.creditCommissionPercent / 100) : 0;

    const rebateFixed = rebateMode === "fixed" ? rebateValue : 0;
    const rebateCoeff = rebateMode === "percent" ? rebateValue / 100 : 0;

    const leftCoeff = 1 - c - t - pisCoeff - operCoeff - adsCoeff + credComissaoCoeff + rebateCoeff - m;

    const right = fixedCosts - credFrete - rebateFixed;

    if (leftCoeff <= 0.000001) return 0;
    return right / leftCoeff;
  })();

  // Now porPago is the effective paid price. Compute breakdown over porPago.
  const comissaoVal = porPago * (channel.commissionPercent / 100);
  const impostoVal = porPago * (channel.mainTaxPercent / 100);
  const pisVal = regime === "normal" ? 0.0925 * (porPago - impostoVal) : 0;

  const operR$ = operMode === "percent" ? porPago * (operValue / 100) : operValue;
  const adsR$ = adsMode === "percent" ? porPago * (adsValue / 100) : adsValue;

  const credFrete = regime === "normal" && channel.hasCredits ? frete * (channel.creditFretePercent / 100) : 0;

  const credComissao =
    regime === "normal" && channel.hasCredits ? comissaoVal * (channel.creditCommissionPercent / 100) : 0;

  const rebateVal = rebateMode === "percent" ? porPago * (rebateValue / 100) : rebateValue;

  const mc =
    porPago -
    comissaoVal -
    impostoVal -
    pisVal -
    channel.taxFixed -
    frete -
    cmv -
    operR$ -
    adsR$ +
    credFrete +
    credComissao +
    rebateVal;

  const mcPct = porPago > 0 ? (mc / porPago) * 100 : 0;

  const receitaLiquida = porPago - comissaoVal - impostoVal - pisVal - channel.taxFixed;

  const precoDE = cmv * markupBase;

  // Convert porPago -> porLista (preço publicado) by inverting the discount
  let porLista = porPago;
  if (params.descontoMode === "percent") {
    const pct = params.descontoValue / 100;
    porLista = pct >= 1 ? porPago : porPago / (1 - pct);
  } else {
    porLista = porPago + params.descontoValue;
  }

  const descontoNecessarioPct = precoDE > 0 ? (1 - porLista / precoDE) * 100 : 0;
  const descontoNecessarioR$ = precoDE - porLista;

  return {
    POR_sugerido: porLista,
    precoDE,
    descontoNecessarioPct,
    descontoNecessarioR$,
    breakdown: {
      comissao: comissaoVal,
      imposto: impostoVal,
      pisCofins: pisVal,
      taxaFixa: channel.taxFixed,
      frete,
      cmv,
      operacionais: operR$,
      ads: adsR$,
      creditoFrete: credFrete,
      creditoComissao: credComissao,
      rebate: rebateVal,
      margemContrib: mc,
      margemPct: mcPct,
      receitaLiquida,
    },
  };
}

function useDebouncedDraftSaver(delayMs: number) {
  const t = useRef<any>(null);
  return (key: string, data: any) => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(data));
      } catch {}
    }, delayMs);
  };
}

function mapRuleSetToSettings(rs: any): Settings {
  const base = rs || {};
  const regime: Regime = base.regime === "simples" ? "simples" : "normal";
  const mainTax = regime === "normal" ? 18 : 14;

  const keys: ChannelKey[] = ["magalu", "meli", "shopee", "site", "outros"];
  const channels: Record<ChannelKey, any> = {} as any;

  for (const k of keys) {
    const incoming = (base.channels && base.channels[k]) || {};
    const isMarketplace = k !== "site";
    const defaultHasCredits = isMarketplace ? true : false;
    const defaultCreditFrete = isMarketplace ? 21.25 : 0;
    const defaultCreditCommission = isMarketplace ? 9.25 : 0;

    channels[k] = {
      commissionPercent:
        typeof incoming.commissionPercent === "number" ? incoming.commissionPercent : Number(incoming.commissionPercent ?? 0),
      taxFixed: typeof incoming.taxFixed === "number" ? incoming.taxFixed : Number(incoming.taxFixed ?? 0),
      mainTaxPercent: typeof incoming.mainTaxPercent === "number" ? incoming.mainTaxPercent : mainTax,
      hasCredits: typeof incoming.hasCredits === "boolean" ? incoming.hasCredits : defaultHasCredits,
      creditFretePercent:
        typeof incoming.creditFretePercent === "number" ? incoming.creditFretePercent : Number(incoming.creditFretePercent ?? defaultCreditFrete),
      creditCommissionPercent:
        typeof incoming.creditCommissionPercent === "number"
          ? incoming.creditCommissionPercent
          : Number(incoming.creditCommissionPercent ?? defaultCreditCommission),
      targetMarginPercent:
        typeof incoming.targetMarginPercent === "number" ? incoming.targetMarginPercent : Number(incoming.targetMarginPercent ?? 10),
    };

    // attach meli/preset inside the channel object for compatibility
    if (k === "meli") {
      channels[k].meli = {
        classicCommissionPercent: base.meli?.classicCommissionPercent ?? 11.5,
        premiumCommissionPercent: base.meli?.premiumCommissionPercent ?? 16.5,
      };
    }

    // attach shopee tiers under channel.shopee
    if (k === "shopee") {
      const tiers = Array.isArray(base.shopeeTiers) ? base.shopeeTiers : [];
      channels[k].shopee = { mode: tiers.length ? "tiered" : "flat", tiers };
    }
  }

  return {
    regime,
    ufOrigem: base.ufOrigem ?? "RS",
    channels,
  } as Settings;
}

/* ---------------- UI HELPERS ---------------- */

function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      className="ml-1 inline-grid h-4 w-4 place-items-center rounded-full bg-white/5 text-[11px] text-white/70 ring-1 ring-white/10 cursor-help select-none"
      aria-label={text}
    >
      ℹ
    </span>
  );
}

export default function PrecificacaoPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [selectedCouponId, setSelectedCouponId] = useState<string | null>(null);

  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function showToast(type: "ok" | "err", text: string) {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 1600);
  }

  // meta (margem) por canal: quando user digitar, trava (dirty)
  const [margemDirty, setMargemDirty] = useState(false);

  // Mercado Livre: Clássico/Premium
  const [meliMode, setMeliMode] = useState<"classic" | "premium">("classic");

  // Magalu: Envio próprio vs Full
  type MagaluShipMode = "proprio" | "full";
  const [magaluShipMode, setMagaluShipMode] = useState<MagaluShipMode>("proprio");

  // Busca
  const [query, setQuery] = useState("");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  // Manual
  const [manualName, setManualName] = useState("");
  const [manualCmv, setManualCmv] = useState("");

  const [channel, setChannel] = useState<ChannelKey>("magalu");
  const [regimeOverride, setRegimeOverride] = useState<"default" | Regime>("default");

  const [frete, setFrete] = useState("40,00");

  // Custos operacionais R$ ou %
  const [operMode, setOperMode] = useState<MoneyMode>("fixed");
  const [operValue, setOperValue] = useState("0,00");

  // Ads R$ ou %
  const [adsMode, setAdsMode] = useState<MoneyMode>("fixed");
  const [adsValue, setAdsValue] = useState("0,00");

  const [margem, setMargem] = useState("20,00");

  // Desconto (somente simulação sobre DE)
  const [descontoMode, setDescontoMode] = useState<MoneyMode>("percent");
  const [descontoValue, setDescontoValue] = useState("0");

  const [rebateMode, setRebateMode] = useState<MoneyMode>("percent");
  const [rebateValue, setRebateValue] = useState("0");

  // Overrides
  const [commissionOverride, setCommissionOverride] = useState<string>("");
  const [taxOverride, setTaxOverride] = useState<string>("");
  const [fixedOverride, setFixedOverride] = useState<string>("");

  const [creditFreteOverride, setCreditFreteOverride] = useState<string>("");
  const [creditComissaoOverride, setCreditComissaoOverride] = useState<string>("");

  // ✅ Recalcular via Enter (força recompute mesmo sem mudança)
  const [recalcTick, setRecalcTick] = useState(0);

  const markupBase = 4.3;

  /** ✅ sempre que trocar canal, se o usuário não "travou" a margem, preenche com targetMarginPercent do canal */
  useEffect(() => {
    if (!settings) return;
    if (margemDirty) return;

    const ch = settings.channels[channel];
    const m = typeof ch?.targetMarginPercent === "number" ? ch.targetMarginPercent : 10;
    setMargem(String(m).replace(".", ","));
  }, [settings, channel, margemDirty]);

  // ===== Load base data + draft
  useEffect(() => {
    // ✅ Carrega produtos da API
    (async () => {
      try {
        const response = await fetch("/api/products");
        if (!response.ok) {
          const rawP = localStorage.getItem(STORAGE_PRODUCTS);
          if (rawP) setProducts(JSON.parse(rawP));
          return;
        }
        const data = await response.json();
        const parsed = (data.products || data || []) as any[];
        const next: Product[] = parsed.map((p: any) => ({
          sku: (p.sku || "").trim().toUpperCase(),
          name: String(p.name ?? "").trim(),
          cmv: Number(p.cmv ?? 0) || 0,
          updatedAt: String(p.updatedAt ?? new Date().toISOString()),
        }));
        setProducts(next);
      } catch (e) {
        try {
          const rawP = localStorage.getItem(STORAGE_PRODUCTS);
          if (rawP) setProducts(JSON.parse(rawP));
        } catch {}
      }
    })();

    // ✅ carrega cupons/promoções ativos
    (async () => {
      try {
        const res = await fetch("/api/promotions");
        if (res.ok) {
          const json = await res.json();
          const list = Array.isArray(json?.promotions) ? json.promotions : [];
          setCoupons(list.filter((p: any) => p.isActive));
        }
      } catch (err) {
        console.error("Erro ao carregar cupons", err);
      }
    })();

    // ✅ carrega o RuleSet ativo via API (fallback para localStorage antiga)
    (async () => {
      try {
        const res = await fetch("/api/settings/rulesets");
        if (res.ok) {
          const json = await res.json();
          const list = Array.isArray(json?.rulesets) ? json.rulesets : [];
          const active = list.find((r: any) => r.isActive) || list[0] || null;
          if (active) {
            const raw = active.data ? active.data : active;
            setSettings(mapRuleSetToSettings(raw));
          }
        } else {
          // fallback para localStorage (compatibilidade)
          const rawS = localStorage.getItem("markup_settings_rulesets_v1");
          if (rawS) {
            const store = JSON.parse(rawS);
            const active = store?.ruleSets?.find((r: any) => r.id === store.activeRuleId) || store?.ruleSets?.[0];
            if (active) setSettings(active);
          }
        }
      } catch (err) {
        try {
          const rawS = localStorage.getItem("markup_settings_rulesets_v1");
          if (rawS) {
            const store = JSON.parse(rawS);
            const active = store?.ruleSets?.find((r: any) => r.id === store.activeRuleId) || store?.ruleSets?.[0];
            if (active) setSettings(active);
          }
        } catch {}
      }
    })();

    // Draft (UX forte)
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);

      if (d.query != null) setQuery(String(d.query));
      if (d.selectedSku != null) setSelectedSku(String(d.selectedSku));

      if (d.manualName != null) setManualName(String(d.manualName));
      if (d.manualCmv != null) setManualCmv(String(d.manualCmv));

      if (d.channel) setChannel(d.channel);
      if (d.meliMode) setMeliMode(d.meliMode);
      if (d.magaluShipMode) setMagaluShipMode(d.magaluShipMode);

      if (d.regimeOverride) setRegimeOverride(d.regimeOverride);

      if (d.frete != null) setFrete(String(d.frete));
      if (d.margem != null) setMargem(String(d.margem));

      if (d.operMode) setOperMode(d.operMode);
      if (d.operValue != null) setOperValue(String(d.operValue));

      if (d.adsMode) setAdsMode(d.adsMode);
      if (d.adsValue != null) setAdsValue(String(d.adsValue));

      if (d.descontoMode) setDescontoMode(d.descontoMode);
      if (d.descontoValue != null) setDescontoValue(String(d.descontoValue));

      if (d.selectedCouponId != null) setSelectedCouponId(String(d.selectedCouponId));

      if (d.rebateMode) setRebateMode(d.rebateMode);
      if (d.rebateValue != null) setRebateValue(String(d.rebateValue));

      if (d.commissionOverride != null) setCommissionOverride(String(d.commissionOverride));
      if (d.taxOverride != null) setTaxOverride(String(d.taxOverride));
      if (d.fixedOverride != null) setFixedOverride(String(d.fixedOverride));

      if (d.creditFreteOverride != null) setCreditFreteOverride(String(d.creditFreteOverride));
      if (d.creditComissaoOverride != null) setCreditComissaoOverride(String(d.creditComissaoOverride));
    } catch (err) {
      console.error("Erro ao carregar draft de precificação", err);
    }
  }, []);

  // ✅ quando cupom é selecionado, aplica automaticamente ao desconto
  useEffect(() => {
    if (selectedCouponId) {
      const selected = coupons.find((c) => c.id === selectedCouponId);
      if (selected) {
        setDescontoMode(selected.discountMode);
        setDescontoValue(
          selected.discountMode === "percent" ? String(selected.discountValue) : String(selected.discountValue).replace(".", ",")
        );
      }
    }
  }, [selectedCouponId, coupons]);

  // ===== Draft autosave (debounced)
  const saveDraftDebounced = useDebouncedDraftSaver(250);
  useEffect(() => {
    const draft = {
      query,
      selectedSku,
      manualName,
      manualCmv,
      channel,
      meliMode,
      magaluShipMode,
      regimeOverride,
      frete,
      margem,
      operMode,
      operValue,
      adsMode,
      adsValue,
      descontoMode,
      descontoValue,
      selectedCouponId,
      rebateMode,
      rebateValue,
      commissionOverride,
      taxOverride,
      fixedOverride,
      creditFreteOverride,
      creditComissaoOverride,
    };
    saveDraftDebounced(DRAFT_KEY, draft);
  }, [
    query,
    selectedSku,
    manualName,
    manualCmv,
    channel,
    meliMode,
    magaluShipMode,
    regimeOverride,
    frete,
    margem,
    operMode,
    operValue,
    adsMode,
    adsValue,
    descontoMode,
    descontoValue,
    selectedCouponId,
    rebateMode,
    rebateValue,
    commissionOverride,
    taxOverride,
    fixedOverride,
    creditFreteOverride,
    creditComissaoOverride,
    saveDraftDebounced,
  ]);

  // ✅ Enter = recalcular
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const tag = target.tagName?.toLowerCase?.() || "";
      const isTextArea = tag === "textarea";
      if (isTextArea) return;

      e.preventDefault();
      setRecalcTick((v) => v + 1);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!settings) return;

    const keys = Object.keys(settings.channels || {});
    if (!keys.length) return;

    if (!settings.channels[channel]) {
      setChannel(keys[0] as ChannelKey);
      setMargemDirty(false);
    }
  }, [settings, channel]);

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products.slice(0, 10);
    return products
      .filter((p) => {
        const sku = normalizeSku(p.sku).toLowerCase();
        const name = (p.name || "").toLowerCase();
        return sku.includes(q) || name.includes(q);
      })
      .slice(0, 10);
  }, [products, query]);

  const picked = useMemo(() => {
    if (!selectedSku) return null;
    const s = normalizeSku(selectedSku);
    return products.find((p) => normalizeSku(p.sku) === s) || null;
  }, [products, selectedSku]);

  const effectiveName = picked ? picked.name : manualName.trim() || "Produto sem cadastro";
  const effectiveCmv = picked ? picked.cmv : parseNumberPt(manualCmv);

  // ===== Core calc (with channel rules: Meli mode + Shopee tiers)
  const result = useMemo(() => {
    if (!settings) return null;
    if (!effectiveCmv || effectiveCmv <= 0) return null;

    const baseCh = settings.channels[channel];
    const regimeFinal: Regime = regimeOverride === "default" ? settings.regime : regimeOverride;

    const mainTaxPercent = (() => {
      if (taxOverride.trim()) return parseNumberPt(taxOverride);
      if (regimeOverride === "default") return baseCh.mainTaxPercent;
      return regimeFinal === "normal" ? 18 : 14;
    })();

    // ✅ comissão por canal (com meli classic/premium vindo do preset)
    let commissionPercent = baseCh.commissionPercent;

    if (channel === "meli" && baseCh.meli) {
      commissionPercent = meliMode === "premium" ? baseCh.meli.premiumCommissionPercent : baseCh.meli.classicCommissionPercent;
    }

    // ✅ taxa fixa padrão do canal
    let taxFixed = baseCh.taxFixed;

    // Overrides (se preencher, manda)
    if (commissionOverride.trim()) commissionPercent = parseNumberPt(commissionOverride);
    if (fixedOverride.trim()) taxFixed = parseNumberPt(fixedOverride);

    // Créditos: respeita preset, mas no regime simples não aplica mesmo (o cálculo já trava)
    const hasCredits = baseCh.hasCredits;

    const creditFretePercentBase = creditFreteOverride.trim()
      ? parseNumberPt(creditFreteOverride)
      : baseCh.creditFretePercent;

    // ✅ Magalu Full: zera crédito de frete
    const creditFretePercent =
      channel === "magalu" && magaluShipMode === "full" ? 0 : creditFretePercentBase;

    const creditCommissionPercent = creditComissaoOverride.trim()
      ? parseNumberPt(creditComissaoOverride)
      : baseCh.creditCommissionPercent;

    const freteN = parseNumberPt(frete);
    const operValueN = parseNumberPt(operValue);
    const adsValueN = parseNumberPt(adsValue);
    const descontoValueN = parseNumberPt(descontoValue);

    // ✅ margem: se usuário digitou, usa; senão usa targetMarginPercent do canal
    const margemTyped = parseNumberPt(margem);
    const margemDefault = settings.channels[channel]?.targetMarginPercent ?? 20;
    const margemN = margemDirty ? margemTyped : margemTyped || margemDefault;

    const rebateValueN = parseNumberPt(rebateValue);

    const ch = {
      commissionPercent,
      taxFixed,
      mainTaxPercent,
      hasCredits,
      creditFretePercent,
      creditCommissionPercent,
    };

    const shopeeNoOverride = !commissionOverride.trim() && !fixedOverride.trim();
    const shouldTierShopee = channel === "shopee" && shopeeNoOverride && baseCh.shopee?.mode === "tiered";

    if (shouldTierShopee) {
      const rTier = solveWithShopeeTiered({
        cmv: effectiveCmv,
        markupBase,
        frete: freteN,
        operMode,
        operValue: operValueN,
        adsMode,
        adsValue: adsValueN,
        margemAlvoPercent: margemN,
        channel: ch,
        channelRaw: baseCh,
        regime: regimeFinal,
        rebateMode,
        rebateValue: rebateValueN,
        descontoMode,
        descontoValue: descontoValueN,
      });

      return { ...rTier, regimeUsed: regimeFinal };
    }

    const r = solvePOR({
      cmv: effectiveCmv,
      markupBase,
      frete: freteN,
      operMode,
      operValue: operValueN,
      adsMode,
      adsValue: adsValueN,
      margemAlvoPercent: margemN,
      channel: ch,
      regime: regimeFinal,
      rebateMode,
      rebateValue: rebateValueN,
      descontoMode,
      descontoValue: descontoValueN,
    });

    return { ...r, channelUsed: ch, regimeUsed: regimeFinal };
  }, [
    settings,
    effectiveCmv,
    channel,
    meliMode,
    magaluShipMode,
    frete,
    operMode,
    operValue,
    adsMode,
    adsValue,
    margem,
    margemDirty,
    regimeOverride,
    descontoMode,
    descontoValue,
    rebateMode,
    rebateValue,
    commissionOverride,
    taxOverride,
    fixedOverride,
    creditFreteOverride,
    creditComissaoOverride,
    recalcTick,
  ]);

  // Simulação: se aplicar desconto em cima do DE, qual POR pago e qual margem fica?
  const discountSimulation = useMemo(() => {
    if (!result) return null;

    const de = result.precoDE;
    const d = parseNumberPt(descontoValue);

    let porPago = de;
    if (descontoMode === "percent") porPago = de * (1 - d / 100);
    else porPago = de - d;
    porPago = Math.max(0, porPago);

    const ch = result.channelUsed;
    const regime = result.regimeUsed;

    const cVal = porPago * (ch.commissionPercent / 100);
    const impostoVal = porPago * (ch.mainTaxPercent / 100);
    const pisVal = regime === "normal" ? 0.0925 * (porPago - impostoVal) : 0;

    const operR$ = operMode === "percent" ? porPago * (parseNumberPt(operValue) / 100) : parseNumberPt(operValue);
    const adsR$ = adsMode === "percent" ? porPago * (parseNumberPt(adsValue) / 100) : parseNumberPt(adsValue);

    const credFrete = regime === "normal" && ch.hasCredits ? parseNumberPt(frete) * (ch.creditFretePercent / 100) : 0;

    const credComissao = regime === "normal" && ch.hasCredits ? cVal * (ch.creditCommissionPercent / 100) : 0;

    const rebateVal =
      rebateMode === "percent" ? porPago * (parseNumberPt(rebateValue) / 100) : parseNumberPt(rebateValue);

    const mc =
      porPago -
      cVal -
      impostoVal -
      pisVal -
      ch.taxFixed -
      parseNumberPt(frete) -
      effectiveCmv -
      operR$ -
      adsR$ +
      credFrete +
      credComissao +
      rebateVal;

    const mcPct = porPago > 0 ? (mc / porPago) * 100 : 0;
    return { porPago, mcPct };
  }, [
    result,
    descontoMode,
    descontoValue,
    operMode,
    operValue,
    adsMode,
    adsValue,
    frete,
    effectiveCmv,
    rebateMode,
    rebateValue,
    recalcTick,
  ]);

  const alerts = useMemo(() => {
    if (!result) return [];
    const list: { type: "warn" | "bad"; text: string }[] = [];

    const alvo = parseNumberPt(margem) || 0;
    const mc = result.breakdown.margemPct;

    const EPS = 0.01;

    if (mc < 0) list.push({ type: "bad", text: "Prejuízo: margem negativa." });
    if (mc + EPS < alvo) list.push({ type: "warn", text: "Margem abaixo da meta." });

    if (result.POR_sugerido < effectiveCmv) list.push({ type: "bad", text: "POR abaixo do CMV (alto risco)." });

    if (commissionOverride.trim() || taxOverride.trim() || fixedOverride.trim())
      list.push({ type: "warn", text: "Overrides ativos: você alterou taxas do padrão." });

    return list;
  }, [result, margem, effectiveCmv, commissionOverride, taxOverride, fixedOverride]);

  function saveToHistory(quiet = false) {
    if (!result) return false;

    const payload = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      sku: picked?.sku || "",
      name: effectiveName,
      channel,
      meliMode,
      magaluShipMode,
      regime: result.regimeUsed,
      por: result.POR_sugerido,
      margemPct: result.breakdown.margemPct,
      cmv: effectiveCmv,
      frete: parseNumberPt(frete),
      operMode,
      operValue: parseNumberPt(operValue),
      adsMode,
      adsValue: parseNumberPt(adsValue),
      descontoMode,
      descontoValue: parseNumberPt(descontoValue),
      rebateMode,
      rebateValue: parseNumberPt(rebateValue),
      overrides: {
        commissionOverride: commissionOverride.trim(),
        taxOverride: taxOverride.trim(),
        fixedOverride: fixedOverride.trim(),
        creditFreteOverride: creditFreteOverride.trim(),
        creditComissaoOverride: creditComissaoOverride.trim(),
      },
      channelUsed: result.channelUsed,
    };

    try {
      const raw = localStorage.getItem(STORAGE_HISTORY);
      const arr = raw ? JSON.parse(raw) : [];
      arr.unshift(payload);
      localStorage.setItem(STORAGE_HISTORY, JSON.stringify(arr));
      if (!quiet) alert("Salvo no histórico.");
      return true;
    } catch {
      if (!quiet) showToast("err", "Falha ao salvar histórico.");
      return false;
    }
  }

  function resetForNewPricing() {
    setQuery("");
    setSelectedSku(null);
    setManualName("");
    setManualCmv("");

    setMargemDirty(false);

    setDescontoValue("0");
    setRebateValue("0");

    setCommissionOverride("");
    setTaxOverride("");
    setFixedOverride("");
    setCreditFreteOverride("");
    setCreditComissaoOverride("");

    setRecalcTick((v) => v + 1);
  }

  async function copyPorToClipboard() {
    if (!result) return;
    const text = fmtPt(result.POR_sugerido);
    try {
      await navigator.clipboard.writeText(text);
      showToast("ok", "Preço POR copiado.");
    } catch {
      showToast("err", "Não consegui copiar. Tente novamente.");
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">Precificação</h1>
        <p className="mt-1 text-sm text-white/60">
          Calcule o <b>Preço POR</b> para atingir a margem desejada, com impostos, taxas e créditos.
        </p>
      </section>

      {!settings ? (
        <section className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-6 text-sm text-amber-100">
          Ainda não encontrei Configurações salvas. Vá em <b>Configurações</b>, salve e volte aqui.
        </section>
      ) : null}

      <section className="relative overflow-visible rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="relative overflow-visible isolate grid gap-4 md:grid-cols-2">
          {/* ESQUERDA */}
          <div className="grid gap-3">
            {/* --- INÍCIO DO BLOCO DE BUSCA RESPONSIVA --- */}
            <div className="grid gap-1 relative">
              <label className="grid gap-1">
                <span className="text-xs text-white/60">
                  Buscar (SKU ou nome)
                  <InfoTip text="Digite e selecione um produto cadastrado. Se não achar, use o cadastro manual abaixo." />
                </span>
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (!e.target.value.trim()) setSelectedSku(null);
                  }}
                  placeholder="Digite SKU ou nome..."
                  className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60 w-full"
                />
              </label>

              {/* LISTA DE SUGESTÕES ABSOLUTA */}
              {!!query.trim() && !selectedSku && (
                <div className="absolute top-[calc(100%+6px)] left-0 right-0 z-50 rounded-xl border border-white/10 bg-neutral-900/95 p-2 shadow-2xl backdrop-blur">
                  <p className="px-2 pb-2 text-[10px] uppercase font-bold text-white/40">Sugestões</p>
                  <div className="grid gap-2 max-h-60 overflow-y-auto">
                    {filteredProducts.length ? (
                      filteredProducts.map((p) => (
                        <button
                          key={p.sku}
                          type="button"
                          onClick={() => {
                            setSelectedSku(p.sku);
                            setQuery(p.name);
                          }}
                          className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-neutral-950/40 px-3 py-2 text-left hover:bg-neutral-950/60"
                        >
                          <div>
                            <p className="text-sm font-semibold text-white">{p.name}</p>
                            <p className="text-xs text-white/60">
                              SKU: {p.sku} • CMV: R$ {fmtPt(p.cmv)}
                            </p>
                          </div>
                          <span className="text-[10px] bg-white/5 px-2 py-1 rounded-md text-white/40">Selecionar</span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-sm text-white/60">Nenhum produto encontrado.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {/* --- FIM DO BLOCO DE BUSCA RESPONSIVA --- */}

            <label className="grid gap-1">
              <span className="text-xs text-white/60">Regime tributário</span>
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

            {channel === "meli" && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
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
                <p className="mt-2 text-[11px] text-white/50">As comissões são puxadas da regra ativa em Configurações.</p>
              </div>
            )}

            {channel === "magalu" && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-xs text-white/60">Magalu</p>

                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMagaluShipMode("proprio")}
                    className={
                      magaluShipMode === "proprio"
                        ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                        : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                    }
                  >
                    Envio próprio
                  </button>

                  <button
                    type="button"
                    onClick={() => setMagaluShipMode("full")}
                    className={
                      magaluShipMode === "full"
                        ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                        : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                    }
                  >
                    Full Magalu
                  </button>
                </div>

                <p className="mt-2 text-xs text-white/50">
                  {magaluShipMode === "full"
                    ? "No Full Magalu, o crédito de frete fica zerado (mesmo no Regime Normal)."
                    : "No envio próprio, o crédito de frete pode ser aplicado no Regime Normal (se créditos estiverem ativos)."}
                </p>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs text-white/60">
                  Frete (R$)
                  <InfoTip text="Frete fixo estimado para este SKU/canal." />
                </span>
                <input
                  value={frete}
                  onChange={(e) => setFrete(e.target.value)}
                  inputMode="decimal"
                  className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-white/60">
                  Margem alvo (%)
                  <InfoTip text="Se você digitar aqui, a margem fica travada (dirty). Ao trocar canal, volta para o padrão do canal." />
                </span>
                <input
                  value={margem}
                  onChange={(e) => {
                    setMargem(e.target.value);
                    setMargemDirty(true);
                  }}
                  inputMode="decimal"
                  className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                />
              </label>
            </div>

            {/* CUSTOS (recolhível) */}
            <Accordion title="Custos, Ads, Desconto e Rebate" subtitle="Ajuste somente quando necessário." defaultOpen={false}>
              {/* Operacionais */}
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">
                    Custos operacionais
                    <InfoTip text="Custo operacional por item (fixo em R$ ou percentual sobre POR)." />
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setOperMode("fixed")}
                      className={
                        operMode === "fixed"
                          ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                          : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                      }
                    >
                      R$
                    </button>
                    <button
                      type="button"
                      onClick={() => setOperMode("percent")}
                      className={
                        operMode === "percent"
                          ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                          : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                      }
                    >
                      %
                    </button>
                  </div>
                </div>

                <input
                  value={operValue}
                  onChange={(e) => setOperValue(e.target.value)}
                  inputMode="decimal"
                  placeholder={operMode === "percent" ? "ex: 2,5" : "ex: 12,00"}
                  className="mt-3 w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                />
                <p className="mt-2 text-xs text-white/50">{operMode === "percent" ? "Percentual sobre o POR (preço pago)." : "Valor fixo em R$."}</p>
              </div>

              {/* Ads */}
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">
                    Ads
                    <InfoTip text="Custo de mídia por item (fixo em R$ ou percentual sobre POR)." />
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAdsMode("fixed")}
                      className={
                        adsMode === "fixed"
                          ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                          : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                      }
                    >
                      R$
                    </button>
                    <button
                      type="button"
                      onClick={() => setAdsMode("percent")}
                      className={
                        adsMode === "percent"
                          ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                          : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                      }
                    >
                      %
                    </button>
                  </div>
                </div>

                <input
                  value={adsValue}
                  onChange={(e) => setAdsValue(e.target.value)}
                  inputMode="decimal"
                  placeholder={adsMode === "percent" ? "ex: 3" : "ex: 25,00"}
                  className="mt-3 w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                />
                <p className="mt-2 text-xs text-white/50">{adsMode === "percent" ? "Percentual sobre o POR (preço pago)." : "Valor fixo em R$."}</p>
              </div>

              {/* Desconto + Rebate */}
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-sm font-semibold">
                    Desconto/Cupom
                    <InfoTip text="Selecione um cupom da lista ou digite um valor manualmente." />
                  </p>

                  {coupons.length > 0 && (
                    <div className="mt-3 grid gap-2">
                      <label className="text-xs text-white/60">Cupons disponíveis</label>
                      <select
                        value={selectedCouponId || ""}
                        onChange={(e) => {
                          const id = e.target.value || null;
                          setSelectedCouponId(id);
                        }}
                        className="rounded-xl bg-neutral-950/60 px-3 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                      >
                        <option value="">— Sem cupom —</option>
                        {coupons.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.code}) - {c.discountMode === "percent" ? `${c.discountValue}%` : `R$ ${fmtPt(c.discountValue)}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <p className="mt-3 text-xs text-white/60">Ou digite um valor manual</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDescontoMode("percent")}
                      className={
                        descontoMode === "percent"
                          ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                          : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                      }
                    >
                      %
                    </button>
                    <button
                      type="button"
                      onClick={() => setDescontoMode("fixed")}
                      className={
                        descontoMode === "fixed"
                          ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                          : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                      }
                    >
                      R$
                    </button>
                  </div>

                  <input
                    value={descontoValue}
                    onChange={(e) => {
                      setDescontoValue(e.target.value);
                      setSelectedCouponId(null);
                    }}
                    inputMode="decimal"
                    placeholder={descontoMode === "percent" ? "ex: 10" : "ex: 25,00"}
                    className="mt-3 w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                  />
                  <p className="mt-2 text-xs text-white/50">Usado para simular a margem com desconto no DE.</p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-sm font-semibold">
                    Rebate
                    <InfoTip text="Crédito adicional somado na margem (R$ ou % do POR)." />
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setRebateMode("percent")}
                      className={
                        rebateMode === "percent"
                          ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                          : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                      }
                    >
                      %
                    </button>
                    <button
                      type="button"
                      onClick={() => setRebateMode("fixed")}
                      className={
                        rebateMode === "fixed"
                          ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                          : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                      }
                    >
                      R$
                    </button>
                  </div>

                  <input
                    value={rebateValue}
                    onChange={(e) => setRebateValue(e.target.value)}
                    inputMode="decimal"
                    placeholder={rebateMode === "percent" ? "ex: 4,5" : "ex: 20,00"}
                    className="mt-3 w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                  />
                </div>
              </div>
            </Accordion>

            {/* Overrides (recolhível) */}
            <Accordion title="Ajustes rápidos " subtitle="Deixe vazio para usar o padrão." defaultOpen={false}>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="grid gap-2">
                    <SmallInput label="Comissão (%)" value={commissionOverride} onChange={setCommissionOverride} />
                    <SmallInput label="Imposto (%)" value={taxOverride} onChange={setTaxOverride} />
                    <SmallInput label="Taxa fixa (R$)" value={fixedOverride} onChange={setFixedOverride} />
                  </div>

                  <div className="grid gap-2">
                    <SmallInput label="Crédito frete (%)" value={creditFreteOverride} onChange={setCreditFreteOverride} />
                    <SmallInput label="Crédito comissão (%)" value={creditComissaoOverride} onChange={setCreditComissaoOverride} />
                  </div>
                </div>
              </div>
            </Accordion>
          </div>

          {/* DIREITA */}
          <div className="relative z-0 rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs font-medium tracking-wide text-white/60">RESULTADO</p>

            {!result ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                Informe um CMV (manual ou cadastrado) e verifique se Configurações estão salvas.
              </div>
            ) : (
              <>
                {alerts.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {alerts.map((a, i) => (
                      <div
                        key={i}
                        className={
                          a.type === "bad"
                            ? "rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-100"
                            : "rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-2 text-sm text-amber-100"
                        }
                      >
                        {a.text}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-5">
                  <p className="text-xs text-white/60">Preço DE (CMV × {markupBase.toFixed(1)})</p>
                  <p className="mt-1 text-2xl font-semibold">R$ {fmtPt(result.precoDE)}</p>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-white/60">
                        Preço POR (sugerido para bater a margem)
                        <InfoTip text="POR = preço final ao cliente. Esse é o número que você publica." />
                      </p>
                      <p className="mt-1 text-3xl font-semibold">R$ {fmtPt(result.POR_sugerido)}</p>
                      <p className="mt-2 text-xs text-white/60">
                        Margem calculada: <b>{result.breakdown.margemPct.toFixed(2)}%</b>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={copyPorToClipboard}
                      className="h-11 shrink-0 rounded-xl bg-white/5 px-4 text-sm font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/10"
                    >
                      Copiar preço POR
                    </button>

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

                  <button
                    onClick={() => saveToHistory(false)}
                    className="mt-4 w-full rounded-xl bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20 transition"
                  >
                    Salvar no histórico
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const ok = saveToHistory(true);
                      if (ok) {
                        resetForNewPricing();
                        showToast("ok", "Salvo no histórico.");
                      }
                    }}
                    className="mt-2 w-full rounded-xl bg-blue-500/12 px-4 py-3 text-sm font-semibold text-blue-100 ring-1 ring-blue-500/20 hover:bg-blue-500/16 transition"
                  >
                    Salvar e nova precificação
                  </button>
                </div>

                <div className="mt-4 rounded-2xl border border-blue-500/20 bg-blue-500/10 p-5">
                  <p className="text-xs font-semibold text-blue-100">PARA ATINGIR {parseNumberPt(margem).toFixed(2)}% DE MARGEM</p>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs text-white/60">POR sugerido</p>
                      <p className="mt-1 text-xl font-semibold">R$ {fmtPt(result.POR_sugerido)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs text-white/60">Desconto sugerido sobre DE</p>
                      <p className="mt-1 text-xl font-semibold">
                        {result.descontoNecessarioPct.toFixed(2)}%{" "}
                        <span className="text-sm text-white/60">(R$ {fmtPt(result.descontoNecessarioR$)})</span>
                      </p>
                    </div>
                  </div>

                  {discountSimulation ? <div className="mt-3 text-xs text-blue-50/80">{/* mantido vazio */}</div> : null}
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <Row label={`Comissão (${result.channelUsed.commissionPercent.toFixed(2)}%)`} value={`R$ ${fmtPt(result.breakdown.comissao)}`} />
                  <Row label={`Imposto (${result.channelUsed.mainTaxPercent.toFixed(2)}%)`} value={`R$ ${fmtPt(result.breakdown.imposto)}`} />
                  <Row
                    label={`PIS/COFINS (9,25%) ${result.regimeUsed === "normal" ? "" : "(não aplica)"}`}
                    value={`R$ ${fmtPt(result.breakdown.pisCofins)}`}
                  />
                  <Row label="Taxa fixa canal" value={`R$ ${fmtPt(result.breakdown.taxaFixa)}`} />

                  <div className="my-3 h-px bg-white/10" />

                  <Row label="Frete" value={`R$ ${fmtPt(result.breakdown.frete)}`} />
                  <Row label="CMV" value={`R$ ${fmtPt(result.breakdown.cmv)}`} />
                  <Row
                    label={`Custos operacionais (${operMode === "percent" ? `${parseNumberPt(operValue).toFixed(2)}%` : "R$"})`}
                    value={`R$ ${fmtPt(result.breakdown.operacionais)}`}
                  />
                  <Row
                    label={`Ads (${adsMode === "percent" ? `${parseNumberPt(adsValue).toFixed(2)}%` : "R$"})`}
                    value={`R$ ${fmtPt(result.breakdown.ads)}`}
                  />

                  <div className="my-3 h-px bg-white/10" />

                  <Row label="Crédito de frete" value={`R$ ${fmtPt(result.breakdown.creditoFrete)}`} />
                  <Row label="Crédito de comissão" value={`R$ ${fmtPt(result.breakdown.creditoComissao)}`} />
                  <Row
                    label={`Rebate (${rebateMode === "percent" ? `${parseNumberPt(rebateValue).toFixed(2)}%` : "R$"})`}
                    value={`R$ ${fmtPt(result.breakdown.rebate)}`}
                  />

                  <div className="my-3 h-px bg-white/10" />

                  <Row
                    label="Receita líquida (pós comissão + impostos)"
                    value={`R$ ${fmtPt(result.breakdown.receitaLiquida)}`}
                    strong
                  />
                  <Row label="Margem de contribuição" value={`R$ ${fmtPt(result.breakdown.margemContrib)}`} strong />
                </div>
              </>
            )}
          </div>
        </div>
      </section>
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
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        className="h-10 rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
      />
    </label>
  );
}

function Accordion({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left"
      >
        <div>
          <p className="text-sm font-semibold text-white">{title}</p>
          {subtitle ? <p className="mt-1 text-xs text-white/50">{subtitle}</p> : null}
        </div>

        <span
          className={
            "grid h-8 w-8 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10 transition " + (open ? "rotate-180" : "")
          }
          aria-hidden
        >
          <svg width="16" height="16" viewBox="0 0 24 24" className="text-white/70">
            <path fill="currentColor" d="M7 10l5 5 5-5z" />
          </svg>
        </span>
      </button>

      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </div>
  );
}
