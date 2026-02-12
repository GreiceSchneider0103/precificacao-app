"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Product = {
  sku: string;
  name: string;
  cmv: number;
  mlb?: string | null;
  updatedAt: string; // ISO
};

const STORAGE_PRODUCTS = "markup_products_v1";
const STORAGE_LAST_IMPORT = "markup_products_last_import_v1";

function cn(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

function normalizeSku(s: string) {
  return (s || "").trim().toUpperCase();
}

function normalizeMlb(s: string) {
  const v = (s || "").trim().toUpperCase();
  const m = v.match(/MLB\d+/i);
  if (m?.[0]) return m[0].toUpperCase();
  if (/^\d+$/.test(v)) return `MLB${v}`;
  return v || "";
}

function parseNumberPt(raw: unknown) {
  let s = String(raw ?? "").trim();
  if (!s) return 0;

  // remove espaços e moeda
  s = s.replace(/\s/g, "").replace(/^R\$\s?/, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  // Caso 1: tem vírgula -> vírgula é decimal, ponto é milhar
  if (hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    // Caso 2: só tem ponto -> ponto é decimal (não remover!)
    // Ex: 41.48
    // mantém como está
  } else {
    // Caso 3: só dígitos
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return 0;

  // trava em 2 casas para não “poluir” o CMV
  return Math.round(n * 100) / 100;
}


function toMoneyPt(n: number) {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function buildCsv(products: Product[]) {
  const header = ["SKU", "Nome", "CMV", "MLB"];
  const lines = products
    .slice()
    .sort((a, b) => a.sku.localeCompare(b.sku))
    .map((p) => [p.sku, p.name, p.cmv.toString().replace(".", ","), p.mlb ?? ""].join(";"));
  return [header.join(";"), ...lines].join("\n");
}

/** ----------------- CSV / TXT ----------------- */

function parseCsvText(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { rows: [] as string[][] };

  const first = lines[0];
  const delim = first.includes(";") ? ";" : first.includes("\t") ? "\t" : ",";

  const rows = lines.map((line) => line.split(delim).map((c) => c.trim().replace(/^"|"$/g, "")));

  return { rows };
}

function normHeader(h: string) {
  return (h || "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\s+/g, " ");
}

function findHeaderIndex(headers: string[], candidates: (string | RegExp)[]) {
  const h = headers.map(normHeader);
  for (let i = 0; i < h.length; i++) {
    const v = h[i];
    for (const c of candidates) {
      if (typeof c === "string") {
        if (v === c || v.includes(c)) return i;
      } else {
        if (c.test(v)) return i;
      }
    }
  }
  return -1;
}

function guessColumnMap(headers: string[]) {
  // 🔥 inclui o padrão do arquivo MLB: item_seller (SKU) e item_id (MLB)
  const idxSku = findHeaderIndex(headers, [
    "sku",
    "codigo sku",
    "codigo (sku)",
    "codigo",
    /item[_\s-]*seller/, // item_seller
    /seller[_\s-]*item/, // seller_item
  ]);

  const idxName = findHeaderIndex(headers, [
    "nome",
    "descricao",
    "descrição",
    "descricao do produto",
    "descrição do produto",
    "descricao produto",
  ]);

  const idxCmv = findHeaderIndex(headers, [
    "cmv",
    "custo",
    "custo medio",
    "custo médio",
    "custo (cmv)",
    "preco custo",
    "preço custo",
  ]);

  const idxMlb = findHeaderIndex(headers, [
    "mlb",
    "codigo mlb",
    "código mlb",
    "anuncio",
    "anúncio",
    /item[_\s-]*id/, // item_id
    /mlb\d+/i,
  ]);

  return { idxSku, idxName, idxCmv, idxMlb };
}

function rowsToImportItems(rows: any[][]) {
  if (!rows.length) return [];

  // tenta detectar cabeçalho
  const first = rows[0].map((c) => String(c ?? ""));
  const hasHeader = first.some((c) => {
    const v = normHeader(c);
    return v.includes("sku") || v.includes("codigo") || v.includes("descr") || v.includes("nome") || v.includes("custo") || v.includes("cmv") || v.includes("mlb") || v.includes("item_seller") || v.includes("item id");
  });

  let data = rows;
  let map = { idxSku: 0, idxName: 1, idxCmv: 2, idxMlb: 3 };

  if (hasHeader) {
    map = guessColumnMap(first);
    data = rows.slice(1);
  }

  const idxSku = map.idxSku >= 0 ? map.idxSku : 0;

  return data
    .map((r) => {
      const sku = normalizeSku(String(r[idxSku] ?? ""));
      const name = map.idxName >= 0 ? String(r[map.idxName] ?? "").trim() : "";
      const cmv = map.idxCmv >= 0 ? parseNumberPt(r[map.idxCmv]) : 0;
      const mlb = map.idxMlb >= 0 ? normalizeMlb(String(r[map.idxMlb] ?? "")) : "";

      return { sku, name, cmv, mlb };
    })
    .filter((x) => !!x.sku);
}

/** ----------------- EXCEL (.xls/.xlsx) ----------------- */

function cleanText(v: any) {
  if (v == null) return "";
  // evita SKU/MLB vir como número/exp no Excel
  return String(v).trim();
}

async function parseExcelFile(file: File): Promise<any[][]> {
  const XLSX = await import("xlsx");

  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  // header:1 => array de arrays
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as any[][];

  // normaliza tudo pra string
  return rows.map((row) => (row || []).map((c: any) => cleanText(c)));
}

export default function ProdutosPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string>("");

  const [editSku, setEditSku] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCmv, setEditCmv] = useState<string>("");
  const [editMlb, setEditMlb] = useState<string>("");

  const [newSku, setNewSku] = useState("");
const [newName, setNewName] = useState("");
const [newCmv, setNewCmv] = useState("");
const [newMlb, setNewMlb] = useState("");


  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_PRODUCTS);
      if (raw) {
        const parsed = JSON.parse(raw) as any[];
        const next: Product[] = (parsed || []).map((p) => ({
          sku: normalizeSku(p.sku),
          name: String(p.name ?? "").trim() || normalizeSku(p.sku),
          cmv: Number(p.cmv ?? 0) || 0,
          mlb: p.mlb ? normalizeMlb(String(p.mlb)) : undefined,
          updatedAt: String(p.updatedAt ?? new Date().toISOString()),
        }));
        setProducts(next);
      }
    } catch {}
  }, []);

  // Persist (local)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PRODUCTS, JSON.stringify(products));
    } catch {}
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const m = (p.mlb || "").toLowerCase();
      return p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || m.includes(q);
    });
  }, [products, query]);

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  const allVisibleSelected = useMemo(() => {
    if (filtered.length === 0) return false;
    return filtered.every((p) => selected[p.sku]);
  }, [filtered, selected]);

  function toast(msg: string) {
    setStatus(msg);
    setTimeout(() => setStatus(""), 2500);
  }

  function importItems(
  items: { sku: string; name?: string; cmv?: number; mlb?: string }[],
  rawSourceToSave?: string
) {
  let added = 0;
  let updated = 0;
  let skipped = 0;

  const now = new Date().toISOString();

  // monta a lista final ANTES, salva na hora, e depois dá setState
  const prev = products; // estado atual (closure)
  const map = new Map(prev.map((p) => [normalizeSku(p.sku), p]));

  for (const it of items) {
    const sku = normalizeSku(it.sku);
    if (!sku) {
      skipped++;
      continue;
    }

    const prevP = map.get(sku);
    const nextName = (it.name || "").trim();
    const nextCmv = Number.isFinite(it.cmv as number) ? Number(it.cmv) : 0;
    const nextMlb = normalizeMlb(it.mlb || "");

    // garante 2 casas
    const cmv2 = Math.round((nextCmv || 0) * 100) / 100;

    if (prevP) {
      map.set(sku, {
        ...prevP,
        name: nextName || prevP.name,
        cmv: cmv2 > 0 ? cmv2 : prevP.cmv,
        mlb: nextMlb || prevP.mlb,
        updatedAt: now,
      });
      updated++;
    } else {
      map.set(sku, {
        sku,
        name: nextName || sku,
        cmv: cmv2 || 0,
        mlb: nextMlb || undefined,
        updatedAt: now,
      });
      added++;
    }
  }

  const nextProducts = Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku));

  // ✅ salva imediatamente (não depende do useEffect)
  try {
    localStorage.setItem(STORAGE_PRODUCTS, JSON.stringify(nextProducts));
  } catch {}

  if (rawSourceToSave != null) {
    try {
      localStorage.setItem(STORAGE_LAST_IMPORT, rawSourceToSave);
    } catch {}
  }

  setProducts(nextProducts);

  toast(`Importação concluída: +${added} novos, ${updated} atualizados, ${skipped} ignorados.`);
}
function addManualProduct() {
  const sku = normalizeSku(newSku);
  if (!sku) {
    toast("Informe um SKU válido.");
    return;
  }

  const name = (newName.trim() || sku).trim();
  const cmv = parseNumberPt(newCmv);
  const mlb = normalizeMlb(newMlb);

  const now = new Date().toISOString();

  setProducts((prev) => {
    const map = new Map(prev.map((p) => [p.sku, p]));
    const existing = map.get(sku);

    const next: Product = existing
      ? { ...existing, name, cmv: cmv || existing.cmv, mlb: mlb || existing.mlb, updatedAt: now }
      : { sku, name, cmv: cmv || 0, mlb: mlb || undefined, updatedAt: now };

    map.set(sku, next);

    const nextProducts = Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku));

    // ✅ salva imediatamente
    try {
      localStorage.setItem(STORAGE_PRODUCTS, JSON.stringify(nextProducts));
    } catch {}

    return nextProducts;
  });

  setNewSku("");
  setNewName("");
  setNewCmv("");
  setNewMlb("");
  toast(`Produto ${sku} adicionado/atualizado.`);
}


  function onDownloadBase() {
    const csv = buildCsv(products);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`markup-produtos-${stamp}.csv`, csv);
  }

  function onDownloadLastImport() {
    const last = localStorage.getItem(STORAGE_LAST_IMPORT) || "";
    if (!last.trim()) {
      toast("Ainda não existe importação anterior salva.");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`markup-ultima-importacao-${stamp}.csv`, last);
  }

  function toggleSelectAllVisible() {
    const next = { ...selected };
    const target = !allVisibleSelected;
    for (const p of filtered) next[p.sku] = target;
    setSelected(next);
  }

  function toggleOne(sku: string) {
    setSelected((prev) => ({ ...prev, [sku]: !prev[sku] }));
  }

  function deleteOne(sku: string) {
    setProducts((prev) => prev.filter((p) => p.sku !== sku));
    setSelected((prev) => {
      const n = { ...prev };
      delete n[sku];
      return n;
    });
    toast(`SKU ${sku} removido.`);
  }

  function deleteSelected() {
    const skus = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (skus.length === 0) {
      toast("Nenhum item selecionado.");
      return;
    }

    setProducts((prev) => prev.filter((p) => !selected[p.sku]));
    setSelected({});
    toast(`Removidos ${skus.length} itens.`);
  }

  function openEdit(p: Product) {
    setEditSku(p.sku);
    setEditName(p.name);
    setEditCmv(p.cmv.toString().replace(".", ","));
    setEditMlb(p.mlb ?? "");
  }

  function saveEdit() {
    if (!editSku) return;
    const sku = normalizeSku(editSku);
    const name = editName.trim() || sku;
    const cmv = parseNumberPt(editCmv);
    const mlb = normalizeMlb(editMlb);

    setProducts((prev) =>
      prev.map((p) => (p.sku === sku ? { ...p, name, cmv, mlb: mlb || undefined, updatedAt: new Date().toISOString() } : p))
    );
    setEditSku(null);
    toast(`SKU ${sku} atualizado.`);
  }

  function cancelEdit() {
    setEditSku(null);
  }

  function onUploadClick() {
    fileInputRef.current?.click();
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = (file.name.split(".").pop() || "").toLowerCase();

    try {
      if (ext === "xls" || ext === "xlsx") {
        const rows = await parseExcelFile(file);
        const items = rowsToImportItems(rows);

        if (!items.length) {
          toast("Planilha lida, mas não encontrei linhas válidas.");
          return;
        }

        // salva um “resumo” no last import (pra baixar depois)
        const preview = [
          "IMPORTADO_DE_EXCEL",
          `ARQUIVO=${file.name}`,
          `LINHAS=${items.length}`,
          "",
          "SKU;Nome;CMV;MLB",
          ...items.slice(0, 50).map((x) => [x.sku, x.name, String(x.cmv ?? 0).replace(".", ","), x.mlb ?? ""].join(";")),
          items.length > 50 ? "..." : "",
        ].join("\n");

        importItems(
          items.map((x) => ({ sku: x.sku, name: x.name, cmv: Number(x.cmv || 0), mlb: x.mlb })),
          preview
        );

        toast("Planilha Excel importada com sucesso.");
      } else {
        const text = await file.text();
        const { rows } = parseCsvText(text);
        const items = rowsToImportItems(rows);

        if (!items.length) {
          toast("Não encontrei linhas válidas para importar.");
          return;
        }

        importItems(
          items.map((x) => ({ sku: x.sku, name: x.name, cmv: Number(x.cmv || 0), mlb: x.mlb })),
          text
        );

        toast("CSV/TXT importado com sucesso.");
      }
    } catch (err: any) {
      toast(`Erro ao ler arquivo: ${err?.message || "desconhecido"}`);
    } finally {
      e.target.value = "";
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Produtos</h1>
            <p className="mt-1 text-sm text-white/60">
              Base de produtos (<b>SKU</b>, <b>Nome</b>, <b>CMV</b>, <b>MLB</b>). Importação atualiza SKUs existentes e adiciona novos.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onDownloadBase}
              className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/10 transition"
            >
              Baixar base (CSV)
            </button>
            <button
              onClick={onDownloadLastImport}
              className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/10 transition"
            >
              Baixar última importação
            </button>
          </div>
        </div>

        {status ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">{status}</div>
        ) : null}
      </section>

      {/* Import (SEM textarea) */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold">Importar produtos</h2>

          <div className="flex flex-wrap gap-2">
            <input ref={fileInputRef} type="file" accept=".csv,.txt,.xls,.xlsx" onChange={onFileChange} className="hidden" />
            <button
              onClick={onUploadClick}
              className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/10 transition"
            >
              Upload (CSV / Excel)
            </button>
          </div>
        </div>

        <p className="mt-2 text-xs text-white/55">
          Você pode importar:
          <br />• CSV/TXT com <b>SKU;Nome;CMV;MLB</b> (MLB é opcional)
          <br />• Excel do ERP com cabeçalhos tipo <b>Descrição</b>, <b>Código (SKU)</b>, <b>Custo</b> e (se existir) <b>MLB</b>
          <br />• Planilha de vínculo <b>item_seller</b> (SKU) + <b>item_id</b> (MLB) — atualiza o MLB no mesmo SKU
        </p>
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
  <p className="text-sm font-semibold">Adicionar produto manualmente</p>

  <div className="mt-3 grid gap-3 md:grid-cols-4">
    <input
      value={newSku}
      onChange={(e) => setNewSku(e.target.value)}
      placeholder="SKU"
      className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none"
    />
    <input
      value={newName}
      onChange={(e) => setNewName(e.target.value)}
      placeholder="Nome"
      className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none"
    />
    <input
      value={newCmv}
      onChange={(e) => setNewCmv(e.target.value)}
      placeholder="CMV (ex: 41,48)"
      inputMode="decimal"
      className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none"
    />
    <input
      value={newMlb}
      onChange={(e) => setNewMlb(e.target.value)}
      placeholder="MLB (opcional)"
      className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none"
    />
  </div>

  <div className="mt-3 flex justify-end">
    <button
      type="button"
      onClick={addManualProduct}
      className="rounded-xl bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20"
    >
      Adicionar produto
    </button>
  </div>
</div>

      </section>

      {/* Listagem */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold">Base de produtos</h2>

          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por SKU, nome ou MLB..."
              className="w-72 rounded-xl bg-neutral-950/60 px-4 py-2 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
            />

            <button
              onClick={toggleSelectAllVisible}
              className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/10 transition"
            >
              {allVisibleSelected ? "Desmarcar visíveis" : "Selecionar visíveis"}
            </button>

            <button
              onClick={deleteSelected}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-semibold ring-1 ring-white/10 transition",
                selectedCount > 0 ? "bg-rose-500/15 text-rose-200 hover:bg-rose-500/20" : "bg-white/5 text-white/50 cursor-not-allowed"
              )}
              disabled={selectedCount === 0}
            >
              Excluir selecionados ({selectedCount})
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
          <div className="grid grid-cols-[44px_160px_1fr_140px_140px_160px] bg-white/5 px-4 py-3 text-xs font-semibold text-white/60">
            <span></span>
            <span>SKU</span>
            <span>Nome</span>
            <span className="text-right">CMV</span>
            <span className="text-right">MLB</span>
            <span className="text-right">Ações</span>
          </div>

          <div className="divide-y divide-white/10">
            {filtered.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-white/60">Nenhum produto encontrado.</div>
            ) : (
              filtered.map((p) => (
                <div key={p.sku} className="grid grid-cols-[44px_160px_1fr_140px_140px_160px] items-center px-4 py-3 text-sm">
                  <div className="flex items-center">
                    <input type="checkbox" checked={!!selected[p.sku]} onChange={() => toggleOne(p.sku)} className="h-4 w-4 accent-blue-600" />
                  </div>

                  <div className="font-semibold">{p.sku}</div>
                  <div className="text-white/85">{p.name}</div>
                  <div className="text-right tabular-nums">{toMoneyPt(p.cmv)}</div>
                  <div className="text-right tabular-nums text-white/80">{p.mlb ?? "—"}</div>

                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => openEdit(p)}
                      className="rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/10 transition"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => deleteOne(p.sku)}
                      className="rounded-xl bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-200 ring-1 ring-rose-500/20 hover:bg-rose-500/20 transition"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {/* Modal Edit */}
      {editSku ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-neutral-950 p-5">
            <h3 className="text-lg font-semibold">Editar produto</h3>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs text-white/60">SKU</span>
                <input value={editSku} disabled className="rounded-xl bg-white/5 px-4 py-3 text-sm text-white/70 ring-1 ring-white/10" />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-white/60">Nome</span>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-white/60">CMV</span>
                <input
                  value={editCmv}
                  onChange={(e) => setEditCmv(e.target.value)}
                  inputMode="decimal"
                  className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-white/60">MLB</span>
                <input
                  value={editMlb}
                  onChange={(e) => setEditMlb(e.target.value)}
                  placeholder="Ex: MLB46360154"
                  className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={cancelEdit}
                className="rounded-xl bg-white/5 px-4 py-2 text-sm font-semibold text-white/85 ring-1 ring-white/10 hover:bg-white/10 transition"
              >
                Cancelar
              </button>
              <button onClick={saveEdit} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition">
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
