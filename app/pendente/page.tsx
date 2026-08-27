// app/pendente/page.tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { SignOutButton } from "../components/AuthClientButtons";

export const dynamic = "force-dynamic";

export default async function PendentePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (session.user.approved) redirect("/precificacao");

  return (
    <div className="mx-auto max-w-lg">
      <section className="rounded-2xl border p-7 text-center" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <h1 className="text-[26px] font-semibold" style={{ fontFamily: "var(--font-serif), serif" }}>
          Conta aguardando aprovação
        </h1>
        <p className="mt-3 text-sm" style={{ color: "var(--muted)" }}>
          Sua conta (<b style={{ color: "var(--text)" }}>{session.user.email}</b>) foi criada, mas ainda precisa ser
          aprovada por um administrador antes que você possa acessar o sistema.
        </p>
        <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
          Assim que for aprovado(a) e receber acesso às empresas, entre novamente para continuar.
        </p>
        <div className="mt-5">
          <SignOutButton />
        </div>
      </section>
    </div>
  );
}
