"use client";

import { useEffect, useMemo, useState } from "react";

type ChannelKey = "magalu" | "meli" | "shopee" | "site" | "outros" | "site_modifika";
type Regime = "normal" | "simples";
type MeliPlan = "classic" | "premium";

type ShopeeTier = {
  min: number;
  max: number | null;
  commissionPercent: number;
  taxFixed: number;
};

type RuleSetData = {
  regime: Regime; // padrão: normal
  ufOrigem: string;

  channels: Record<
    ChannelKey,
    {
      enabled: boolean;
      commissionPercent: number;
      taxFixed: number;
      mainTaxPercent: number; // imposto principal — mesmo valor em todos os canais da empresa
      targetMarginPercent: number; // margem desejada por canal
      pisCofinsPercent?: number;
      cardFeePercent?: number;
      influencerPercent?: number;
      incentiveCreditPercent?: number;
      hasCredits?: boolean;
      creditFretePercent?: number;
      creditCommissionPercent?: number;
    }
  >;

  meli: {
    plan: MeliPlan;
    classicCommissionPercent: number;
    premiumCommissionPercent: number;
  };

  shopeeTiers: ShopeeTier[];
};

type EmpresaRow = {
  id: string;
  name: string;
  isActive: boolean;
  data: RuleSetData;
  updatedAt: string;
};

