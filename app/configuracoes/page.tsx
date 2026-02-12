"use client";

import { useEffect, useMemo, useState } from "react";

type ChannelKey = "magalu" | "meli" | "shopee" | "site" | "outros";
type Regime = "simples" | "normal";

type ShopeeTier = {
  min: number; // inclusive
  max: number | null; // null = infinito
  commissionPercent: number;
  taxFixed: number; // R$
};

type ChannelRule = {
  // base
  commissionPercent: number; // % (usado quando não houver regra especial)
  taxFixed: number; // R$
  mainTaxPercent: number; // % imposto principal (ex: 18)
  hasCredits: boolean;
  creditFretePercent: number; // % sobre frete
  creditCommissionPercent: number; // % sobre comissão

  // Margem alvo por canal
  targetMarginPercent: number; // % (margem esperada)

  // especiais
  meli?: {
    classicCommissionPercent: number; // 11,5
    premiumCommissionPercent: number; // 16,5
  };

  shopee?: {
    mode: "flat" | "tiered";
    tiers: ShopeeTier[];
  };

  // flag para Full Magalu (desativa crédito de frete)
  isFull?: boolean;
};

type RuleSet = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;

  regime: Regime;
  ufOrigem: string;

  channels: Record<ChannelKey, ChannelRule>;
};

type SettingsStore = {
  activeRuleId: string;
  ruleSets: RuleSet[];
};

const STORAGE_SETTINGS_RULESETS = "markup_settings_rulesets_v1";

