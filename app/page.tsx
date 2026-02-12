import Link from "next/link";
import { auth } from "@/auth";
import { CredentialsLogin, GoogleButton } from "./components/AuthClientButtons";

export default async function HomePage() {
  const session = await auth();

  if (session?.user) {
    return (
      <div className="space-y-5">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h1 className="text-2xl font-semibold">Markup</h1>
          <p className="mt-1 text-sm text-white/60">
            Você já está logado como <b>{session.user.email ?? session.user.name ?? "usuário"}</b>.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/precificacao"
              className="rounded-xl bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20"
            >
              Ir para Precificação
            </Link>
            <Link
              href="/minha-conta"
              className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/10 hover:bg-white/15"
            >
              Minha conta
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h1 className="text-2xl font-semibold">Entrar</h1>
        <p className="mt-1 text-sm text-white/60">
          Acesse o Markup com e-mail/senha ou Google.
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs font-medium tracking-wide text-white/60">E-MAIL E SENHA</p>
            <div className="mt-4">
              <CredentialsLogin />
            </div>

            <p className="mt-4 text-sm text-white/60">
              Não tem conta?{" "}
              <Link href="/cadastro" className="font-semibold text-white hover:underline">
                Criar cadastro
              </Link>
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <p className="text-xs font-medium tracking-wide text-white/60">GOOGLE</p>
            <div className="mt-4 grid gap-2">
              <GoogleButton />
              <p className="text-xs text-white/50">
              
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
