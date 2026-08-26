"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getRelativeTime } from "@/lib/utils";

type Product = {
  sku: string;
  name: string;
  cmv: number;
  mlb?: string | null;
  empresaId?: string | null;
  updatedAt: string; // ISO
};

type EmpresaRow = { id: string; name: string; isActive: boolean; tinyApiToken?: string | null };

const NONE_EMPRESA = "__none__";
const STALE_DAYS = 30;
const PAGE_SIZE = 50;

const STORAGE_LAST_IMPORT_BASE = "markup_products_last_import_v1";

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

  s = s.replace(/\s/g, "").replace(/^R\$\s?/, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");

  if (hasComma) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    // ponto decimal (mantém)
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
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
    .replace(/[\u0300-\u036f]/g, "")
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
  const idxSku = findHeaderIndex(headers, [
    "sku",
    "codigo sku",
    "codigo (sku)",
    "codigo",
    /item[_\s-]*seller/,
    /seller[_\s-]*item/,
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
    /item[_\s-]*id/,
    /mlb\d+/i,
  ]);

  return { idxSku, idxName, idxCmv, idxMlb };
}

type RawCell = string | number | boolean | null | undefined;
type RawRow = RawCell[];

function rowsToImportItems(rows: RawRow[]) {
  if (!rows.length) return [];

  const first = rows[0].map((c) => String(c ?? ""));
  const hasHeader = first.some((c) => {
    const v = normHeader(c);
    return (
      v.includes("sku") ||
      v.includes("codigo") ||
      v.includes("descr") ||
      v.includes("nome") ||
      v.includes("custo") ||
      v.includes("cmv") ||
      v.includes("mlb") ||
      v.includes("item_seller") ||
      v.includes("item id")
    );
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
function cleanText(v: unknown) {
  if (v == null) return "";
  return String(v).trim();
}

async function parseExcelFile(file: File): Promise<RawRow[]> {
  const XLSX = await import("xlsx");
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });

  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as RawRow[];
  return rows.map((row) => (row || []).map((c) => cleanText(c)));
}

/** ----------------- API (DB) ----------------- */
async function loadEmpresasFromDb(): Promise<EmpresaRow[]> {
  const res = await fetch("/api/settings/rulesets", { cache: "no-store" });
  const data = (await res.json()) as { rulesets?: EmpresaRow[]; error?: string };
  if (!res.ok) throw new Error(data?.error || "Erro ao carregar empresas");
  return data?.rulesets ?? [];
}

async function loadFromDb(empresaId: string) {
  const qs = empresaId === NONE_EMPRESA ? "?empresaId=none" : empresaId ? `?empresaId=${encodeURIComponent(empresaId)}` : "";
  const res = await fetch(`/api/products${qs}`, { method: "GET" });
  const data = (await res.json()) as { products?: Product[]; error?: string };
  if (!res.ok) throw new Error(data?.error || "Erro ao carregar produtos");
  return (data?.products ?? []) as Product[];
}

async function saveToDb(nextProducts: Product[], empresaId: string) {
  const tagged = nextProducts.map((p) => ({
    ...p,
    empresaId: empresaId === NONE_EMPRESA ? null : empresaId,
  }));
  const res = await fetch("/api/products", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ products: tagged }),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data?.error || "Erro ao salvar produtos");
}

type TinySyncError = { sku: string; message: string };
type TinySyncEmpresaResult = { empresaId: string; name: string; processed: number; total: number; done: boolean; errors?: TinySyncError[] };

