import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ProdutosClient } from "./ProdutosClient";

export const dynamic = "force-dynamic";

export default async function ProdutosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  return <ProdutosClient role={session.user.role ?? "MASTER"} />;
}