function uuid() {
  return crypto?.randomUUID?.() ?? `id_${Math.random().toString(16).slice(2)}_${Date.now()}`;
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

function defaultRuleSet(name = "Regra Padrão", regime: Regime = "simples"): RuleSet {
  const now = new Date().toISOString();

  const shopeeTiers: ShopeeTier[] = [
    { min: 0, max: 79.99, commissionPercent: 20, taxFixed: 4 },
    { min: 80, max: 99.99, commissionPercent: 14, taxFixed: 16 },
    { min: 100, max: 199.99, commissionPercent: 14, taxFixed: 20 },
    { min: 200, max: 499.99, commissionPercent: 14, taxFixed: 26 },
    { min: 500, max: null, commissionPercent: 14, taxFixed: 26 },
  ];

  const hasCreditsDefault = regime === "normal";
  const defaultMainTax = regime === "normal" ? 18 : 14;

  return {
    id: uuid(),
    name,
    createdAt: now,
    updatedAt: now,
    regime,
    ufOrigem: "RS",
    channels: {
      magalu: {
        commissionPercent: 18,
        taxFixed: 5,
        mainTaxPercent: defaultMainTax,
        hasCredits: hasCreditsDefault,
        creditFretePercent: 21.25,
        creditCommissionPercent: 9.25,
        targetMarginPercent: 20,
        isFull: false,
      },
      meli: {
        commissionPercent: 11.5,
        taxFixed: 0,
        mainTaxPercent: defaultMainTax,
        hasCredits: hasCreditsDefault,
        creditFretePercent: 21.25,
        creditCommissionPercent: 9.25,
        targetMarginPercent: 20,
        meli: {
          classicCommissionPercent: 11.5,
          premiumCommissionPercent: 16.5,
        },
      },
      shopee: {
        commissionPercent: 14,
        taxFixed: 26,
        mainTaxPercent: defaultMainTax,
        hasCredits: hasCreditsDefault,
        creditFretePercent: 21.25,
        creditCommissionPercent: 9.25,
        targetMarginPercent: 20,
        shopee: {
          mode: "tiered",
          tiers: shopeeTiers,
        },
      },
      site: {
        commissionPercent: 2,
        taxFixed: 0,
        mainTaxPercent: defaultMainTax,
        hasCredits: hasCreditsDefault,
        creditFretePercent: 21.25,
        creditCommissionPercent: 9.25,
        targetMarginPercent: 20,
      },
      outros: {
        commissionPercent: 20,
        taxFixed: 0,
        mainTaxPercent: defaultMainTax,
        hasCredits: hasCreditsDefault,
        creditFretePercent: 21.25,
        creditCommissionPercent: 9.25,
        targetMarginPercent: 20,
      },
    },
  };
}

/**
 * ✅ MIGRAÇÃO/VALIDAÇÃO: garante que regras antigas tenham os novos canais e campos mínimos
 * Isso evita crash ao clicar em "Site" e "Outros".
 */
function ensureRuleSetComplete(rule: RuleSet): RuleSet {
  const base = defaultRuleSet(rule.name || "Regra", rule.regime || "simples");

  const mergedChannels: Record<ChannelKey, ChannelRule> = {
    magalu: { ...base.channels.magalu, ...(rule.channels as any)?.magalu },
    meli: { ...base.channels.meli, ...(rule.channels as any)?.meli },
    shopee: { ...base.channels.shopee, ...(rule.channels as any)?.shopee },
    site: { ...base.channels.site, ...(rule.channels as any)?.site },
    outros: { ...base.channels.outros, ...(rule.channels as any)?.outros },
  };

  // garante sub-objetos do MELI
  if (mergedChannels.meli.meli) {
    mergedChannels.meli.meli = {
      ...base.channels.meli.meli!,
      ...mergedChannels.meli.meli,
    };
  } else {
    mergedChannels.meli.meli = { ...base.channels.meli.meli! };
  }

  // garante sub-objetos da SHOPEE
  if (mergedChannels.shopee.shopee) {
    mergedChannels.shopee.shopee = {
      ...base.channels.shopee.shopee!,
      ...mergedChannels.shopee.shopee,
      tiers:
        mergedChannels.shopee.shopee.mode === "tiered"
          ? (mergedChannels.shopee.shopee.tiers?.length ? mergedChannels.shopee.shopee.tiers : base.channels.shopee.shopee!.tiers)
          : mergedChannels.shopee.shopee.tiers ?? base.channels.shopee.shopee!.tiers,
    };
  } else {
    mergedChannels.shopee.shopee = { ...base.channels.shopee.shopee! };
  }

  return {
    ...base,
    ...rule,
    channels: mergedChannels,
  };
}

export default function ConfiguracoesPage() {
  const [store, setStore] = useState<SettingsStore | null>(null);

  // UI state
  const [newRuleName, setNewRuleName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_SETTINGS_RULESETS);
      if (raw) {
        const parsed = JSON.parse(raw) as SettingsStore;

        if (parsed?.ruleSets?.length) {
          // ✅ MIGRA: completa/migra regras antigas (inclui site/outros)
          const migratedRules = parsed.ruleSets.map((r) => ensureRuleSetComplete(r));
          const activeExists = migratedRules.some((r) => r.id === parsed.activeRuleId);
          const next: SettingsStore = {
            activeRuleId: activeExists ? parsed.activeRuleId : migratedRules[0].id,
            ruleSets: migratedRules,
          };
          setStore(next);
          localStorage.setItem(STORAGE_SETTINGS_RULESETS, JSON.stringify(next));
          return;
        }
      }
    } catch {}

    // primeira carga
    const r1 = defaultRuleSet("Regra Padrão", "simples");
    const init: SettingsStore = { activeRuleId: r1.id, ruleSets: [r1] };
    setStore(init);
    localStorage.setItem(STORAGE_SETTINGS_RULESETS, JSON.stringify(init));
  }, []);

  function persist(next: SettingsStore) {
    setStore(next);
    try {
      localStorage.setItem(STORAGE_SETTINGS_RULESETS, JSON.stringify(next));
    } catch {}
  }

  const activeRule = useMemo(() => {
    if (!store) return null;
    return store.ruleSets.find((r) => r.id === store.activeRuleId) || store.ruleSets[0] || null;
  }, [store]);

  function setActiveRule(id: string) {
    if (!store) return;
    persist({ ...store, activeRuleId: id });
  }

  function createRule() {
    if (!store) return;
    const name = (newRuleName || "").trim() || `Regra ${store.ruleSets.length + 1}`;
    const rule = defaultRuleSet(name, "simples");
    const next: SettingsStore = { activeRuleId: rule.id, ruleSets: [rule, ...store.ruleSets] };
    persist(next);
    setNewRuleName("");
  }

  function duplicateRule(id: string) {
    if (!store) return;
    const base = store.ruleSets.find((r) => r.id === id);
    if (!base) return;
    const now = new Date().toISOString();
    const copy: RuleSet = {
      ...base,
      id: uuid(),
      name: `${base.name} (cópia)`,
      createdAt: now,
      updatedAt: now,
    };
    persist({ activeRuleId: copy.id, ruleSets: [ensureRuleSetComplete(copy), ...store.ruleSets] });
  }

  function deleteRule(id: string) {
    if (!store) return;

    if (store.ruleSets.length === 1) {
      alert("Você precisa ter pelo menos uma regra ativa.");
      return;
    }

    const nextRules = store.ruleSets.filter((r) => r.id !== id);
    const nextActive = store.activeRuleId === id ? nextRules[0].id : store.activeRuleId;
    persist({ activeRuleId: nextActive, ruleSets: nextRules });
  }

  function startRename(rule: RuleSet) {
    setRenamingId(rule.id);
    setRenameValue(rule.name);
  }

  function applyRename() {
    if (!store || !renamingId) return;
    const name = renameValue.trim();
    if (!name) return;
    const now = new Date().toISOString();

    const nextRules = store.ruleSets.map((r) => (r.id === renamingId ? { ...r, name, updatedAt: now } : r));
    persist({ ...store, ruleSets: nextRules });
    setRenamingId(null);
    setRenameValue("");
  }

  function updateActive(patch: Partial<RuleSet>) {
    if (!store || !activeRule) return;
    const now = new Date().toISOString();

    let finalPatch = { ...patch };

    // ✅ Se mudou regime: aplica hasCredits e imposto para TODOS os canais existentes (inclui site/outros)
    if (patch.regime && patch.regime !== activeRule.regime) {
      const newHasCredits = patch.regime === "normal";
      const newMainTax = patch.regime === "normal" ? 18 : 14;

      const completed = ensureRuleSetComplete(activeRule);
      const nextChannels = (Object.keys(completed.channels) as ChannelKey[]).reduce((acc, k) => {
        acc[k] = {
          ...completed.channels[k],
          hasCredits: newHasCredits,
          mainTaxPercent: newMainTax,
        };
        return acc;
      }, {} as Record<ChannelKey, ChannelRule>);

      finalPatch = {
        ...finalPatch,
        channels: nextChannels,
      };
    }

    const nextRules = store.ruleSets.map((r) =>
      r.id === activeRule.id ? ensureRuleSetComplete({ ...r, ...finalPatch, updatedAt: now } as RuleSet) : ensureRuleSetComplete(r)
    );
    persist({ ...store, ruleSets: nextRules });
  }

  function updateChannel(channel: ChannelKey, patch: Partial<ChannelRule>) {
    if (!activeRule) return;

    const safe = ensureRuleSetComplete(activeRule);

    updateActive({
      channels: {
        ...safe.channels,
        [channel]: { ...safe.channels[channel], ...patch },
      },
    });
  }

  function updateShopeeTier(idx: number, patch: Partial<ShopeeTier>) {
    if (!activeRule) return;

    const safe = ensureRuleSetComplete(activeRule);
    const ch = safe.channels.shopee;
    const sh = ch.shopee;
    if (!sh) return;

    const tiers = sh.tiers.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    updateChannel("shopee", {
      shopee: { ...sh, tiers },
    });
  }

  if (!store || !activeRule) {
    return (
      <div className="space-y-5">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h1 className="text-2xl font-semibold">Configurações</h1>
          <p className="mt-1 text-sm text-white/60">Carregando…</p>
        </section>
      </div>
    );
  }

  // ✅ garante que a regra ativa sempre está completa antes de usar
  const safeActive = ensureRuleSetComplete(activeRule);

  const chMagalu = safeActive.channels.magalu;
  const chMeli = safeActive.channels.meli;
  const chShopee = safeActive.channels.shopee;
  const chSite = safeActive.channels.site;
  const chOutros = safeActive.channels.outros;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="mt-1 text-sm text-white/60">
          Crie e salve <b>regras padrão</b> por canal. A <b>regra ativa</b> é usada na Precificação.
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          {/* COLUNA: LISTA DE REGRAS */}
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Regras padrão</p>
              <span className="text-xs text-white/50">{store.ruleSets.length} regra(s)</span>
            </div>

            <div className="mt-3 flex gap-2">
              <input
                value={newRuleName}
                onChange={(e) => setNewRuleName(e.target.value)}
                placeholder="Nome da nova regra…"
                className="h-10 w-full rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
              />
              <button
                type="button"
                onClick={createRule}
                className="h-10 rounded-xl bg-blue-600/20 px-3 text-sm font-semibold text-blue-100 ring-1 ring-blue-500/30 hover:bg-blue-600/25"
              >
                Criar
              </button>
            </div>

            {/* rename */}
            {renamingId ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-white/60">Renomear regra</p>
                <div className="mt-2 flex gap-2">
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="h-10 w-full rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                  />
                  <button
                    type="button"
                    onClick={applyRename}
                    className="h-10 rounded-xl bg-emerald-600/20 px-3 text-sm font-semibold text-emerald-100 ring-1 ring-emerald-500/30 hover:bg-emerald-600/25"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(null);
                      setRenameValue("");
                    }}
                    className="h-10 rounded-xl bg-white/5 px-3 text-sm font-semibold text-white/80 ring-1 ring-white/10 hover:bg-white/10"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid gap-2">
              {store.ruleSets.map((r) => {
                const rr = ensureRuleSetComplete(r);
                const isActive = rr.id === store.activeRuleId;
                return (
                  <div
                    key={rr.id}
                    className={
                      "rounded-2xl border p-3 " + (isActive ? "border-blue-500/30 bg-blue-500/10" : "border-white/10 bg-neutral-950/20")
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button type="button" onClick={() => setActiveRule(rr.id)} className="text-left" title="Selecionar regra">
                        <p className="text-sm font-semibold text-white">{rr.name}</p>
                        <p className="mt-1 text-xs text-white/60">
                          Regime: <b>{rr.regime === "normal" ? "Normal" : "Simples"}</b> • UF: <b>{rr.ufOrigem}</b>
                        </p>
                      </button>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startRename(rr)}
                          className="rounded-xl bg-white/5 px-2 py-1 text-xs text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                        >
                          Renomear
                        </button>
                        <button
                          type="button"
                          onClick={() => duplicateRule(rr.id)}
                          className="rounded-xl bg-white/5 px-2 py-1 text-xs text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                        >
                          Duplicar
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRule(rr.id)}
                          className="rounded-xl bg-red-600/15 px-2 py-1 text-xs text-red-100 ring-1 ring-red-500/20 hover:bg-red-600/20"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>

                    {isActive ? (
                      <div className="mt-2 inline-flex rounded-xl bg-blue-500/15 px-2 py-1 text-[11px] font-semibold text-blue-100 ring-1 ring-blue-500/20">
                        Regra ativa
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-white/60">
              A regra ativa será usada como <b>padrão</b> na Precificação.
            </div>
          </div>

          {/* COLUNA: EDITAR REGRA ATIVA */}
          <div className="space-y-4">
            {/* Geral */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <p className="text-sm font-semibold">Geral (regra ativa)</p>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs text-white/60">Regime tributário</p>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => updateActive({ regime: "simples" })}
                      className={
                        safeActive.regime === "simples"
                          ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                          : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                      }
                    >
                      Simples Nacional
                    </button>
                    <button
                      type="button"
                      onClick={() => updateActive({ regime: "normal" })}
                      className={
                        safeActive.regime === "normal"
                          ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
                          : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                      }
                    >
                      Regime Normal
                    </button>
                  </div>

                  <p className="mt-3 text-[11px] text-white/50">
                    Regime Normal ativa créditos automaticamente e aplica PIS/COFINS sobre (POR − imposto).
                  </p>
                  <p className="mt-1 text-[11px] text-white/50">
                    Padrão do app: Regime Normal = Imposto 18% | Simples = Imposto 14% • PIS/COFINS 9,25% (apenas no Normal).
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs text-white/60">UF de origem</p>
                  <select
                    value={safeActive.ufOrigem}
                    onChange={(e) => updateActive({ ufOrigem: e.target.value })}
                    className="mt-3 h-10 w-full rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                  >
                    {["RS", "SC", "PR", "SP", "RJ", "MG", "BA", "PE", "CE", "GO", "DF"].map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </select>

                  <p className="mt-3 text-[11px] text-white/50">A UF será usada para regras fiscais regionais no futuro.</p>
                </div>
              </div>
            </div>

            {/* Tabs por canal */}
            <ChannelTabs
              magalu={chMagalu}
              meli={chMeli}
              shopee={chShopee}
              site={chSite}
              outros={chOutros}
              onMagalu={(patch) => updateChannel("magalu", patch)}
              onMeli={(patch) => updateChannel("meli", patch)}
              onShopee={(patch) => updateChannel("shopee", patch)}
              onSite={(patch) => updateChannel("site", patch)}
              onOutros={(patch) => updateChannel("outros", patch)}
              onShopeeTier={(idx, patch) => updateShopeeTier(idx, patch)}
              regime={safeActive.regime}
            />
          </div>
        </div>
      </section>
    </div>
  );
}

/* ---------------- UI COMPONENTS ---------------- */

function ChannelTabs(props: {
  magalu: ChannelRule;
  meli: ChannelRule;
  shopee: ChannelRule;
  site: ChannelRule;
  outros: ChannelRule;

  onMagalu: (patch: Partial<ChannelRule>) => void;
  onMeli: (patch: Partial<ChannelRule>) => void;
  onShopee: (patch: Partial<ChannelRule>) => void;
  onSite: (patch: Partial<ChannelRule>) => void;
  onOutros: (patch: Partial<ChannelRule>) => void;

  onShopeeTier: (idx: number, patch: Partial<ShopeeTier>) => void;
  regime: Regime;
}) {
  const [tab, setTab] = useState<ChannelKey>("magalu");

  const current =
    tab === "magalu"
      ? props.magalu
      : tab === "meli"
      ? props.meli
      : tab === "shopee"
      ? props.shopee
      : tab === "site"
      ? props.site
      : props.outros;

  const onChange =
    tab === "magalu"
      ? props.onMagalu
      : tab === "meli"
      ? props.onMeli
      : tab === "shopee"
      ? props.onShopee
      : tab === "site"
      ? props.onSite
      : props.onOutros;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Parâmetros por canal (regra ativa)</p>

        <div className="flex flex-wrap gap-2">
          <TabBtn active={tab === "magalu"} onClick={() => setTab("magalu")}>
            Magalu
          </TabBtn>
          <TabBtn active={tab === "meli"} onClick={() => setTab("meli")}>
            Mercado Livre
          </TabBtn>
          <TabBtn active={tab === "shopee"} onClick={() => setTab("shopee")}>
            Shopee
          </TabBtn>
          <TabBtn active={tab === "site"} onClick={() => setTab("site")}>
            Site
          </TabBtn>
          <TabBtn active={tab === "outros"} onClick={() => setTab("outros")}>
            Outros
          </TabBtn>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* bloco esquerdo */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-semibold text-white/70">{tab.toUpperCase()}</p>

          {/* MAGALU: flag Full */}
          {tab === "magalu" ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">Envio Full Magalu</p>
                  <p className="mt-1 text-[11px] text-white/50">
                    Quando ativo, <b>não credita frete</b> (independente do regime).
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => props.onMagalu({ isFull: !current.isFull })}
                  className={
                    current.isFull
                      ? "rounded-xl bg-orange-500/15 px-3 py-2 text-xs font-semibold text-orange-100 ring-1 ring-orange-500/20"
                      : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                  }
                >
                  {current.isFull ? "Full ativo" : "Envio próprio"}
                </button>
              </div>
            </div>
          ) : null}

          {/* MELI especial */}
          {tab === "meli" && current.meli ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-sm font-semibold">Comissão (Clássico / Premium)</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <NumInput
                  label="Clássico (%)"
                  value={String(current.meli.classicCommissionPercent)}
                  onChange={(v) =>
                    props.onMeli({
                      meli: { ...current.meli!, classicCommissionPercent: parseNumberPt(v) },
                      commissionPercent: parseNumberPt(v),
                    })
                  }
                />
                <NumInput
                  label="Premium (%)"
                  value={String(current.meli.premiumCommissionPercent)}
                  onChange={(v) =>
                    props.onMeli({
                      meli: { ...current.meli!, premiumCommissionPercent: parseNumberPt(v) },
                    })
                  }
                />
              </div>
              <p className="mt-2 text-[11px] text-white/50">
                Na Precificação você escolhe Clássico ou Premium e o app usa a comissão correspondente.
              </p>
            </div>
          ) : null}

          {/* SHOPEE especial */}
          {tab === "shopee" && current.shopee ? (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold">Comissão Shopee (por faixa)</p>

                <select
                  value={current.shopee.mode}
                  onChange={(e) => props.onShopee({ shopee: { ...current.shopee!, mode: e.target.value as any } })}
                  className="h-9 rounded-xl bg-neutral-950/60 px-3 text-xs text-white ring-1 ring-white/10 outline-none"
                >
                  <option value="tiered">Por faixa</option>
                  <option value="flat">Fixa</option>
                </select>
              </div>

              {current.shopee.mode === "tiered" ? (
                <div className="mt-3 grid gap-2">
                  {current.shopee.tiers.map((t, idx) => (
                    <div key={idx} className="rounded-xl border border-white/10 bg-neutral-950/30 p-3">
                      <p className="text-xs text-white/60">
                        Faixa: <b>R$ {fmtPt(t.min)}</b> até <b>{t.max == null ? "∞" : `R$ ${fmtPt(t.max)}`}</b>
                      </p>
                      <div className="mt-2 grid gap-3 grid-cols-2">
                        <NumInput
                          label="Comissão (%)"
                          value={String(t.commissionPercent)}
                          onChange={(v) => props.onShopeeTier(idx, { commissionPercent: parseNumberPt(v) })}
                        />
                        <NumInput
                          label="Taxa fixa (R$)"
                          value={String(t.taxFixed)}
                          onChange={(v) => props.onShopeeTier(idx, { taxFixed: parseNumberPt(v) })}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-[11px] text-white/50">
                  No modo fixo, use os campos "Comissão (%)" e "Taxa fixa (R$)" abaixo.
                </p>
              )}

              <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] text-amber-100">
                No cálculo, a Shopee por faixa depende do <b>preço final</b>. O app ajusta automaticamente.
              </div>
            </div>
          ) : null}

          {/* Campos padrões (para todos) */}
          <div className="mt-4 grid gap-3">
            <NumInput
              label="Margem alvo (%)"
              value={String(current.targetMarginPercent ?? 0)}
              onChange={(v) => onChange({ targetMarginPercent: clamp(parseNumberPt(v), 0, 95) })}
            />
            <NumInput
              label="Comissão (%)"
              value={String(current.commissionPercent)}
              onChange={(v) => onChange({ commissionPercent: parseNumberPt(v) })}
            />
            <NumInput
              label="Taxa fixa (R$)"
              value={String(current.taxFixed)}
              onChange={(v) => onChange({ taxFixed: parseNumberPt(v) })}
            />
            <NumInput
              label="Imposto principal (%)"
              value={String(current.mainTaxPercent)}
              onChange={(v) => onChange({ mainTaxPercent: parseNumberPt(v) })}
            />
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Créditos (frete/comissão)</p>
                <p className="mt-1 text-[11px] text-white/50">
                  {props.regime === "normal" ? "Regime Normal: créditos ativos por padrão." : "Simples: créditos inativos por padrão."}
                </p>
              </div>

              <button
                type="button"
                onClick={() => onChange({ hasCredits: !current.hasCredits })}
                className={
                  current.hasCredits
                    ? "rounded-xl bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-100 ring-1 ring-emerald-500/20"
                    : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
                }
              >
                {current.hasCredits ? "Ativo" : "Inativo"}
              </button>
            </div>

            {tab === "magalu" && current.isFull ? (
              <div className="mt-3 rounded-xl border border-orange-500/20 bg-orange-500/10 p-3 text-[11px] text-orange-100">
                ⚠️ <b>Full Magalu ativo:</b> Crédito de frete será ignorado no cálculo, mesmo se os créditos estiverem ativos.
              </div>
            ) : null}
          </div>
        </div>

        {/* bloco direito */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs font-semibold text-white/70">CRÉDITOS (REGIME NORMAL)</p>

          <div className="mt-4 grid gap-3">
            <NumInput
              label="Crédito de frete (% sobre frete)"
              value={String(current.creditFretePercent)}
              onChange={(v) => onChange({ creditFretePercent: clamp(parseNumberPt(v), 0, 100) })}
            />
            <NumInput
              label="Crédito de comissão (% sobre comissão)"
              value={String(current.creditCommissionPercent)}
              onChange={(v) => onChange({ creditCommissionPercent: clamp(parseNumberPt(v), 0, 100) })}
            />
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-neutral-950/30 p-3 text-[11px] text-white/60">
            Importante: Rebate, desconto e cupom são por produto e entram na Precificação.
          </div>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-xl bg-white/15 px-3 py-2 text-xs font-semibold ring-1 ring-white/10"
          : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/70 ring-1 ring-white/10 hover:bg-white/10"
      }
    >
      {children}
    </button>
  );
}

function NumInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="grid gap-1">
      <span className="text-xs text-white/60">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode="decimal"
        className="h-10 w-full rounded-xl bg-neutral-950/60 px-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
      />
    </label>
  );
}