export function ProdutosClient({ role }: { role: "MASTER" | "MEMBER" }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaRow[]>([]);
  const [selectedEmpresaId, setSelectedEmpresaId] = useState<string>("");
  const [empresasLoaded, setEmpresasLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [syncState, setSyncState] = useState<{ running: boolean; processed: number; total: number; mode: "single" | "all" | null }>({
    running: false,
    processed: 0,
    total: 0,
    mode: null,
  });

  const [editSku, setEditSku] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCmv, setEditCmv] = useState<string>("");
  const [editMlb, setEditMlb] = useState<string>("");
  const [editEmpresaId, setEditEmpresaId] = useState<string>("");

  const [newSku, setNewSku] = useState("");
  const [newName, setNewName] = useState("");
  const [newCmv, setNewCmv] = useState("");
  const [newMlb, setNewMlb] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function toast(msg: string) {
    setStatus(msg);
    window.setTimeout(() => setStatus(""), 2500);
  }

  const selectedEmpresa = useMemo(
    () => empresas.find((e) => e.id === selectedEmpresaId) ?? null,
    [empresas, selectedEmpresaId]
  );

  // Carga inicial de empresas
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadEmpresasFromDb();
        if (cancelled) return;
        setEmpresas(list);
        setSelectedEmpresaId(list.find((e) => e.isActive)?.id ?? list[0]?.id ?? NONE_EMPRESA);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast("Não consegui carregar suas empresas (veja o console).");
      } finally {
        if (!cancelled) setEmpresasLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Recarrega produtos sempre que a empresa selecionada muda
  useEffect(() => {
    if (!empresasLoaded || !selectedEmpresaId) return;
    let cancelled = false;
    (async () => {
      try {
        const dbProducts = await loadFromDb(selectedEmpresaId);
        if (!cancelled) setProducts(dbProducts);
      } catch (e) {
        console.error(e);
        if (!cancelled) toast("Não consegui carregar seus produtos (veja o console).");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [empresasLoaded, selectedEmpresaId]);

  // Helper: aplica e salva
  async function applyAndSave(nextProducts: Product[], successMsg?: string) {
    setProducts(nextProducts);
    setSaving(true);
    try {
      await saveToDb(nextProducts, selectedEmpresaId);
      if (successMsg) toast(successMsg);
    } catch (e) {
      console.error(e);
      toast("Erro ao salvar no banco (veja o console).");
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const m = (p.mlb || "").toLowerCase();
      return p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || m.includes(q);
    });
  }, [products, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  );

  const selectedCount = useMemo(() => Object.values(selected).filter(Boolean).length, [selected]);

  const allVisibleSelected = useMemo(() => {
    if (pageItems.length === 0) return false;
    return pageItems.every((p) => selected[p.sku]);
  }, [pageItems, selected]);

  function importItems(items: { sku: string; name?: string; cmv?: number; mlb?: string }[], rawSourceToSave?: string) {
    let added = 0;
    let updated = 0;
    let skipped = 0;

    const now = new Date().toISOString();
    const map = new Map(products.map((p) => [normalizeSku(p.sku), p]));

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
          mlb: nextMlb || null,
          empresaId: selectedEmpresaId === NONE_EMPRESA ? null : selectedEmpresaId,
          updatedAt: now,
        });
        added++;
      }
    }

    const nextProducts = Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku));

    // mantém "última importação" local (opcional)
    if (rawSourceToSave != null) {
      try {
        localStorage.setItem(STORAGE_LAST_IMPORT_BASE, rawSourceToSave);
      } catch {}
    }

    applyAndSave(nextProducts, `Importação concluída: +${added} novos, ${updated} atualizados, ${skipped} ignorados.`);
  }

  function addManualProduct() {
    const sku = normalizeSku(newSku);
    if (!sku) return toast("Informe um SKU válido.");

    const name = (newName.trim() || sku).trim();
    const cmv = parseNumberPt(newCmv);
    const mlb = normalizeMlb(newMlb);
    const now = new Date().toISOString();

    const map = new Map(products.map((p) => [p.sku, p]));
    const existing = map.get(sku);

    const next: Product = existing
      ? { ...existing, name, cmv: cmv || existing.cmv, mlb: mlb || existing.mlb, updatedAt: now }
      : {
          sku,
          name,
          cmv: cmv || 0,
          mlb: mlb || null,
          empresaId: selectedEmpresaId === NONE_EMPRESA ? null : selectedEmpresaId,
          updatedAt: now,
        };

    map.set(sku, next);

    const nextProducts = Array.from(map.values()).sort((a, b) => a.sku.localeCompare(b.sku));

    setNewSku("");
    setNewName("");
    setNewCmv("");
    setNewMlb("");

    applyAndSave(nextProducts, `Produto ${sku} adicionado/atualizado.`);
  }

  function onDownloadBase() {
    const csv = buildCsv(products);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`markup-produtos-${stamp}.csv`, csv);
  }

  function onDownloadLastImport() {
    const last = localStorage.getItem(STORAGE_LAST_IMPORT_BASE) || "";
    if (!last.trim()) return toast("Ainda não existe importação anterior salva.");
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`markup-ultima-importacao-${stamp}.csv`, last);
  }

  // Cadastra só os SKUs colados (sem nome/CMV) — vira a "lista de rastreio" que o
  // Tiny preenche depois via sincronização, sem precisar puxar a base toda do ERP.
  function addTrackedSkus(rawText: string) {
    const tokens = rawText
      .split(/[\n,;]+/)
      .map((t) => normalizeSku(t))
      .filter(Boolean);
    const uniqueSkus = Array.from(new Set(tokens));
    if (uniqueSkus.length === 0) return toast("Cole ao menos um SKU.");

    importItems(uniqueSkus.map((sku) => ({ sku })));
  }

  async function clearAllProducts() {
    if (!selectedEmpresaId) return;
    const empresaLabel = selectedEmpresaId === NONE_EMPRESA ? "Sem empresa (legado)" : selectedEmpresa?.name ?? "esta empresa";
    const ok = window.confirm(
      `Isso vai apagar TODOS os ${products.length} produtos cadastrados em "${empresaLabel}" — não dá pra desfazer. Continuar?`
    );
    if (!ok) return;

    setSaving(true);
    try {
      const qs = selectedEmpresaId === NONE_EMPRESA ? "empresaId=none" : `empresaId=${encodeURIComponent(selectedEmpresaId)}`;
      const res = await fetch(`/api/products?${qs}&all=true`, { method: "DELETE" });
      const data = (await res.json()) as { deleted?: number; error?: string };
      if (!res.ok) throw new Error(data?.error || "Erro ao limpar produtos");
      setProducts([]);
      setSelected({});
      toast(`${data.deleted ?? 0} produtos removidos.`);
    } catch (e) {
      console.error(e);
      toast("Erro ao limpar produtos (veja o console).");
    } finally {
      setSaving(false);
    }
  }

  function toggleSelectAllVisible() {
    const next = { ...selected };
    const target = !allVisibleSelected;
    for (const p of pageItems) next[p.sku] = target;
    setSelected(next);
  }

  function toggleOne(sku: string) {
    setSelected((prev) => ({ ...prev, [sku]: !prev[sku] }));
  }

  function deleteOne(sku: string) {
    const nextProducts = products.filter((p) => p.sku !== sku);
    setSelected((prev) => {
      const n = { ...prev };
      delete n[sku];
      return n;
    });
    applyAndSave(nextProducts, `SKU ${sku} removido.`);
  }

  function deleteSelected() {
    const skus = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k);

    if (skus.length === 0) return toast("Nenhum item selecionado.");

    const nextProducts = products.filter((p) => !selected[p.sku]);
    setSelected({});
    applyAndSave(nextProducts, `Removidos ${skus.length} itens.`);
  }

  function openEdit(p: Product) {
    setEditSku(p.sku);
    setEditName(p.name);
    setEditCmv(p.cmv.toString().replace(".", ","));
    setEditMlb(p.mlb ?? "");
    setEditEmpresaId(p.empresaId ?? (selectedEmpresaId === NONE_EMPRESA ? NONE_EMPRESA : selectedEmpresaId));
  }

  function saveEdit() {
    if (!editSku) return;

    const sku = normalizeSku(editSku);
    const name = editName.trim() || sku;
    const cmv = parseNumberPt(editCmv);
    const mlb = normalizeMlb(editMlb);
    const empresaId = editEmpresaId === NONE_EMPRESA ? null : editEmpresaId;

    // Se a empresa do produto mudou para uma diferente da selecionada na tela, ele some
    // da lista atual (passa a pertencer a outra empresa) — igual a mover de pasta.
    const staysVisible = empresaId === (selectedEmpresaId === NONE_EMPRESA ? null : selectedEmpresaId);
    const nextProducts = staysVisible
      ? products.map((p) => (p.sku === sku ? { ...p, name, cmv, mlb: mlb || null, empresaId, updatedAt: new Date().toISOString() } : p))
      : products.filter((p) => p.sku !== sku);

    setEditSku(null);

    if (staysVisible) {
      applyAndSave(nextProducts, `SKU ${sku} atualizado.`);
    } else {
      // Produto mudou de empresa: salva com o empresaId novo diretamente (não com o da tela).
      setProducts(nextProducts);
      setSaving(true);
      fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sku, name, cmv, mlb: mlb || null, empresaId }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.error) throw new Error(data.error);
          toast(`SKU ${sku} movido para outra empresa.`);
        })
        .catch((e) => {
          console.error(e);
          toast("Erro ao mover produto de empresa (veja o console).");
        })
        .finally(() => setSaving(false));
    }
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
        if (!items.length) return toast("Planilha lida, mas não encontrei linhas válidas.");

        const preview = [
          "IMPORTADO_DE_EXCEL",
          `ARQUIVO=${file.name}`,
          `LINHAS=${items.length}`,
          "",
          "SKU;Nome;CMV;MLB",
          ...items.slice(0, 50).map((x) => [x.sku, x.name, String(x.cmv ?? 0).replace(".", ","), x.mlb ?? ""].join(";")),
          items.length > 50 ? "..." : "",
        ].join("\n");

        importItems(items.map((x) => ({ sku: x.sku, name: x.name, cmv: Number(x.cmv || 0), mlb: x.mlb })), preview);
        toast("Planilha Excel importada com sucesso.");
      } else {
        const text = await file.text();
        const { rows } = parseCsvText(text);
        const items = rowsToImportItems(rows);
        if (!items.length) return toast("Não encontrei linhas válidas para importar.");

        importItems(items.map((x) => ({ sku: x.sku, name: x.name, cmv: Number(x.cmv || 0), mlb: x.mlb })), text);
        toast("CSV/TXT importado com sucesso.");
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "desconhecido";
      toast(`Erro ao ler arquivo: ${msg}`);
    } finally {
      e.target.value = "";
    }
  }

  async function runSync(all: boolean) {
    if (!all && (!selectedEmpresaId || selectedEmpresaId === NONE_EMPRESA)) return;
    let processedSoFar = 0;
    let totalKnown = 0;
    let updatedTotal = 0;
    const allErrors: TinySyncError[] = [];
    setSyncState({ running: true, processed: 0, total: 0, mode: all ? "all" : "single" });

    try {
      for (let round = 0; round < 50; round++) {
        const res = await fetch("/api/tiny/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(all ? { all: true } : { empresaId: selectedEmpresaId }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast(data?.error || "Erro ao sincronizar com o Tiny.");
          break;
        }

        let done: boolean;
        if (all) {
          const empresasResult = (data.empresas ?? []) as TinySyncEmpresaResult[];
          if (round === 0) totalKnown = empresasResult.reduce((s, e) => s + e.total, 0);
          processedSoFar += empresasResult.reduce((s, e) => s + e.processed, 0);
          updatedTotal += empresasResult.reduce((s, e) => s + ((e as { updated?: number }).updated ?? 0), 0);
          for (const e of empresasResult) allErrors.push(...(e.errors ?? []));
          done = Boolean(data.done);
        } else {
          if (round === 0) totalKnown = data.total ?? 0;
          processedSoFar += data.processed ?? 0;
          updatedTotal += data.updated ?? 0;
          allErrors.push(...((data.errors ?? []) as TinySyncError[]));
          done = Boolean(data.done);
        }

        setSyncState({ running: !done, processed: Math.min(processedSoFar, totalKnown), total: totalKnown, mode: all ? "all" : "single" });
        if (done) break;
      }

      if (allErrors.length > 0) {
        console.warn(`Sincronização com o Tiny: ${allErrors.length} SKU(s) sem custo atualizado.`, allErrors);
        toast(`Sincronização concluída: ${updatedTotal} atualizado(s), ${allErrors.length} sem retorno do Tiny (veja o console).`);
      } else {
        toast(`Sincronização com o Tiny concluída: ${updatedTotal} produto(s) atualizado(s).`);
      }
      const fresh = await loadFromDb(selectedEmpresaId);
      setProducts(fresh);
    } catch (e) {
      console.error(e);
      toast("Erro ao sincronizar com o Tiny (veja o console).");
    } finally {
      setSyncState((s) => ({ ...s, running: false }));
    }
  }

  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showTrackedSkus, setShowTrackedSkus] = useState(false);
  const [trackedSkusText, setTrackedSkusText] = useState("");

  const canSyncSingle = !!selectedEmpresa?.tinyApiToken;
  const canSyncAll = role === "MASTER" && empresas.some((e) => e.tinyApiToken);

  return (
    <div className="space-y-7">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[27px] font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>
            Sua base de produtos
          </h1>
          <p className="mt-1.5 max-w-md text-sm" style={{ color: "var(--muted)" }}>
            {products.length} produto{products.length === 1 ? "" : "s"} cadastrado{products.length === 1 ? "" : "s"} nesta empresa. O CMV daqui alimenta o cálculo em Precificação.
            {saving ? " Salvando…" : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm((v) => !v)}
          disabled={!selectedEmpresaId}
          className="flex shrink-0 items-center gap-2 self-start rounded-full px-5 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
        >
          + Adicionar produto
        </button>
      </div>

      {/* Seletor de empresa */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
        <label className="text-sm font-medium">Empresa</label>
        <select
          value={selectedEmpresaId}
          onChange={(e) => { setSelectedEmpresaId(e.target.value); setPage(1); }}
          className="border rounded-lg px-3 py-2 text-sm"
          style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
        >
          {empresas.length === 0 && <option value="">Nenhuma empresa cadastrada</option>}
          {empresas.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
          <option value={NONE_EMPRESA}>Sem empresa (legado)</option>
        </select>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => runSync(false)}
            disabled={!canSyncSingle || syncState.running}
            title={canSyncSingle ? undefined : "Configure o token do Tiny em Configurações"}
            className="rounded-full border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
          >
            {syncState.running && syncState.mode === "single" ? "Atualizando…" : "Atualizar CMV desta empresa"}
          </button>
          {role === "MASTER" && (
            <button
              type="button"
              onClick={() => runSync(true)}
              disabled={!canSyncAll || syncState.running}
              title={canSyncAll ? undefined : "Nenhuma empresa com token do Tiny configurado"}
              className="rounded-full border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
            >
              {syncState.running && syncState.mode === "all" ? "Atualizando…" : "Atualizar todas as empresas"}
            </button>
          )}
        </div>

        {syncState.running && (
          <div className="w-full text-xs" style={{ color: "var(--muted)" }}>
            Sincronizando com o Tiny… {syncState.total > 0 ? `${syncState.processed} de ${syncState.total} SKUs` : "iniciando…"}
          </div>
        )}
      </div>

      {status ? (
        <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}>
          {status}
        </div>
      ) : null}

      {/* Adicionar manualmente (revela sob demanda) */}
      {showAddForm && (
        <div className="rounded-2xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <p className="text-sm font-semibold">Adicionar produto manualmente</p>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <input
              value={newSku}
              onChange={(e) => setNewSku(e.target.value)}
              placeholder="SKU"
              className="rounded-xl border px-4 py-2.5 text-sm outline-none"
              style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
            />
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Nome"
              className="rounded-xl border px-4 py-2.5 text-sm outline-none"
              style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
            />
            <input
              value={newCmv}
              onChange={(e) => setNewCmv(e.target.value)}
              placeholder="CMV (ex: 41,48)"
              inputMode="decimal"
              className="rounded-xl border px-4 py-2.5 text-sm outline-none"
              style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
            />
            <input
              value={newMlb}
              onChange={(e) => setNewMlb(e.target.value)}
              placeholder="MLB (opcional)"
              className="rounded-xl border px-4 py-2.5 text-sm outline-none"
              style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                addManualProduct();
                setShowAddForm(false);
              }}
              className="rounded-full px-5 py-2 text-sm font-semibold"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              Adicionar
            </button>
          </div>
        </div>
      )}

      {/* Busca + ferramentas */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5 rounded-full border px-4 py-2.5 sm:max-w-sm sm:flex-1" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <svg width="16" height="16" viewBox="0 0 20 20" style={{ stroke: "var(--muted)", flexShrink: 0 }} fill="none" strokeWidth="1.6" strokeLinecap="round">
            <circle cx="8.6" cy="8.6" r="5.4" /><path d="M16.8 16.8l-3.9-3.9" />
          </svg>
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder="Buscar por SKU, nome ou MLB..."
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: "var(--text)" }}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" onClick={() => setShowTrackedSkus((v) => !v)} className="rounded-full border px-4 py-2 font-medium" style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}>
            Cadastrar SKUs para rastrear
          </button>
          <button type="button" onClick={() => setShowImport((v) => !v)} className="rounded-full border px-4 py-2 font-medium" style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}>
            Importar
          </button>
          <button type="button" onClick={onDownloadBase} className="font-medium" style={{ color: "var(--accent)" }}>
            Baixar CSV
          </button>
          <button type="button" onClick={onDownloadLastImport} className="font-medium" style={{ color: "var(--muted)" }}>
            Última importação
          </button>
          <button type="button" onClick={clearAllProducts} disabled={products.length === 0} className="font-medium disabled:cursor-not-allowed disabled:opacity-50" style={{ color: "var(--crit)" }}>
            Limpar todos
          </button>
        </div>
      </div>

      {/* Cadastro rápido de SKUs a rastrear (revela sob demanda) */}
      {showTrackedSkus && (
        <div className="rounded-2xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <p className="text-sm font-semibold">Cadastrar SKUs para rastrear</p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            Cole aqui só os SKUs que vocês realmente usam nos marketplaces (um por linha, ou separados por vírgula) — sem
            precisar de nome ou CMV. Eles entram nesta empresa com CMV zerado e o botão &ldquo;Atualizar CMV&rdquo; preenche o
            resto a partir do Tiny.
          </p>
          <textarea
            value={trackedSkusText}
            onChange={(e) => setTrackedSkusText(e.target.value)}
            placeholder={"SKU-001\nSKU-002\nSKU-003"}
            rows={6}
            className="mt-3 w-full rounded-xl border px-4 py-2.5 text-sm outline-none"
            style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
          />
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => {
                addTrackedSkus(trackedSkusText);
                setTrackedSkusText("");
              }}
              className="rounded-full px-5 py-2 text-sm font-semibold"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              Cadastrar SKUs
            </button>
          </div>
        </div>
      )}

      {/* Painel de importação (revela sob demanda) */}
      {showImport && (
        <div className="rounded-2xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold">Importar de arquivo</p>
            <input ref={fileInputRef} type="file" accept=".csv,.txt,.xls,.xlsx" onChange={onFileChange} className="hidden" />
            <button
              onClick={onUploadClick}
              className="self-start rounded-full border px-4 py-2 text-sm font-semibold sm:self-auto"
              style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
            >
              Escolher arquivo (CSV / Excel)
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
            Os produtos importados aqui entram na empresa selecionada acima.
            <br />Você pode importar:
            <br />• CSV/TXT com <b>SKU;Nome;CMV;MLB</b> (MLB é opcional)
            <br />• Excel do ERP com cabeçalhos tipo <b>Descrição</b>, <b>Código (SKU)</b>, <b>Custo</b> e (se existir) <b>MLB</b>
            <br />• Planilha de vínculo <b>item_seller</b> (SKU) + <b>item_id</b> (MLB) — atualiza o MLB no mesmo SKU
          </p>
        </div>
      )}

      {/* Barra de seleção (só aparece com algo selecionado) */}
      {selectedCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-sm" style={{ background: "var(--accent-soft)", borderColor: "var(--accent-soft-border)" }}>
          <span style={{ color: "var(--text)" }}>{selectedCount} selecionado{selectedCount === 1 ? "" : "s"}</span>
          <div className="flex items-center gap-4">
            <button type="button" onClick={toggleSelectAllVisible} className="font-medium" style={{ color: "var(--accent)" }}>
              {allVisibleSelected ? "Desmarcar visíveis" : "Selecionar visíveis"}
            </button>
            <button type="button" onClick={deleteSelected} className="font-medium" style={{ color: "var(--crit)" }}>
              Excluir selecionados
            </button>
            <button type="button" onClick={() => setSelected({})} className="font-medium" style={{ color: "var(--muted)" }}>
              Limpar
            </button>
          </div>
        </div>
      )}

      {/* Lista de produtos */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border py-16 text-center text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}>
          {products.length === 0 ? "Nenhum produto cadastrado nesta empresa ainda." : "Nenhum produto encontrado para essa busca."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div
            className="grid items-center gap-3 border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide"
            style={{ gridTemplateColumns: "24px minmax(120px,1fr) minmax(160px,2fr) 110px 160px 120px", borderColor: "var(--border)", color: "var(--muted)" }}
          >
            <span />
            <span>SKU</span>
            <span>Nome do produto</span>
            <span>CMV</span>
            <span>Última atualização</span>
            <span />
          </div>

          {pageItems.map((p) => {
            const daysStale = (Date.now() - new Date(p.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
            const isStale = daysStale > STALE_DAYS;
            return (
              <div
                key={p.sku}
                className="grid items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                style={{ gridTemplateColumns: "24px minmax(120px,1fr) minmax(160px,2fr) 110px 160px 120px", borderColor: "var(--border)", background: selected[p.sku] ? "var(--accent-soft)" : "transparent" }}
              >
                <input
                  type="checkbox"
                  checked={!!selected[p.sku]}
                  onChange={() => toggleOne(p.sku)}
                  className="h-4 w-4 shrink-0 accent-current"
                  style={{ color: "var(--accent)" }}
                  aria-label={`Selecionar ${p.sku}`}
                />
                <span className="truncate font-medium tracking-wide">{p.sku}</span>
                <span className="truncate">{p.name}</span>
                <span className="tabular-nums font-semibold">R$ {toMoneyPt(p.cmv)}</span>
                <span className="text-[12.5px]" style={{ color: isStale ? "var(--warn)" : "var(--muted)" }}>
                  {getRelativeTime(new Date(p.updatedAt))}
                  {isStale ? " ⚠" : ""}
                </span>
                <div className="flex gap-3.5">
                  <button type="button" onClick={() => openEdit(p)} className="text-[12.5px] font-semibold" style={{ color: "var(--accent)" }}>
                    Editar
                  </button>
                  <button type="button" onClick={() => deleteOne(p.sku)} className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                    Remover
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Paginação */}
      {filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm" style={{ color: "var(--muted)" }}>
          <span>
            {filtered.length} produto{filtered.length === 1 ? "" : "s"} — página {safePage} de {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded-full border px-4 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="rounded-full border px-4 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-50"
              style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
            >
              Próxima
            </button>
          </div>
        </div>
      )}

      {editSku ? (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: "rgba(41,33,23,0.45)" }}>
          <div className="w-full max-w-lg rounded-2xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
            <h3 className="text-[19px] font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Editar produto</h3>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1">
                <span className="text-xs" style={{ color: "var(--muted)" }}>SKU</span>
                <input value={editSku} disabled className="rounded-xl border px-4 py-2.5 text-sm" style={{ background: "var(--surface-soft)", color: "var(--muted)", borderColor: "var(--border)" }} />
              </label>

              <label className="grid gap-1">
                <span className="text-xs" style={{ color: "var(--muted)" }}>Nome</span>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="rounded-xl border px-4 py-2.5 text-sm outline-none"
                  style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs" style={{ color: "var(--muted)" }}>CMV</span>
                <input
                  value={editCmv}
                  onChange={(e) => setEditCmv(e.target.value)}
                  inputMode="decimal"
                  className="rounded-xl border px-4 py-2.5 text-sm outline-none"
                  style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs" style={{ color: "var(--muted)" }}>MLB</span>
                <input
                  value={editMlb}
                  onChange={(e) => setEditMlb(e.target.value)}
                  placeholder="Ex: MLB46360154"
                  className="rounded-xl border px-4 py-2.5 text-sm outline-none"
                  style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs" style={{ color: "var(--muted)" }}>Empresa</span>
                <select
                  value={editEmpresaId}
                  onChange={(e) => setEditEmpresaId(e.target.value)}
                  className="rounded-xl border px-4 py-2.5 text-sm outline-none"
                  style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
                >
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                  <option value={NONE_EMPRESA}>Sem empresa (legado)</option>
                </select>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                onClick={cancelEdit}
                className="rounded-full border px-4 py-2 text-sm font-semibold"
                style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
              >
                Cancelar
              </button>
              <button
                onClick={saveEdit}
                className="rounded-full px-4 py-2 text-sm font-semibold"
                style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
