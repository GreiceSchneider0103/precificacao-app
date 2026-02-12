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
    } catch (e: any) {
      setErr(e?.message || "Erro ao cadastrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">Criar conta</h1>
        <p className="mt-1 text-sm text-white/60">Cadastro por e-mail e senha.</p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <form onSubmit={onSubmit} className="grid gap-3 md:max-w-lg">
          <label className="grid gap-1">
            <span className="text-xs text-white/60">Nome (opcional)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
              placeholder="Seu nome"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-white/60">Email</span>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
              placeholder="seu@email.com"
              required
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-white/60">Senha</span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="new-password"
              className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60"
              placeholder="mínimo 6 caracteres"
              required
            />
          </label>

          {err ? (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
              {err}
            </div>
          ) : null}

          {ok ? (
            <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
              Conta criada. Volte e faça login.
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className={
              loading
                ? "w-full cursor-not-allowed rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200/60 ring-1 ring-emerald-500/10"
                : "w-full rounded-xl bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20"
            }
          >
            {loading ? "Criando..." : "Criar conta"}
          </button>

          <p className="text-sm text-white/60">
            Já tem conta?{" "}
            <Link href="/" className="font-semibold text-white hover:underline">
              Voltar para login
            </Link>
          </p>
        </form>
      </section>
    </div>
  );
}
