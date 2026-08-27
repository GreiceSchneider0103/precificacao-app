"use client";

import { useEffect, useMemo, useState } from "react";

type EmpresaRow = { id: string; name: string };
type UserRow = {
  id: string;
  name: string | null;
  email: string | null;
  role: "MASTER" | "MEMBER";
  approved: boolean;
  createdAt: string;
  empresaIds: string[];
};

export function UsuariosClient() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [empresasOwned, setEmpresasOwned] = useState<EmpresaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [selection, setSelection] = useState<Record<string, Set<string>>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [newEmpresaName, setNewEmpresaName] = useState<Record<string, string>>({});

  function toast(msg: string) {
    setStatus(msg);
    window.setTimeout(() => setStatus(""), 3000);
  }

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao carregar usuários");
      const list = (data.users ?? []) as UserRow[];
      setUsers(list);
      setEmpresasOwned((data.empresasOwned ?? []) as EmpresaRow[]);
      setSelection((prev) => {
        const next = { ...prev };
        for (const u of list) {
          if (!next[u.id]) next[u.id] = new Set(u.empresaIds);
        }
        return next;
      });
    } catch (e) {
      console.error(e);
      toast("Erro ao carregar usuários (veja o console).");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleEmpresa(userId: string, empresaId: string) {
    setSelection((prev) => {
      const set = new Set(prev[userId] ?? []);
      if (set.has(empresaId)) set.delete(empresaId);
      else set.add(empresaId);
      return { ...prev, [userId]: set };
    });
  }

  async function createEmpresaFor(userId: string) {
    const name = (newEmpresaName[userId] || "").trim();
    if (!name) return toast("Digite um nome para a nova empresa.");
    setSavingId(userId);
    try {
      const res = await fetch("/api/settings/rulesets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, data: {} }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao criar empresa");
      const created = data.created as { id: string; name: string };
      setEmpresasOwned((prev) => [...prev, { id: created.id, name: created.name }].sort((a, b) => a.name.localeCompare(b.name)));
      setSelection((prev) => ({ ...prev, [userId]: new Set([...(prev[userId] ?? []), created.id]) }));
      setNewEmpresaName((prev) => ({ ...prev, [userId]: "" }));
      toast(`Empresa "${created.name}" criada e marcada para este usuário.`);
    } catch (e) {
      console.error(e);
      toast("Erro ao criar empresa (veja o console).");
    } finally {
      setSavingId(null);
    }
  }

  async function saveAccess(userId: string, opts?: { approve?: boolean }) {
    setSavingId(userId);
    try {
      const empresaIds = Array.from(selection[userId] ?? []);
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ empresaIds, ...(opts?.approve ? { approved: true } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao salvar");
      toast(opts?.approve ? "Usuário aprovado com acesso às empresas selecionadas." : "Acesso atualizado.");
      await load();
    } catch (e) {
      console.error(e);
      toast("Erro ao salvar (veja o console).");
    } finally {
      setSavingId(null);
    }
  }

  async function removeUser(u: UserRow) {
    const ok = window.confirm(
      u.approved
        ? `Remover o acesso de "${u.name || u.email}"? A conta é apagada e não dá pra desfazer.`
        : `Recusar o cadastro de "${u.name || u.email}"? A conta é apagada e não dá pra desfazer.`
    );
    if (!ok) return;
    setSavingId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao remover");
      toast("Usuário removido.");
      await load();
    } catch (e) {
      console.error(e);
      toast("Erro ao remover (veja o console).");
    } finally {
      setSavingId(null);
    }
  }

  const pendentes = useMemo(() => users.filter((u) => !u.approved), [users]);
  const aprovados = useMemo(() => users.filter((u) => u.approved), [users]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[27px] font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Usuários</h1>
        <p className="mt-1.5 max-w-lg text-sm" style={{ color: "var(--muted)" }}>
          Aprove cadastros novos e escolha a quais empresas cada usuário tem acesso.
        </p>
      </div>

      {status ? (
        <div className="rounded-xl border px-4 py-3 text-sm" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}>
          {status}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted)" }}>Carregando...</p>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>
              Pendentes de aprovação {pendentes.length > 0 && `(${pendentes.length})`}
            </h2>
            {pendentes.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>Nenhum cadastro aguardando aprovação.</p>
            ) : (
              <div className="space-y-3">
                {pendentes.map((u) => (
                  <div key={u.id} className="rounded-2xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                    <div>
                      <p className="font-semibold">{u.name || "(sem nome)"}</p>
                      <p className="text-sm" style={{ color: "var(--muted)" }}>{u.email}</p>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        Cadastrado em {new Date(u.createdAt).toLocaleString("pt-BR")}
                      </p>
                    </div>

                    <EmpresaPicker
                      empresas={empresasOwned}
                      selected={selection[u.id] ?? new Set()}
                      onToggle={(empresaId) => toggleEmpresa(u.id, empresaId)}
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={newEmpresaName[u.id] || ""}
                        onChange={(e) => setNewEmpresaName((prev) => ({ ...prev, [u.id]: e.target.value }))}
                        placeholder="Nome de uma nova empresa"
                        className="rounded-lg border px-3 py-1.5 text-sm outline-none"
                        style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
                      />
                      <button
                        type="button"
                        onClick={() => createEmpresaFor(u.id)}
                        disabled={savingId === u.id}
                        className="rounded-lg border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
                      >
                        + Criar empresa
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => saveAccess(u.id, { approve: true })}
                        disabled={savingId === u.id}
                        className="rounded-full px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
                      >
                        Aprovar
                      </button>
                      <button
                        type="button"
                        onClick={() => removeUser(u)}
                        disabled={savingId === u.id}
                        className="rounded-full border px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ borderColor: "var(--crit)", color: "var(--crit)" }}
                      >
                        Recusar
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Usuários aprovados</h2>
            {aprovados.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted)" }}>Nenhum outro usuário aprovado ainda.</p>
            ) : (
              <div className="space-y-3">
                {aprovados.map((u) => (
                  <div key={u.id} className="rounded-2xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                    <div>
                      <p className="font-semibold">{u.name || "(sem nome)"}</p>
                      <p className="text-sm" style={{ color: "var(--muted)" }}>{u.email}</p>
                    </div>

                    <EmpresaPicker
                      empresas={empresasOwned}
                      selected={selection[u.id] ?? new Set()}
                      onToggle={(empresaId) => toggleEmpresa(u.id, empresaId)}
                    />

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => saveAccess(u.id)}
                        disabled={savingId === u.id}
                        className="rounded-full px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
                      >
                        Salvar acesso
                      </button>
                      <button
                        type="button"
                        onClick={() => removeUser(u)}
                        disabled={savingId === u.id}
                        className="rounded-full border px-5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        style={{ borderColor: "var(--crit)", color: "var(--crit)" }}
                      >
                        Remover usuário
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function EmpresaPicker({
  empresas,
  selected,
  onToggle,
}: {
  empresas: EmpresaRow[];
  selected: Set<string>;
  onToggle: (empresaId: string) => void;
}) {
  if (empresas.length === 0) {
    return (
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Você ainda não tem nenhuma empresa cadastrada — crie uma abaixo para conceder acesso.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {empresas.map((e) => {
        const active = selected.has(e.id);
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onToggle(e.id)}
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
            style={
              active
                ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" }
                : { background: "var(--surface-soft)", color: "var(--muted2)", borderColor: "var(--border)" }
            }
          >
            {e.name}
          </button>
        );
      })}
    </div>
  );
}