function num(v: any, fallback = 0) {
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export default function ConfiguracoesPage() {
  const [empresas, setEmpresas] = useState<EmpresaRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<RuleSetData | null>(null);

  const [newName, setNewName] = useState("Nova empresa");
  const [renameText, setRenameText] = useState("");
  const [status, setStatus] = useState<string>("");

  const selected = useMemo(() => empresas.find((r) => r.id === selectedId) ?? null, [empresas, selectedId]);
  const padrao = useMemo(() => empresas.find((r) => r.isActive) ?? null, [empresas]);

  async function load() {
    setStatus("Carregando...");
    const res = await fetch("/api/settings/rulesets", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json?.error ?? "Erro ao carregar");
      return;
    }
    const list = (json?.rulesets ?? []) as EmpresaRow[];
    setEmpresas(list);

    const activeId = list.find((x) => x.isActive)?.id ?? list[0]?.id ?? "";
    setSelectedId(activeId);
    setDraft(activeId ? deepClone(list.find((x) => x.id === activeId)!.data) : null);
    setRenameText(list.find((x) => x.id === activeId)?.name ?? "");
    setStatus("");
  }

  useEffect(() => {
    // Carga inicial única (fetch): não é sincronização de props/estado já disponível em
    // React, é o caso legítimo de efeito. Ver contraste com o ajuste durante a renderização logo abaixo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  // Quando o usuário troca de empresa (dropdown), o draft/nome exibidos precisam
  // resetar para os dados da nova empresa. Ajuste durante a renderização (em vez de useEffect)
  // evita uma passagem de render extra — ver "Adjusting state when a prop changes" nos docs do React.
  const [prevSelectedId, setPrevSelectedId] = useState(selectedId);
  if (selected && selectedId !== prevSelectedId) {
    setPrevSelectedId(selectedId);
    setDraft(deepClone(selected.data));
    setRenameText(selected.name);
  }

  function setRegime(regime: Regime) {
    if (!draft) return;
    const mainTaxPercent = regime === "normal" ? 18 : 14;

    const next = deepClone(draft);
    next.regime = regime;

    // Imposto principal é o mesmo em todos os canais desta empresa.
    (Object.keys(next.channels) as ChannelKey[]).forEach((k) => {
      next.channels[k].mainTaxPercent = mainTaxPercent;
    });

    setDraft(next);
  }

  function setImpostoPrincipal(v: string) {
    if (!draft) return;
    const value = num(v, draft.regime === "normal" ? 18 : 14);
    const next = deepClone(draft);
    (Object.keys(next.channels) as ChannelKey[]).forEach((k) => {
      next.channels[k].mainTaxPercent = value;
    });
    setDraft(next);
  }

  function updateChannel(k: ChannelKey, patch: Partial<RuleSetData["channels"][ChannelKey]>) {
    if (!draft) return;
    const next = deepClone(draft);
    next.channels[k] = { ...next.channels[k], ...patch };
    setDraft(next);
  }

  function updateMeli(patch: Partial<RuleSetData["meli"]>) {
    if (!draft) return;
    const next = deepClone(draft);
    next.meli = { ...next.meli, ...patch };
    setDraft(next);
  }

  function updateShopeeTier(idx: number, patch: Partial<ShopeeTier>) {
    if (!draft) return;
    const next = deepClone(draft);
    next.shopeeTiers[idx] = { ...next.shopeeTiers[idx], ...patch };
    setDraft(next);
  }

  function addShopeeTier() {
    if (!draft) return;
    const next = deepClone(draft);
    next.shopeeTiers.push({ min: 0, max: null, commissionPercent: 0, taxFixed: 0 });
    setDraft(next);
  }

  function removeShopeeTier(idx: number) {
    if (!draft) return;
    const next = deepClone(draft);
    next.shopeeTiers.splice(idx, 1);
    setDraft(next);
  }

  async function save() {
    if (!draft || !selectedId) return;
    setStatus("Salvando...");
    const res = await fetch("/api/settings/rulesets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedId, action: "save", data: draft }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json?.error ?? "Erro ao salvar");
      return;
    }
    setStatus("✅ Salvo");
    await load();
  }

  async function activate() {
    if (!selectedId) return;
    setStatus("Definindo como padrão...");
    const res = await fetch("/api/settings/rulesets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedId, action: "activate" }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json?.error ?? "Erro ao definir como padrão");
      return;
    }
    setStatus("✅ Empresa padrão definida");
    await load();
  }

  async function createNew() {
    if (!draft) return;
    setStatus("Criando...");
    const res = await fetch("/api/settings/rulesets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, data: draft }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json?.error ?? "Erro ao criar");
      return;
    }
    setStatus("✅ Empresa criada");
    await load();
  }

  async function rename() {
    if (!selectedId) return;
    setStatus("Renomeando...");
    const res = await fetch("/api/settings/rulesets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedId, action: "rename", name: renameText }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json?.error ?? "Erro ao renomear");
      return;
    }
    setStatus("✅ Renomeado");
    await load();
  }

  async function removeEmpresa() {
    if (!selectedId) return;
    const row = empresas.find((r) => r.id === selectedId);
    if (row?.isActive) {
      setStatus("❌ Defina outra empresa como padrão antes de excluir esta.");
      return;
    }
    setStatus("Excluindo...");
    const res = await fetch(`/api/settings/rulesets?id=${encodeURIComponent(selectedId)}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json?.error ?? "Erro ao excluir");
      return;
    }
    setStatus("✅ Excluído");
    await load();
  }

  if (!draft) {
    return (
      <div>
        <h1 className="text-2xl font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Empresas</h1>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>{status || "Inicializando..."}</p>
      </div>
    );
  }

  const mainTax = draft.regime === "normal" ? 18 : 14;
  const impostoPrincipal = draft.channels.magalu?.mainTaxPercent ?? mainTax;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[27px] font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Empresas</h1>
          <p className="mt-1.5 max-w-lg text-sm" style={{ color: "var(--muted)" }}>
            Cada empresa tem sua própria regra tributária, comissões e margens por canal — configure quantas precisar.
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
            Empresa padrão: <span className="font-medium" style={{ color: "var(--text)" }}>{padrao?.name ?? "—"}</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={save}
            className="rounded-full px-5 py-2.5 text-sm font-semibold"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            Salvar
          </button>
          <button
            onClick={activate}
            className="rounded-full border px-5 py-2.5 text-sm font-semibold"
            style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
          >
            Usar como padrão
          </button>
        </div>
      </div>

      {status ? <div className="rounded-xl border px-4 py-2.5 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}>{status}</div> : null}

      {/* Seleção de empresa */}
      <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium">Empresa</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
            >
              {empresas.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <span className="text-xs" style={{ color: "var(--muted)" }}>{empresas.length} empresa{empresas.length === 1 ? "" : "s"} cadastrada{empresas.length === 1 ? "" : "s"}</span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
              placeholder="Nome da empresa"
            />
            <button onClick={rename} className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}>
              Renomear
            </button>
            <button onClick={removeEmpresa} className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}>
              Excluir
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-2 border-t" style={{ borderColor: "var(--border)" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
            placeholder="Nome da nova empresa"
          />
          <button onClick={createNew} className="rounded-lg px-3 py-2 text-sm font-semibold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
            Nova empresa (copia a atual)
          </button>
        </div>
      </div>

      {/* Regime / UF / Imposto principal */}
      <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Regime tributário</h2>

        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Regime</label>
            <select
              value={draft.regime}
              onChange={(e) => setRegime(e.target.value === "simples" ? "simples" : "normal")}
              className="border rounded-lg px-3 py-2 text-sm" style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
            >
              <option value="normal">Regime Normal</option>
              <option value="simples">Simples Nacional — 14%</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">UF origem</label>
            <input
              value={draft.ufOrigem}
              onChange={(e) => setDraft({ ...draft, ufOrigem: e.target.value.toUpperCase().slice(0, 2) })}
              className="border rounded-lg px-3 py-2 text-sm w-20"
              style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
              placeholder="RS"
            />
          </div>

          {draft.regime === "simples" ? (
            <div className="rounded-lg border px-3 py-2 text-sm" style={{ background: "var(--surface-soft)", borderColor: "var(--border)", color: "var(--muted2)" }}>
              Imposto principal fixo em <b style={{ color: "var(--text)" }}>14%</b> no Simples Nacional.
            </div>
          ) : (
            <div className="w-40">
              <Field
                label="Imposto principal %"
                value={impostoPrincipal}
                onChange={setImpostoPrincipal}
              />
            </div>
          )}
        </div>

        {draft.regime === "normal" && (
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            O ICMS varia conforme o estado (UF origem) da empresa — ajuste aqui o percentual correto. Ele vale para todos os canais.
          </p>
        )}
      </div>

      {/* Canais */}
      <div className="rounded-2xl border p-4 space-y-5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Canais</h2>

        {/* MAGALU */}
        <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Magalu</h3>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.channels.magalu.enabled}
                onChange={(e) => updateChannel("magalu", { enabled: e.target.checked })}
              />
              Ativo
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field
              label="Comissão % (padrão)"
              value={draft.channels.magalu.commissionPercent}
              onChange={(v) => updateChannel("magalu", { commissionPercent: num(v, 18) })}
            />
            <Field
              label="Margem desejada %"
              value={draft.channels.magalu.targetMarginPercent}
              onChange={(v) => updateChannel("magalu", { targetMarginPercent: num(v, 15) })}
            />
            <Field
              label="Taxa fixa R$ (por produto)"
              value={draft.channels.magalu.taxFixed}
              onChange={(v) => updateChannel("magalu", { taxFixed: num(v, 5) })}
            />
            <Hint text="Padrão: 18% + R$5/item" />
          </div>
        </div>

        {/* MELI */}
        <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Mercado Livre (Meli)</h3>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.channels.meli.enabled}
                onChange={(e) => updateChannel("meli", { enabled: e.target.checked })}
              />
              Ativo
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium" style={{ color: "var(--muted2)" }}>Plano</div>
              <select
                value={draft.meli.plan}
                onChange={(e) => updateMeli({ plan: e.target.value === "classic" ? "classic" : "premium" })}
                className="border rounded-lg px-3 py-2 text-sm w-full"
                style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
              >
                <option value="classic">Clássico</option>
                <option value="premium">Premium</option>
              </select>
              <div className="text-xs" style={{ color: "var(--muted)" }}>
                A comissão usada no cálculo vem do plano selecionado.
              </div>
            </div>

            <Field
              label="Clássico %"
              value={draft.meli.classicCommissionPercent}
              onChange={(v) => updateMeli({ classicCommissionPercent: num(v, 11.5) })}
            />
            <Field
              label="Premium %"
              value={draft.meli.premiumCommissionPercent}
              onChange={(v) => updateMeli({ premiumCommissionPercent: num(v, 16.5) })}
            />
            <Field
              label="Taxa fixa R$ (opcional)"
              value={draft.channels.meli.taxFixed}
              onChange={(v) => updateChannel("meli", { taxFixed: num(v, 0) })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field
              label="Margem desejada %"
              value={draft.channels.meli.targetMarginPercent}
              onChange={(v) => updateChannel("meli", { targetMarginPercent: num(v, 13) })}
            />
            <Hint text="Padrões são editáveis e ficam salvos nesta empresa" />
          </div>
        </div>

        {/* SHOPEE */}
        <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Shopee (por faixa)</h3>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.channels.shopee.enabled}
                onChange={(e) => updateChannel("shopee", { enabled: e.target.checked })}
              />
              Ativo
            </label>
          </div>

          <div className="text-sm" style={{ color: "var(--muted)" }}>
            Configure faixas de preço com <b>comissão %</b> e <b>taxa fixa R$</b>. Isso vira o padrão desta empresa e pode ser alterado a qualquer momento.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field
              label="Margem desejada %"
              value={draft.channels.shopee.targetMarginPercent}
              onChange={(v) => updateChannel("shopee", { targetMarginPercent: num(v, 15) })}
            />
            <div />
            <div />
            <div />
          </div>

          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full min-w-[720px] text-sm">
              <thead style={{ background: "var(--surface-soft)" }}>
                <tr className="text-left">
                  <th className="border-b p-2" style={{ borderColor: "var(--border)", color: "var(--muted2)" }}>Min</th>
                  <th className="border-b p-2" style={{ borderColor: "var(--border)", color: "var(--muted2)" }}>Max (vazio = ∞)</th>
                  <th className="border-b p-2" style={{ borderColor: "var(--border)", color: "var(--muted2)" }}>Comissão %</th>
                  <th className="border-b p-2" style={{ borderColor: "var(--border)", color: "var(--muted2)" }}>Taxa fixa R$</th>
                  <th className="border-b p-2" style={{ borderColor: "var(--border)" }}></th>
                </tr>
              </thead>
              <tbody>
                {draft.shopeeTiers.map((t, idx) => (
                  <tr key={idx} className="border-b" style={{ borderColor: "var(--border)" }}>
                    <td className="p-2">
                      <input
                        value={t.min}
                        onChange={(e) => updateShopeeTier(idx, { min: num(e.target.value, 0) })}
                        className="w-32 rounded border px-2 py-1"
                        style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
                        inputMode="decimal"
                        placeholder="0,00"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={t.max === null ? "" : t.max}
                        onChange={(e) =>
                          updateShopeeTier(idx, { max: e.target.value === "" ? null : num(e.target.value, 0) })
                        }
                        className="w-40 rounded border px-2 py-1"
                        style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
                        inputMode="decimal"
                        placeholder="∞"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={t.commissionPercent}
                        onChange={(e) => updateShopeeTier(idx, { commissionPercent: num(e.target.value, 0) })}
                        className="w-32 rounded border px-2 py-1"
                        style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
                        inputMode="decimal"
                        placeholder="0,00"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={t.taxFixed}
                        onChange={(e) => updateShopeeTier(idx, { taxFixed: num(e.target.value, 0) })}
                        className="w-32 rounded border px-2 py-1"
                        style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
                        inputMode="decimal"
                        placeholder="0,00"
                      />
                    </td>
                    <td className="p-2">
                      <button onClick={() => removeShopeeTier(idx)} className="rounded border px-2 py-1" style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}>
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={addShopeeTier} className="px-3 py-2 rounded-lg border text-sm" style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}>
              + Adicionar faixa
            </button>

            <div className="text-xs" style={{ color: "var(--muted)" }}>
              Imposto do canal: {draft.channels.shopee.mainTaxPercent}% (imposto principal da empresa)
            </div>
          </div>
        </div>

        {/* SITE */}
        <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Site</h3>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.channels.site.enabled}
                onChange={(e) => updateChannel("site", { enabled: e.target.checked })}
              />
              Ativo
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field
              label="Taxa % (gateway)"
              value={draft.channels.site.commissionPercent}
              onChange={(v) => updateChannel("site", { commissionPercent: num(v, 1) })}
            />
            <Field
              label="Margem desejada %"
              value={draft.channels.site.targetMarginPercent}
              onChange={(v) => updateChannel("site", { targetMarginPercent: num(v, 20) })}
            />
            <Field
              label="Taxa fixa R$"
              value={draft.channels.site.taxFixed}
              onChange={(v) => updateChannel("site", { taxFixed: num(v, 0) })}
            />
            <Hint text="Padrão: 1%" />
          </div>
        </div>

        {/* OUTROS */}
        <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Outros</h3>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.channels.outros.enabled}
                onChange={(e) => updateChannel("outros", { enabled: e.target.checked })}
              />
              Ativo
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field
              label="Comissão %"
              value={draft.channels.outros.commissionPercent}
              onChange={(v) => updateChannel("outros", { commissionPercent: num(v, 18) })}
            />
            <Field
              label="Margem desejada %"
              value={draft.channels.outros.targetMarginPercent}
              onChange={(v) => updateChannel("outros", { targetMarginPercent: num(v, 20) })}
            />
            <Field
              label="Taxa fixa R$"
              value={draft.channels.outros.taxFixed}
              onChange={(v) => updateChannel("outros", { taxFixed: num(v, 0) })}
            />
            <Hint text="Padrão: 18%" />
          </div>
        </div>
      </div>

      {/* Observação importante para o motor */}
      <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted2)" }}>
        <div className="mb-1 font-semibold" style={{ color: "var(--text)" }}>Nota do motor de cálculo</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>O imposto principal é <b>único por empresa</b> — vale para todos os canais, edite no card &ldquo;Regime tributário&rdquo;.</li>
          <li>O canal <b>Meli</b> usa a comissão do <b>plano</b> selecionado (Clássico/Premium).</li>
          <li>O canal <b>Shopee</b> usa a faixa que encaixa no preço (tiers).</li>
          <li>Canais desmarcados como <b>Ativo</b> não aparecem na Precificação para esta empresa.</li>
          <li>Você pode cadastrar <b>quantas empresas precisar</b> e escolher qual usar em cada precificação.</li>
        </ul>
      </div>
    </div>
  );
}

function Field(props: { label: string; value: number; onChange: (v: string) => void }) {
  const { label, value, onChange } = props;
  const [text, setText] = useState<string>(typeof value === "number" ? String(value).replace(".", ",") : "");

  // Ajusta o texto exibido quando o valor externo muda (ex: troca de canal/empresa),
  // sem usar useEffect — ver nota equivalente em ConfiguracoesPage acima.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(typeof value === "number" ? String(value).replace(".", ",") : "");
  }

  function handleChange(raw: string) {
    setText(raw);
    onChange(raw.replace(",", "."));
  }

  return (
    <div className="space-y-1">
      <div className="text-sm font-medium" style={{ color: "var(--muted2)" }}>{label}</div>
      <input
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm w-full outline-none"
        style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
        inputMode="decimal"
        placeholder=",0"
      />
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <div
      className="flex items-center rounded-lg border px-3 py-2 text-sm"
      style={{ background: "var(--surface-soft)", borderColor: "var(--border)", color: "var(--muted2)" }}
    >
      {text}
    </div>
  );
}
