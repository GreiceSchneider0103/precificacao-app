// app/usuarios/page.tsx
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { UsuariosClient } from "./UsuariosClient";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  if (session.user.role !== "MASTER") redirect("/precificacao");

  return <UsuariosClient />;
}
