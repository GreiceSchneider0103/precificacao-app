// lib/pricing.ts
export type ChannelKey = "magalu" | "meli" | "shopee";
export type Regime = "simples" | "normal";
export type MoneyMode = "percent" | "fixed";

export type ShopeeTier = {
  min: number;
  max: number | null;
  commissionPercent: number;
  taxFixed: number;
};

export type Settings = {
  regime: Regime;
  ufOrigem: string;
  channels: Record<
    ChannelKey,
    {
      commissionPercent: number;
      taxFixed: number;
      mainTaxPercent: number;
      hasCredits: boolean;
      creditFretePercent: number;
      creditCommissionPercent: number;
      targetMarginPercent: number;

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

export function parseNumberPt(raw: unknown) {
  if (typeof raw === "number") return Number.isFinite(raw as number) ? (raw as number) : 0;

  const cleaned = String(raw ?? "")
    .trim()
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function fmtPt(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pickShopeeTier(sh: { tiers: ShopeeTier[] } | undefined, price: number) {
  const tiers = sh?.tiers || [];
  for (const t of tiers) {
    const minOk = price >= t.min;
    const maxOk = t.max == null ? true : price <= t.max;
    if (minOk && maxOk) return t;
  }
  return tiers[tiers.length - 1] || { min: 0, max: null, commissionPercent: 14, taxFixed: 26 };
}

export function solvePOR(params: {
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

  descontoMode?: MoneyMode;
  descontoValue?: number;
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

  const POR = (() => {
    const c = channel.commissionPercent / 100;
    const t = channel.mainTaxPercent / 100;

    const pisCoeff = regime === "normal" ? 0.0925 * (1 - t) : 0;

    const operCoeff = operMode === "percent" ? operValue / 100 : 0;
    const adsCoeff = adsMode === "percent" ? adsValue / 100 : 0;

    const operFixed = operMode === "fixed" ? operValue : 0;
    const adsFixed = adsMode === "fixed" ? adsValue : 0;

    const fixedCosts = channel.taxFixed + frete + cmv + operFixed + adsFixed;

    const credFrete =
      regime === "normal" && channel.hasCredits ? frete * (channel.creditFretePercent / 100) : 0;

    const credComissaoCoeff =
      regime === "normal" && channel.hasCredits
        ? c * (channel.creditCommissionPercent / 100)
        : 0;

    const rebateFixed = rebateMode === "fixed" ? rebateValue : 0;
    const rebateCoeff = rebateMode === "percent" ? rebateValue / 100 : 0;

    const leftCoeff =
      1 -
      c -
      t -
      pisCoeff -
      operCoeff -
      adsCoeff +
      credComissaoCoeff +
      rebateCoeff -
      m;

    const right = fixedCosts - credFrete - rebateFixed;

    if (leftCoeff <= 0.000001) return 0;
    const porPago = right / leftCoeff;

    // Cupom/desconto: se informado, inverter para calcular preço publicado
    let porLista = porPago;
    if (params.descontoMode === "percent") {
      const pct = (params.descontoValue ?? 0) / 100;
      porLista = pct >= 1 ? porPago : porPago / (1 - pct);
    } else if (params.descontoMode === "fixed") {
      porLista = porPago + (params.descontoValue ?? 0);
    }
    return porLista;
  })();

  const comissaoVal = POR * (channel.commissionPercent / 100);
  const impostoVal = POR * (channel.mainTaxPercent / 100);
  const pisVal = regime === "normal" ? 0.0925 * (POR - impostoVal) : 0;

  const operR$ = operMode === "percent" ? POR * (operValue / 100) : operValue;
  const adsR$ = adsMode === "percent" ? POR * (adsValue / 100) : adsValue;

  const credFrete =
    regime === "normal" && channel.hasCredits ? frete * (channel.creditFretePercent / 100) : 0;

  const credComissao =
    regime === "normal" && channel.hasCredits
      ? comissaoVal * (channel.creditCommissionPercent / 100)
      : 0;

  const rebateVal = rebateMode === "percent" ? POR * (rebateValue / 100) : rebateValue;

  const mc =
    POR -
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

  const mcPct = POR > 0 ? (mc / POR) * 100 : 0;

  const receitaLiquida = POR - comissaoVal - impostoVal - pisVal - channel.taxFixed;

  const precoDE = cmv * markupBase;
  const descontoNecessarioPct = precoDE > 0 ? (1 - POR / precoDE) * 100 : 0;
  const descontoNecessarioR$ = precoDE - POR;

  return {
    POR_sugerido: POR,
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

export function solveWithShopeeTiered(params: Parameters<typeof solvePOR>[0] & { channelRaw: any }) {
  const sh = params.channelRaw?.shopee;
  if (!sh || sh.mode !== "tiered") {
    const r = solvePOR(params);
    return { ...r, channelUsed: params.channel };
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
      return { ...r, channelUsed: chUsed };
    }

    lastTierKey = tierKey;
    guess = newGuess;
  }

  const tier = pickShopeeTier(sh, guess);
  const chUsed = { ...params.channel, commissionPercent: tier.commissionPercent, taxFixed: tier.taxFixed };
  const r = solvePOR({ ...params, channel: chUsed });
  return { ...r, channelUsed: chUsed };
}
