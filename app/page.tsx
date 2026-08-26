// app/page.tsx
import Link from "next/link";
import { auth } from "@/auth";
import { CredentialsLogin, GoogleButton, SignOutButton } from "./components/AuthClientButtons";

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    return (
      <div className="mx-auto max-w-lg">
        <section className="rounded-2xl border p-7" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <h1 className="text-[26px] font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>
            Bem-vinda de volta
          </h1>
          <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
            Você está logada como <b style={{ color: "var(--text)" }}>{session.user.email ?? session.user.name ?? "usuário"}</b>.
          </p>

          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link
              href="/precificacao"
              className="rounded-full px-5 py-2.5 text-sm font-semibold"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              Ir para Precificação
            </Link>
            <Link
              href="/minha-conta"
              className="rounded-full border px-5 py-2.5 text-sm font-semibold"
              style={{ borderColor: "var(--border-strong)", color: "var(--text)" }}
            >
              Minha conta
            </Link>
            <SignOutButton />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <section className="text-center">
        <div
          className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-lg text-base font-semibold"
          style={{ background: "var(--accent)", color: "var(--accent-ink)", fontFamily: "var(--font-serif), serif" }}
        >
          M
        </div>
        <h1 className="text-[27px] font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>
          Entrar no Markup
        </h1>
        <p className="mt-1.5 text-sm" style={{ color: "var(--muted)" }}>
          Precificação inteligente para marketplaces
        </p>
      </section>

      <section className="mt-7 rounded-2xl border p-7" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          E-mail e senha
        </p>
        <div className="mt-4">
          <CredentialsLogin />
        </div>

        <p className="mt-4 text-sm" style={{ color: "var(--muted)" }}>
          Não tem conta?{" "}
          <Link href="/cadastro" className="font-semibold" style={{ color: "var(--accent)" }}>
            Criar cadastro
          </Link>
        </p>
      </section>

      <section className="mt-4 rounded-2xl border p-7" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Google
        </p>
        <div className="mt-4">
          <GoogleButton />
        </div>
      </section>
    </div>
  );
}
