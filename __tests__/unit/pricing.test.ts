// __tests__/unit/pricing.test.ts
import {
  solvePOR,
  solveWithShopeeTiered,
  parseNumberPt,
  fmtPt,
  type Settings,
  type ChannelKey,
} from '@/lib/pricing';

describe('Pricing Utils', () => {
  describe('parseNumberPt', () => {
    it('should parse Brazilian number format', () => {
      expect(parseNumberPt('1.234,56')).toBe(1234.56);
      expect(parseNumberPt('123,45')).toBe(123.45);
      expect(parseNumberPt('1.000')).toBe(1000);
    });

    it('should handle invalid inputs', () => {
      expect(parseNumberPt('')).toBe(0);
      expect(parseNumberPt(null)).toBe(0);
      expect(parseNumberPt(undefined)).toBe(0);
      expect(parseNumberPt('abc')).toBe(0);
    });

    it('should handle already parsed numbers', () => {
      expect(parseNumberPt(123.45)).toBe(123.45);
      expect(parseNumberPt(1000)).toBe(1000);
    });
  });

  describe('fmtPt', () => {
    it('should format numbers to Brazilian format', () => {
      expect(fmtPt(1234.56)).toBe('1.234,56');
      expect(fmtPt(123.45)).toBe('123,45');
      expect(fmtPt(1000)).toBe('1.000,00');
    });

    it('should handle zero and negative numbers', () => {
      expect(fmtPt(0)).toBe('0,00');
      expect(fmtPt(-123.45)).toBe('-123,45');
    });
  });
});

describe('solvePOR - Pricing Algorithm', () => {
  const baseChannel = {
    commissionPercent: 14,
    taxFixed: 26,
    mainTaxPercent: 6,
    hasCredits: false,
    creditFretePercent: 0,
    creditCommissionPercent: 0,
  };

  describe('Basic Calculations', () => {
    it('should calculate price for Shopee with 30% margin', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.POR_sugerido).toBeGreaterThan(100);
      expect(result.breakdown.margemPct).toBeCloseTo(30, 0);
      expect(result.breakdown.margemContrib).toBeGreaterThan(0);
    });

    it('should calculate price for Mercado Livre with costs', () => {
      const result = solvePOR({
        cmv: 150,
        markupBase: 2.5,
        frete: 20,
        margemAlvoPercent: 25,
        channel: {
          ...baseChannel,
          commissionPercent: 16,
          taxFixed: 10,
        },
        regime: 'simples',
        operMode: 'fixed',
        operValue: 5,
        adsMode: 'percent',
        adsValue: 3,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.POR_sugerido).toBeGreaterThan(150);
      expect(result.breakdown.operacionais).toBe(5);
      expect(result.breakdown.ads).toBeGreaterThan(0);
    });

    it('should return breakdown with all cost components', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.breakdown).toHaveProperty('comissao');
      expect(result.breakdown).toHaveProperty('imposto');
      expect(result.breakdown).toHaveProperty('pisCofins');
      expect(result.breakdown).toHaveProperty('taxaFixa');
      expect(result.breakdown).toHaveProperty('frete');
      expect(result.breakdown).toHaveProperty('cmv');
      expect(result.breakdown).toHaveProperty('margemContrib');
      expect(result.breakdown).toHaveProperty('margemPct');
      expect(result.breakdown).toHaveProperty('receitaLiquida');
    });
  });

  describe('Regime Tributário', () => {
    it('should calculate PIS/COFINS for Regime Normal', () => {
      const resultNormal = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'normal',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(resultNormal.breakdown.pisCofins).toBeGreaterThan(0);
    });

    it('should NOT calculate PIS/COFINS for Simples Nacional', () => {
      const resultSimples = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(resultSimples.breakdown.pisCofins).toBe(0);
    });
  });

  describe('Credits (Regime Normal)', () => {
    const channelWithCredits = {
      ...baseChannel,
      hasCredits: true,
      creditFretePercent: 70,
      creditCommissionPercent: 40,
    };

    it('should apply freight credit in Regime Normal', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 20,
        margemAlvoPercent: 30,
        channel: channelWithCredits,
        regime: 'normal',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.breakdown.creditoFrete).toBeCloseTo(20 * 0.7, 2);
    });

    it('should apply commission credit in Regime Normal', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: channelWithCredits,
        regime: 'normal',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.breakdown.creditoComissao).toBeGreaterThan(0);
    });

    it('should NOT apply credits in Simples Nacional', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 20,
        margemAlvoPercent: 30,
        channel: channelWithCredits,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.breakdown.creditoFrete).toBe(0);
      expect(result.breakdown.creditoComissao).toBe(0);
    });
  });

  describe('Operational Costs', () => {
    it('should apply fixed operational costs', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 10,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.breakdown.operacionais).toBe(10);
    });

    it('should apply percentage operational costs', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'percent',
        operValue: 5,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.breakdown.operacionais).toBeGreaterThan(0);
      expect(result.breakdown.operacionais).toBeLessThan(result.POR_sugerido);
    });
  });

  describe('Ads Costs', () => {
    it('should apply fixed ads costs', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 15,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.breakdown.ads).toBe(15);
    });

    it('should apply percentage ads costs', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'percent',
        adsValue: 4,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.breakdown.ads).toBeGreaterThan(0);
      expect(result.breakdown.ads / result.POR_sugerido).toBeCloseTo(0.04, 2);
    });
  });

  describe('Rebates', () => {
    it('should apply fixed rebate', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 10,
      });

      expect(result.breakdown.rebate).toBe(10);
    });

    it('should apply percentage rebate', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'percent',
        rebateValue: 5,
      });

      expect(result.breakdown.rebate).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero CMV', () => {
      const result = solvePOR({
        cmv: 0,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.POR_sugerido).toBeGreaterThanOrEqual(0);
    });

    it('should handle high margin (90%)', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 2,
        frete: 15,
        margemAlvoPercent: 90,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.POR_sugerido).toBeGreaterThan(100);
      // Com margem de 90%, o preço deve ser bem mais alto
      expect(result.breakdown.margemPct).toBeCloseTo(90, 0);
    });

    it('should calculate DE price based on markup', () => {
      const result = solvePOR({
        cmv: 100,
        markupBase: 3,
        frete: 15,
        margemAlvoPercent: 30,
        channel: baseChannel,
        regime: 'simples',
        operMode: 'fixed',
        operValue: 0,
        adsMode: 'fixed',
        adsValue: 0,
        rebateMode: 'fixed',
        rebateValue: 0,
      });

      expect(result.precoDE).toBe(300); // 100 * 3
      expect(result.descontoNecessarioR$).toBe(result.precoDE - result.POR_sugerido);
    });
  });
});

