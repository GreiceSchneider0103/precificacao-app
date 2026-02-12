"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_HISTORY = "markup_price_history_v1";

type ChannelKey = "magalu" | "meli" | "shopee";
type Regime = "simples" | "normal";

type HistoryItem = {
  id: string;
  createdAt: string;

  sku: string;
  name: string;

  channel: ChannelKey;
  regime: Regime;

  por: number; // Preço POR (pago)
  precoDe?: number; // Preço DE (CMV*4,3) se você salvar
  margemPct: number;

  cmv: number;
  frete: number;
  operacionais: number;

  adsMode?: "fixed" | "percent";
  adsValue?: number;

  descontoMode?: "fixed" | "percent";
  descontoValue?: number;

  rebateMode?: "fixed" | "percent";
  rebateValue?: number;
};

function fmtPt(n: number) {
  return (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function chLabel(ch: ChannelKey) {
  if (ch === "magalu") return "Magalu";
  if (ch === "meli") return "Mercado Livre";
  return "Shopee";
}

function regLabel(r: Regime) {
  return r === "normal" ? "Normal" : "Simples";
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const v = (cell ?? "").toString().replaceAll('"', '""');
          return `"${v}"`;
        })
        .join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

export default function HistoricoPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const [q, setQ] = useState("");
  const [channel, setChannel] = useState<ChannelKey | "all">("all");
  const [regime, setRegime] = useState<Regime | "all">("all");

  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<any>(null);

  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_HISTORY);
      const arr = raw ? (JSON.parse(raw) as HistoryItem[]) : [];
      setItems(Array.isArray(arr) ? arr : []);
    } catch {
      setItems([]);
    }
  }, []);

  function persist(next: HistoryItem[]) {
    setItems(next);
    localStorage.setItem(STORAGE_HISTORY, JSON.stringify(next));
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const fromTs = dateFrom ? new Date(dateFrom + "T00:00:00").getTime() : null;
    const toTs = dateTo ? new Date(dateTo + "T23:59:59").getTime() : null;

    return items.filter((it) => {
      const okQ =
        !query ||
        (it.sku || "").toLowerCase().includes(query) ||
        (it.name || "").toLowerCase().includes(query);

      const okCh = channel === "all" ? true : it.channel === channel;
      const okReg = regime === "all" ? true : it.regime === regime;

      const ts = new Date(it.createdAt).getTime();
      const okFrom = fromTs == null ? true : ts >= fromTs;
      const okTo = toTs == null ? true : ts <= toTs;

      return okQ && okCh && okReg && okFrom && okTo;
    });
  }, [items, q, channel, regime, dateFrom, dateTo]);

  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);

  const visibleAllChecked = useMemo(() => {
    if (filtered.length === 0) return false;
    return filtered.every((it) => !!selected[it.id]);
  }, [filtered, selected]);

  const visibleSomeChecked = useMemo(() => {
    if (filtered.length === 0) return false;
    const any = filtered.some((it) => !!selected[it.id]);
    return any && !visibleAllChecked;
  }, [filtered, selected, visibleAllChecked]);

  useEffect(() => {
    if (!headerCheckboxRef.current) return;
    headerCheckboxRef.current.indeterminate = visibleSomeChecked;
  }, [visibleSomeChecked]);

  function toggleAllVisible() {
    const next: Record<string, boolean> = { ...selected };
    const allChecked = filtered.length > 0 && filtered.every((it) => next[it.id]);
    filtered.forEach((it) => (next[it.id] = !allChecked));
    setSelected(next);
  }

  function clearSelection() {
    setSelected({});
  }

  function removeOne(id: string) {
    const next = items.filter((it) => it.id !== id);
    persist(next);
    setSelected((s) => {
      const cp = { ...s };
      delete cp[id];
      return cp;
    });
  }

  function removeSelected() {
    if (!selectedIds.length) return;
    const next = items.filter((it) => !selectedIds.includes(it.id));
    persist(next);
    clearSelection();
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("POR copiado.");
    } catch {
      // fallback simples
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      showToast("POR copiado.");
    }
  }

  function exportSelectedCsv() {
    if (!selectedIds.length) {
      showToast("Selecione pelo menos 1 item para exportar.");
      return;
    }

    const picked = items.filter((it) => selectedIds.includes(it.id));

    const rows: string[][] = [
      ["Data", "SKU", "Produto", "Canal", "Regime", "Preço POR", "Preço DE", "MC %", "CMV", "Frete", "Operacionais"],
      ...picked.map((it) => [
        new Date(it.createdAt).toLocaleString("pt-BR"),
        it.sku,
        it.name,
        chLabel(it.channel),
        regLabel(it.regime),
        fmtPt(it.por),
        it.precoDe != null ? fmtPt(it.precoDe) : "",
        (it.margemPct ?? 0).toFixed(2),
        fmtPt(it.cmv),
        fmtPt(it.frete),
        fmtPt(it.operacionais),
      ]),
    ];

    downloadCsv(`markup-historico-selecionados-${Date.now()}.csv`, rows);
    showToast("CSV exportado.");
  }

  // Reaplicar: joga o payload pro localStorage e a página Precificação lê.
  // (Você comentou que isso vai evoluir — mantive a ideia, só removi alert.)
  function useThisCalculation(it: HistoryItem) {
    localStorage.setItem("markup_precificacao_draft_v1", JSON.stringify(it));
    showToast("Enviado para Precificação (draft salvo).");
  }

  return (
    <div className="space-y-5">
      {/* Toast discreto */}
      {toast ? (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-2xl border border-white/10 bg-neutral-950/80 px-4 py-2 text-sm text-white/90 shadow-lg backdrop-blur">
          {toast}
        </div>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">Histórico</h1>
        <p className="mt-1 text-sm text-white/60">Registros de precificação salvos (POR, margem e parâmetros).</p>
      </section>

      {/* Filtros */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="grid gap-1 min-w-0">
            <span className="text-xs text-white/60">Buscar (SKU ou nome)</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ex: 35999 ou Banqueta"
              className="w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
            />
          </label>

          <label className="grid gap-1 min-w-0">
            <span className="text-xs text-white/60">Canal</span>
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value as any)}
              className="w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
            >
              <option value="all">Todos</option>
              <option value="magalu">Magalu</option>
              <option value="meli">Mercado Livre</option>
              <option value="shopee">Shopee</option>
            </select>
          </label>

          <label className="grid gap-1 min-w-0">
            <span className="text-xs text-white/60">Regime</span>
            <select
              value={regime}
              onChange={(e) => setRegime(e.target.value as any)}
              className="w-full rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
            >
              <option value="all">Todos</option>
              <option value="simples">Simples</option>
              <option value="normal">Normal</option>
            </select>
          </label>

          {/* ✅ FIX: datas ocupam 2 colunas no desktop pra não esmagar e sobrepor */}
          <div className="grid gap-3 sm:grid-cols-2 md:col-span-2">
            <label className="grid gap-1 min-w-0">
              <span className="text-xs text-white/60">De</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full rounded-xl bg-neutral-950/60 px-3 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
              />
            </label>
            <label className="grid gap-1 min-w-0">
              <span className="text-xs text-white/60">Até</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full rounded-xl bg-neutral-950/60 px-3 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
              />
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={exportSelectedCsv}
            className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
          >
            Exportar CSV (selecionados)
          </button>

          <button
            onClick={toggleAllVisible}
            className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
          >
            Selecionar visíveis
          </button>

          <button
            onClick={removeSelected}
            disabled={!selectedIds.length}
            className={
              selectedIds.length
                ? "rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 ring-1 ring-rose-500/20 hover:bg-rose-500/20"
                : "rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/40 ring-1 ring-white/10 cursor-not-allowed"
            }
          >
            Excluir selecionados
          </button>

          {selectedIds.length ? (
            <span className="ml-2 text-xs text-white/60">{selectedIds.length} selecionado(s)</span>
          ) : null}
        </div>
      </section>

      {/* Tabela */}
      <section className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/70">
              <tr className="text-left">
                <th className="px-4 py-3 w-10">
                  <input
                    ref={headerCheckboxRef}
                    type="checkbox"
                    onChange={toggleAllVisible}
                    checked={visibleAllChecked}
                    aria-label="Selecionar visíveis"
                  />
                </th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Canal</th>
                <th className="px-4 py-3">Regime</th>
                <th className="px-4 py-3">POR</th>
                <th className="px-4 py-3">MC %</th>
                <th className="px-4 py-3 w-[340px]">Ações</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/10">
              {filtered.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-white/60" colSpan={9}>
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                filtered.map((it) => (
                  <tr key={it.id} className="hover:bg-white/5">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={!!selected[it.id]}
                        onChange={(e) => setSelected((s) => ({ ...s, [it.id]: e.target.checked }))}
                      />
                    </td>

                    <td className="px-4 py-3 text-white/70">{new Date(it.createdAt).toLocaleString("pt-BR")}</td>
                    <td className="px-4 py-3 font-medium">{it.sku}</td>
                    <td className="px-4 py-3">{it.name}</td>
                    <td className="px-4 py-3 text-white/70">{chLabel(it.channel)}</td>
                    <td className="px-4 py-3 text-white/70">{regLabel(it.regime)}</td>
                    <td className="px-4 py-3 font-semibold tabular-nums">R$ {fmtPt(it.por)}</td>
                    <td className="px-4 py-3 tabular-nums">{(it.margemPct ?? 0).toFixed(2)}%</td>

                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
  onClick={() =>
    copyText(
      (Number(String(it.por ?? 0).replace(",", ".")) || 0)
        .toFixed(2)
        .replace(".", ",")
    )
  }
  className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
>
  Copiar POR
</button>

                        <button
                          onClick={() => useThisCalculation(it)}
                          className="rounded-xl bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20"
                        >
                          Usar
                        </button>

                        <button
                          onClick={() => removeOne(it.id)}
                          className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 ring-1 ring-rose-500/20 hover:bg-rose-500/20"
                        >
                          Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
