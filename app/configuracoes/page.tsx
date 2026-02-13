"use client";

import { useEffect, useMemo, useState } from "react";
import { saveSettings, loadSettings } from "@/lib/sync-utils";

type ChannelKey = "magalu" | "meli" | "shopee" | "site" | "outros";
type Regime = "simples" | "normal";

type RuleSet = {
  id: string;
  name: string;
  regime: Regime;
  ufOrigem: string;
  channels: Record<
    ChannelKey,
    {
      commissionPercent: number; // %
      taxFixed: number; // R$
      mainTaxPercent: number; // %
      hasCredits: boolean;
      creditFretePercent: number; // %
      creditCommissionPercent: number; // %
    }
  >;
};

type SettingsStore = {
  activeRuleId: string;
  ruleSets: RuleSet[];
};

const STORAGE_SETTINGS_RULESETS = "markup_settings_rulesets_v1";

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function defaultRuleSet(name = "Regra Padrão", regime: Regime = "simples"): RuleSet {
  const mainTaxPercent = regime === "normal" ? 18 : 14;

  const baseChannel = {
    commissionPercent: 0,
    taxFixed: 0,
    mainTaxPercent,
    hasCredits: false,
    creditFretePercent: 0,
    creditCommissionPercent: 0,
  };

  return {
    id: uid(),
    name,
    regime,
    ufOrigem: "RS",
    channels: {
      magalu: { ...baseChannel, commissionPercent: 16 },
      meli: { ...baseChannel, commissionPercent: 17 },
      shopee: { ...baseChannel, commissionPercent: 14 },
      site: { ...baseChannel, commissionPercent: 0 },
      outros: { ...baseChannel, commissionPercent: 0 },
    },
  };
}

function ensureRuleSetComplete(r: any): RuleSet {
  const fallback = defaultRuleSet(r?.name || "Regra", (r?.regime as Regime) || "simples");
  const merged: RuleSet = {
    ...fallback,
    ...r,
    channels: { ...fallback.channels, ...(r?.channels || {}) },
  };
  // garante campos por canal
  (Object.keys(merged.channels) as ChannelKey[]).forEach((k) => {
    merged.channels[k] = { ...fallback.channels[k], ...(merged.channels[k] || {}) };
  });
  return merged;
}

