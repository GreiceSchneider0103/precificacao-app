import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { MinhaContaClient } from "./MinhaContaClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MinhaContaPage() {
  const session = await auth();

  const email = session?.user?.email ? String(session.user.email).trim() : "";
  if (!email) redirect("/");

  const sUser = (session?.user ?? {}) as {
    email?: string | null;
    name?: string | null;
    image?: string | null;
  };

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name: sUser.name ?? "",
      image: sUser.image ?? null,
    },
    update: {
      ...(sUser.name ? { name: sUser.name } : {}),
      ...(sUser.image ? { image: sUser.image } : {}),
    },
    select: {
      name: true,
      email: true,
      image: true,
      passwordHash: true,
    },
  });

  return (
    <MinhaContaClient
      initialName={user.name ?? ""}
      email={user.email}
      initialPhone=""                 // ✅ não existe no banco ainda
      initialImage={user.image ?? null}
      hasPassword={!!user.passwordHash}
    />
  );
}
