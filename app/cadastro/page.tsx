"use client";

import Link from "next/link";
import { useState } from "react";

export default function CadastroPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOk(false);
    setLoading(true);

    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Erro ao cadastrar");

      setOk(true);
      setName("");
      setEmail("");
      setPassword("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao cadastrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <section className="text-center">
        <h1 className="text-[27px] font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>Criar conta</h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>Cadastro por e-mail e senha.</p>
      </section>

      <section className="mt-7 rounded-2xl border p-7" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <form onSubmit={onSubmit} className="grid gap-3">
          <label className="grid gap-1">
            <span className="text-xs" style={{ color: "var(--muted)" }}>Nome (opcional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-xl border px-4 py-3 text-sm outline-none"
              style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
              placeholder="Seu nome"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs" style={{ color: "var(--muted)" }}>Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              className="rounded-xl border px-4 py-3 text-sm outline-none"
              style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
              placeholder="seu@email.com"
              required
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs" style={{ color: "var(--muted)" }}>Senha</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="new-password"
              className="rounded-xl border px-4 py-3 text-sm outline-none"
              style={{ background: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--border)" }}
              placeholder="mínimo 6 caracteres"
              required
            />
          </label>

          {err ? (
            <div className="rounded-xl border px-4 py-2 text-sm" style={{ borderColor: "var(--crit-soft)", background: "var(--crit-soft)", color: "var(--crit)" }}>
              {err}
            </div>
          ) : null}

          {ok ? (
            <div className="rounded-xl border px-4 py-2 text-sm" style={{ borderColor: "var(--good-soft)", background: "var(--good-soft)", color: "var(--good)" }}>
              Conta criada! Um administrador precisa aprovar seu acesso antes que você possa entrar — você pode
              fazer login para acompanhar, mas só verá as empresas depois de aprovado(a).
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
          >
            {loading ? "Criando..." : "Criar conta"}
          </button>

          <p className="text-sm" style={{ color: "var(--muted)" }}>
            Já tem conta?{" "}
            <Link href="/" className="font-semibold" style={{ color: "var(--accent)" }}>
              Voltar para login
            </Link>
          </p>
        </form>
      </section>
    </div>
  );
}