export default function ConfiguracoesPage() {
  const [store, setStore] = useState<SettingsStore | null>(null);

  // ✅ NOVO
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const active = useMemo(() => {
    if (!store) return null;
    return store.ruleSets.find((r) => r.id === store.activeRuleId) || store.ruleSets[0] || null;
  }, [store]);

  // ✅ SUBSTITUI useEffect inteiro (conforme tua guia)
  useEffect(() => {
    async function init() {
      setIsSyncing(true);
      try {
        // 1️⃣ Tenta carregar do banco primeiro
        const serverData = await loadSettings();

        if (serverData?.ruleSets?.length > 0) {
          const migratedRules = serverData.ruleSets.map((r: any) => ensureRuleSetComplete(r));
          const activeExists = migratedRules.some((r: any) => r.id === serverData.activeRuleId);
          const next: SettingsStore = {
            activeRuleId: activeExists ? serverData.activeRuleId : migratedRules[0].id,
            ruleSets: migratedRules,
          };
          setStore(next);
          localStorage.setItem(STORAGE_SETTINGS_RULESETS, JSON.stringify(next));
          setLastSyncTime(new Date());
          setIsSyncing(false);
          return;
        }

        // 2️⃣ Fallback: localStorage
        const raw = localStorage.getItem(STORAGE_SETTINGS_RULESETS);
        if (raw) {
          const parsed = JSON.parse(raw) as SettingsStore;
          if (parsed?.ruleSets?.length) {
            const migratedRules = parsed.ruleSets.map((r) => ensureRuleSetComplete(r));
            const activeExists = migratedRules.some((r) => r.id === parsed.activeRuleId);
            const next: SettingsStore = {
              activeRuleId: activeExists ? parsed.activeRuleId : migratedRules[0].id,
              ruleSets: migratedRules,
            };
            setStore(next);
            await saveSettings(next.activeRuleId, next.ruleSets);
            setLastSyncTime(new Date());
            setIsSyncing(false);
            return;
          }
        }
      } catch (error) {
        console.error("Erro ao carregar configurações:", error);
      }

      // 3️⃣ Primeira vez
      const r1 = defaultRuleSet("Regra Padrão", "simples");
      const init: SettingsStore = { activeRuleId: r1.id, ruleSets: [r1] };
      setStore(init);
      localStorage.setItem(STORAGE_SETTINGS_RULESETS, JSON.stringify(init));

      try {
        await saveSettings(init.activeRuleId, init.ruleSets);
        setLastSyncTime(new Date());
      } catch (error) {
        console.error("Erro ao salvar configuração inicial:", error);
      }

      setIsSyncing(false);
    }

    init();
  }, []);

  // ✅ SUBSTITUI persist (conforme tua guia)
  async function persist(next: SettingsStore) {
    setStore(next);
    setIsSyncing(true);

    try {
      localStorage.setItem(STORAGE_SETTINGS_RULESETS, JSON.stringify(next));
      await saveSettings(next.activeRuleId, next.ruleSets);
      setLastSyncTime(new Date());
    } catch (error) {
      console.error("Erro ao persistir configurações:", error);
      alert("Erro ao salvar. Suas alterações podem não estar sincronizadas.");
    } finally {
      setIsSyncing(false);
    }
  }

  function setActiveRule(id: string) {
    if (!store) return;
    persist({ ...store, activeRuleId: id });
  }

  function addRule() {
    if (!store) return;
    const r = defaultRuleSet(`Regra ${store.ruleSets.length + 1}`, "simples");
    persist({ activeRuleId: r.id, ruleSets: [r, ...store.ruleSets] });
  }

  function deleteRule(id: string) {
    if (!store) return;
    if (store.ruleSets.length <= 1) return alert("Você precisa ter pelo menos 1 regra.");
    const nextRules = store.ruleSets.filter((r) => r.id !== id);
    const nextActive = store.activeRuleId === id ? nextRules[0].id : store.activeRuleId;
    persist({ activeRuleId: nextActive, ruleSets: nextRules });
  }

  function updateActive(patch: Partial<RuleSet>) {
    if (!store || !active) return;
    const nextRules = store.ruleSets.map((r) => (r.id === active.id ? { ...r, ...patch } : r));
    persist({ ...store, ruleSets: nextRules });
  }

  function updateChannel(channel: ChannelKey, patch: Partial<RuleSet["channels"][ChannelKey]>) {
    if (!store || !active) return;
    const next = {
      ...active,
      channels: {
        ...active.channels,
        [channel]: {
          ...active.channels[channel],
          ...patch,
        },
      },
    };
    updateActive(next);
  }

  if (!store || !active) {
    return (
      <div className="p-6 text-white">
        <div className="animate-pulse text-white/70">Carregando configurações...</div>
      </div>
    );
  }

  const channels: ChannelKey[] = ["magalu", "meli", "shopee", "site", "outros"];

  return (
    <div className="p-6 text-white">
      <section className="mb-6 rounded-xl border border-white/10 bg-white/5 p-5">
        {/* ✅ NOVO: Indicador de sincronização */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Configurações</h1>
            <p className="mt-1 text-sm text-white/60">
              Crie e salve <b>regras padrão</b> por canal.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {isSyncing ? (
              <div className="flex items-center gap-2 text-blue-300">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-transparent" />
                <span className="text-sm">Sincronizando...</span>
              </div>
            ) : lastSyncTime ? (
              <div className="flex items-center gap-2 text-green-300">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="text-sm">Sincronizado {lastSyncTime.toLocaleTimeString("pt-BR")}</span>
              </div>
            ) : null}

            <button
              onClick={addRule}
              className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/15"
            >
              + Nova regra
            </button>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Lista */}
        <aside className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 text-sm text-white/60">Minhas regras</div>
          <div className="space-y-2">
            {store.ruleSets.map((r) => (
              <button
                key={r.id}
                onClick={() => setActiveRule(r.id)}
                className={[
                  "w-full rounded-lg border px-3 py-2 text-left text-sm",
                  r.id === store.activeRuleId
                    ? "border-white/20 bg-white/10"
                    : "border-white/10 bg-transparent hover:bg-white/5",
                ].join(" ")}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.name}</div>
                    <div className="truncate text-xs text-white/60">
                      {r.regime.toUpperCase()} • UF {r.ufOrigem}
                    </div>
                  </div>
                  <span
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      deleteRule(r.id);
                    }}
                    className="cursor-pointer rounded-md px-2 py-1 text-xs text-red-300 hover:bg-white/10"
                    title="Excluir regra"
                  >
                    Excluir
                  </span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        {/* Editor */}
        <main className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <label className="block">
              <div className="mb-1 text-xs text-white/60">Nome</div>
              <input
                value={active.name}
                onChange={(e) => updateActive({ name: e.target.value })}
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs text-white/60">Regime</div>
              <select
                value={active.regime}
                onChange={(e) => updateActive({ regime: e.target.value as Regime })}
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
              >
                <option value="simples">Simples</option>
                <option value="normal">Normal</option>
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs text-white/60">UF Origem</div>
              <input
                value={active.ufOrigem}
                onChange={(e) => updateActive({ ufOrigem: e.target.value.toUpperCase().slice(0, 2) })}
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
              />
            </label>
          </div>

          <div className="text-sm font-semibold">Canais</div>
          <div className="mt-3 space-y-4">
            {channels.map((ch) => (
              <div key={ch} className="rounded-xl border border-white/10 bg-black/10 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-medium">{ch.toUpperCase()}</div>
                  <div className="text-xs text-white/50">Regras padrão</div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <FieldNumber
                    label="Comissão (%)"
                    value={active.channels[ch].commissionPercent}
                    onChange={(v) => updateChannel(ch, { commissionPercent: v })}
                  />
                  <FieldNumber
                    label="Taxa fixa (R$)"
                    value={active.channels[ch].taxFixed}
                    onChange={(v) => updateChannel(ch, { taxFixed: v })}
                  />
                  <FieldNumber
                    label="Imposto principal (%)"
                    value={active.channels[ch].mainTaxPercent}
                    onChange={(v) => updateChannel(ch, { mainTaxPercent: v })}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-white/80">
                    <input
                      type="checkbox"
                      checked={active.channels[ch].hasCredits}
                      onChange={(e) => updateChannel(ch, { hasCredits: e.target.checked })}
                    />
                    Tem créditos
                  </label>

                  <div className="grid w-full gap-3 md:w-auto md:grid-cols-2">
                    <FieldNumber
                      label="Crédito frete (%)"
                      value={active.channels[ch].creditFretePercent}
                      onChange={(v) => updateChannel(ch, { creditFretePercent: v })}
                    />
                    <FieldNumber
                      label="Crédito comissão (%)"
                      value={active.channels[ch].creditCommissionPercent}
                      onChange={(v) => updateChannel(ch, { creditCommissionPercent: v })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 text-xs text-white/50">
            Dica: toda mudança aqui salva no localStorage e sincroniza no banco (por usuário).
          </div>
        </main>
      </div>
    </div>
  );
}

function FieldNumber(props: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs text-white/60">{props.label}</div>
      <input
        type="number"
        value={Number.isFinite(props.value) ? props.value : 0}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/20"
      />
    </label>
  );
}
