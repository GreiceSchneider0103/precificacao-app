"use client";

import { signIn, signOut } from "next-auth/react";
import { useState, type FormEvent } from "react";

// ---- Ícones simples ----
function EyeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// ---- Campo de senha com olhinho ----
export function PasswordInput({
  value,
  onChangeAction,
  placeholder = "••••••••",
  autoComplete = "current-password",
  disabled = false,
}: {
  value: string;
  onChangeAction: (v: string) => void; // ✅ nome termina com Action (some o warning)
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => onChangeAction(e.target.value)}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        disabled={disabled}
        className="w-full rounded-xl bg-neutral-950/60 px-4 py-3 pr-11 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60 disabled:opacity-60"
        placeholder={placeholder}
      />

      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition disabled:opacity-50"
        tabIndex={-1}
        aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        disabled={disabled}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

// ---- Botão Google ----
export function GoogleButton({
  label = "Entrar com Google",
  callbackUrl = "/precificacao",
}: {
  label?: string;
  callbackUrl?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl })}
      className="w-full rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
    >
      {label}
    </button>
  );
}

// ---- Botão Sair ----
export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
    >
      Sair
    </button>
  );
}

// ---- Login por credenciais ----
export function CredentialsLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErr("Preencha email e senha.");
      return;
    }

    setLoading(true);

    const res = await signIn("credentials", {
      email: cleanEmail,
      password,
      redirect: false,
      callbackUrl: "/precificacao",
    });

    if (!res || res.error) {
      setErr("Login inválido. Verifique e tente novamente.");
      setLoading(false);
      return;
    }

    window.location.href = res.url ?? "/precificacao";
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <label className="grid gap-1">
        <span className="text-xs text-white/60">Email</span>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          autoComplete="email"
          disabled={loading}
          className="rounded-xl bg-neutral-950/60 px-4 py-3 text-sm text-white ring-1 ring-white/10 outline-none focus:ring-2 focus:ring-blue-600/60 disabled:opacity-60"
          placeholder="seu@email.com"
        />
      </label>

      <label className="grid gap-1">
        <span className="text-xs text-white/60">Senha</span>
        <PasswordInput
          value={password}
          onChangeAction={setPassword}
          disabled={loading}
        />
      </label>

      {err && (
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-100">
          {err}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className={
          loading
            ? "w-full cursor-not-allowed rounded-xl bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200/60 ring-1 ring-emerald-500/10"
            : "w-full rounded-xl bg-emerald-500/15 px-4 py-3 text-sm font-semibold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20"
        }
      >
        {loading ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}