describe('solveWithShopeeTiered - Shopee Tiered Pricing', () => {
  const baseChannel = {
    commissionPercent: 14,
    taxFixed: 26,
    mainTaxPercent: 6,
    hasCredits: false,
    creditFretePercent: 0,
    creditCommissionPercent: 0,
  };

  const shopeeConfig = {
    mode: 'tiered' as const,
    tiers: [
      { min: 0, max: 100, commissionPercent: 14, taxFixed: 26 },
      { min: 100, max: 500, commissionPercent: 12, taxFixed: 26 },
      { min: 500, max: null, commissionPercent: 10, taxFixed: 26 },
    ],
  };

  it('should use tiered pricing for Shopee', () => {
    const result = solveWithShopeeTiered({
      cmv: 50,
      markupBase: 2,
      frete: 10,
      margemAlvoPercent: 30,
      channel: baseChannel,
      channelRaw: { shopee: shopeeConfig },
      regime: 'simples',
      operMode: 'fixed',
      operValue: 0,
      adsMode: 'fixed',
      adsValue: 0,
      rebateMode: 'fixed',
      rebateValue: 0,
    });

    expect(result.channelUsed).toBeDefined();
    expect(result.POR_sugerido).toBeGreaterThan(0);
  });

  it('should converge to correct tier after iterations', () => {
    const result = solveWithShopeeTiered({
      cmv: 200,
      markupBase: 2,
      frete: 15,
      margemAlvoPercent: 30,
      channel: baseChannel,
      channelRaw: { shopee: shopeeConfig },
      regime: 'simples',
      operMode: 'fixed',
      operValue: 0,
      adsMode: 'fixed',
      adsValue: 0,
      rebateMode: 'fixed',
      rebateValue: 0,
    });

    // Preço deve estar acima de 200, provavelmente na faixa 100-500 (12%)
    expect(result.POR_sugerido).toBeGreaterThan(200);
    expect(result.channelUsed.commissionPercent).toBeGreaterThanOrEqual(10);
    expect(result.channelUsed.commissionPercent).toBeLessThanOrEqual(14);
  });

  it('should fallback to normal pricing if not tiered', () => {
    const result = solveWithShopeeTiered({
      cmv: 100,
      markupBase: 2,
      frete: 15,
      margemAlvoPercent: 30,
      channel: baseChannel,
      channelRaw: { shopee: { mode: 'flat' } },
      regime: 'simples',
      operMode: 'fixed',
      operValue: 0,
      adsMode: 'fixed',
      adsValue: 0,
      rebateMode: 'fixed',
      rebateValue: 0,
    });

    expect(result.channelUsed).toEqual(baseChannel);
  });

  it('should fallback if no shopee config', () => {
    const result = solveWithShopeeTiered({
      cmv: 100,
      markupBase: 2,
      frete: 15,
      margemAlvoPercent: 30,
      channel: baseChannel,
      channelRaw: {},
      regime: 'simples',
      operMode: 'fixed',
      operValue: 0,
      adsMode: 'fixed',
      adsValue: 0,
      rebateMode: 'fixed',
      rebateValue: 0,
    });

    expect(result.channelUsed).toEqual(baseChannel);
  });
});
