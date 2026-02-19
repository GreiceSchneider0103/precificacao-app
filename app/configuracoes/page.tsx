"use client";

import { useEffect, useMemo, useState } from "react";

type ChannelKey = "magalu" | "meli" | "shopee" | "site" | "outros";
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
      mainTaxPercent: number; // 18 ou 14 conforme regime
      targetMarginPercent: number; // margem desejada por canal
    }
  >;

  meli: {
    plan: MeliPlan;
    classicActive?: boolean;
    premiumActive?: boolean;
    classicCommissionPercent: number;
    premiumCommissionPercent: number;
  };

  shopeeTiers: ShopeeTier[];
};

type RuleSetRow = {
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
  const [rulesets, setRulesets] = useState<RuleSetRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState<RuleSetData | null>(null);

  const [newName, setNewName] = useState("Nova Regra");
  const [renameText, setRenameText] = useState("");
  const [status, setStatus] = useState<string>("");

  const selected = useMemo(() => rulesets.find((r) => r.id === selectedId) ?? null, [rulesets, selectedId]);
  const active = useMemo(() => rulesets.find((r) => r.isActive) ?? null, [rulesets]);

  async function load() {
    setStatus("Carregando...");
    const res = await fetch("/api/settings/rulesets", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json?.error ?? "Erro ao carregar");
      return;
    }
    const list = (json?.rulesets ?? []) as RuleSetRow[];
    setRulesets(list);

    const activeId = list.find((x) => x.isActive)?.id ?? list[0]?.id ?? "";
    setSelectedId(activeId);
    setDraft(activeId ? deepClone(list.find((x) => x.id === activeId)!.data) : null);
    setRenameText(list.find((x) => x.id === activeId)?.name ?? "");
    setStatus("");
  }

  useEffect(() => {
    load();
  }, []);

  // quando trocar o ruleset selecionado
  useEffect(() => {
    if (!selected) return;
    setDraft(deepClone(selected.data));
    setRenameText(selected.name);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function setRegime(regime: Regime) {
    if (!draft) return;
    const mainTaxPercent = regime === "normal" ? 18 : 14;

    const next = deepClone(draft);
    next.regime = regime;

    // aplica imposto padrão em todos os canais (editável depois se quiser)
    (Object.keys(next.channels) as ChannelKey[]).forEach((k) => {
      next.channels[k].mainTaxPercent = mainTaxPercent;
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
    setStatus("Ativando...");
    const res = await fetch("/api/settings/rulesets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: selectedId, action: "activate" }),
    });
    const json = await res.json();
    if (!res.ok) {
      setStatus(json?.error ?? "Erro ao ativar");
      return;
    }
    setStatus("✅ Regra ativa");
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
    setStatus("✅ Criado");
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

  async function removeRuleset() {
    if (!selectedId) return;
    const row = rulesets.find((r) => r.id === selectedId);
    if (row?.isActive) {
      setStatus("❌ Não dá pra excluir a regra ativa.");
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
      <div className="p-6">
        <h1 className="text-xl font-semibold">Configurações</h1>
        <p className="mt-2 text-sm text-gray-600">{status || "Inicializando..."}</p>
      </div>
    );
  }

  const mainTax = draft.regime === "normal" ? 18 : 14;

  return (
    <div className="p-6 space-y-6">
      <style jsx global>{`
        select { background: #0f1720; color: #fff; border-color: #374151; }
        select option { color: #111 !important; background: #fff !important; }
      `}</style>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Configurações (RuleSets)</h1>
          <p className="text-sm text-gray-600 mt-1">
            Regra ativa: <span className="font-medium">{active?.name ?? "—"}</span>{" "}
            <span className="text-gray-400">({active?.id ? "ativa" : "nenhuma"})</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={save}
            className="px-4 py-2 rounded-lg bg-black text-white text-sm hover:opacity-90"
          >
            Salvar
          </button>
          <button
            onClick={activate}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:opacity-90"
          >
            Definir como ativa
          </button>
        </div>
      </div>

      {status ? <div className="text-sm text-gray-700">{status}</div> : null}

      {/* Seleção de ruleset */}
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium">Selecionar regra</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              {rulesets.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.isActive ? "⭐ " : ""}{r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm"
              placeholder="Nome da regra"
            />
            <button onClick={rename} className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-50">
              Renomear
            </button>
            <button onClick={removeRuleset} className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-50">
              Excluir
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="Nome da nova regra"
          />
          <button onClick={createNew} className="px-3 py-2 rounded-lg bg-green-600 text-white text-sm hover:opacity-90">
            Criar nova regra (copia a atual)
          </button>
        </div>
      </div>

      {/* Regime / UF */}
      <div className="rounded-2xl border p-4 space-y-4">
        <h2 className="text-lg font-semibold">Impostos (Regime)</h2>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Regime</label>
            <select
              value={draft.regime}
              onChange={(e) => setRegime(e.target.value === "simples" ? "simples" : "normal")}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="normal">Normal (padrão) — 18%</option>
              <option value="simples">Simples Nacional — 14%</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">UF origem</label>
            <input
              value={draft.ufOrigem}
              onChange={(e) => setDraft({ ...draft, ufOrigem: e.target.value.toUpperCase().slice(0, 2) })}
              className="border rounded-lg px-3 py-2 text-sm w-20"
              placeholder="RS"
            />
          </div>

          <div className="text-sm text-gray-600">
            Imposto principal atual aplicado nos canais: <span className="font-semibold">{mainTax}%</span>
          </div>
        </div>
      </div>

      {/* Canais */}
      <div className="rounded-2xl border p-4 space-y-5">
        <h2 className="text-lg font-semibold">Canais</h2>

        {/* MAGALU */}
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Magalu</h3>
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
            <Field
              label="Imposto % (auto)"
              value={draft.channels.magalu.mainTaxPercent}
              onChange={(v) => updateChannel("magalu", { mainTaxPercent: num(v, mainTax) })}
            />
            <Hint text="Padrão: 18% + R$5/item" />
          </div>
        </div>

        {/* MELI */}
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold">Mercado Livre (Meli)</h3>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={true} disabled />
              <span title="Canal sempre ativo para seleção no motor" className="text-xs">Ativo</span>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <div className="text-sm font-medium">Plano</div>
              <select
                value={draft.meli.plan}
                onChange={(e) => updateMeli({ plan: e.target.value === "classic" ? "classic" : "premium" })}
                className="border rounded-lg px-3 py-2 text-sm w-full"
              >
                <option value="classic">Clássico</option>
                <option value="premium">Premium</option>
              </select>
              <div className="text-xs text-gray-500">
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
              label="Imposto % (auto)"
              value={draft.channels.meli.mainTaxPercent}
              onChange={(v) => updateChannel("meli", { mainTaxPercent: num(v, mainTax) })}
            />
          </div>

          <div className="text-xs text-gray-600">
            Dica: se quiser, dá pra colocar taxa fixa do MELI aqui também (abaixo) e salvar.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field
              label="Taxa fixa R$ (opcional)"
              value={draft.channels.meli.taxFixed}
              onChange={(v) => updateChannel("meli", { taxFixed: num(v, 0) })}
            />
            <Field
              label="Margem desejada %"
              value={draft.channels.meli.targetMarginPercent}
              onChange={(v) => updateChannel("meli", { targetMarginPercent: num(v, 13) })}
            />
            <div className="flex flex-col justify-center">
              <label className="text-sm">Clássico</label>
              <input type="checkbox" checked={true} disabled className="mt-1" />
            </div>
            <div className="flex flex-col justify-center">
              <label className="text-sm">Premium</label>
              <input type="checkbox" checked={true} disabled className="mt-1" />
            </div>
            <Hint text="Padrões são editáveis e ficam salvos no RuleSet" />
            <Hint text="Imposto segue o regime" />
          </div>
        </div>

        {/* SHOPEE */}
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold">Shopee (por faixa)</h3>
            <label className="text-sm flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.channels.shopee.enabled}
                onChange={(e) => updateChannel("shopee", { enabled: e.target.checked })}
              />
              Ativo
            </label>
          </div>

          <div className="text-sm text-gray-600">
            Configure faixas de preço com <b>comissão %</b> e <b>taxa fixa R$</b>. Isso vira teu padrão e pode ser alterado a qualquer momento.
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

          <div className="overflow-x-auto">
            <table className="min-w-[720px] w-full text-sm border rounded-lg overflow-hidden">
              <thead className="bg-gray-50">
                <tr className="text-left">
                  <th className="p-2 border-b">Min</th>
                  <th className="p-2 border-b">Max (vazio = ∞)</th>
                  <th className="p-2 border-b">Comissão %</th>
                  <th className="p-2 border-b">Taxa fixa R$</th>
                  <th className="p-2 border-b"></th>
                </tr>
              </thead>
              <tbody>
                {draft.shopeeTiers.map((t, idx) => (
                  <tr key={idx} className="border-b">
                    <td className="p-2">
                      <input
                        value={t.min}
                        onChange={(e) => updateShopeeTier(idx, { min: num(e.target.value, 0) })}
                        className="border rounded px-2 py-1 w-32"
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
                        className="border rounded px-2 py-1 w-40"
                        inputMode="decimal"
                        placeholder="∞"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={t.commissionPercent}
                        onChange={(e) => updateShopeeTier(idx, { commissionPercent: num(e.target.value, 0) })}
                        className="border rounded px-2 py-1 w-32"
                        inputMode="decimal"
                        placeholder="0,00"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={t.taxFixed}
                        onChange={(e) => updateShopeeTier(idx, { taxFixed: num(e.target.value, 0) })}
                        className="border rounded px-2 py-1 w-32"
                        inputMode="decimal"
                        placeholder="0,00"
                      />
                    </td>
                    <td className="p-2">
                      <button onClick={() => removeShopeeTier(idx)} className="px-2 py-1 border rounded hover:bg-gray-50">
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={addShopeeTier} className="px-3 py-2 rounded-lg border text-sm hover:bg-gray-50">
              + Adicionar faixa
            </button>

            <div className="text-xs text-gray-500">
              Imposto do canal: {draft.channels.shopee.mainTaxPercent}% (segue o regime)
            </div>
          </div>
        </div>

        {/* SITE */}
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Site</h3>
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
            <Field
              label="Imposto % (auto)"
              value={draft.channels.site.mainTaxPercent}
              onChange={(v) => updateChannel("site", { mainTaxPercent: num(v, mainTax) })}
            />
            <Hint text="Padrão: 1%" />
          </div>
        </div>

        {/* OUTROS */}
        <div className="rounded-2xl border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Outros</h3>
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
            <Field
              label="Imposto % (auto)"
              value={draft.channels.outros.mainTaxPercent}
              onChange={(v) => updateChannel("outros", { mainTaxPercent: num(v, mainTax) })}
            />
            <Hint text="Padrão: 18%" />
          </div>
        </div>
      </div>

      {/* Observação importante para o motor */}
      <div className="rounded-2xl border p-4 text-sm text-gray-700">
        <div className="font-semibold mb-1">Nota do motor de cálculo</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>O canal <b>Meli</b> usa a comissão do <b>plano</b> selecionado (Clássico/Premium).</li>
          <li>O canal <b>Shopee</b> usa a faixa que encaixa no preço (tiers).</li>
          <li>Todos os padrões são <b>editáveis</b>, e você pode criar <b>novas regras</b> e definir qual fica ativa.</li>
        </ul>
      </div>
    </div>
  );
}

function Field(props: { label: string; value: number; onChange: (v: string) => void }) {
  const { label, value, onChange } = props;
  const [text, setText] = useState<string>(typeof value === "number" ? String(value).replace(".", ",") : "");

  useEffect(() => {
    setText(typeof value === "number" ? String(value).replace(".", ",") : "");
  }, [value]);

  function handleChange(raw: string) {
    setText(raw);
    onChange(raw.replace(",", "."));
  }

  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <input
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        className="border rounded-lg px-3 py-2 text-sm w-full"
        inputMode="decimal"
        placeholder=",0"
      />
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm text-gray-700 flex items-center">
      {text}
    </div>
  );
}
