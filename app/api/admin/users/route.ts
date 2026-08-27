// app/api/admin/users/route.ts
//
// Só para usuários MASTER: lista as contas cadastradas (pendentes e já aprovadas,
// inclusive outras contas master) e as empresas do próprio master, para montar a tela de
// aprovação/concessão de acesso. Outra conta master aparece aqui porque promover alguém
// a master não dá acesso automático às empresas de UM master diferente — cada uma
// pertence a um dono específico e precisa ser concedida, igual a um MEMBER.
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    if (session.user.role !== "MASTER") {
      return NextResponse.json({ error: "Só um usuário master pode ver esta página" }, { status: 403 });
    }

    const [users, empresasOwned] = await Promise.all([
      prisma.user.findMany({
        where: { id: { not: session.user.id } },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          approved: true,
          createdAt: true,
          empresaAccess: { select: { empresaId: true } },
        },
        orderBy: [{ approved: "asc" }, { createdAt: "desc" }],
      }),
      prisma.markupRuleset.findMany({
        where: { userId: session.user.id },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    ]);

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        approved: u.approved,
        createdAt: u.createdAt,
        empresaIds: u.empresaAccess.map((a) => a.empresaId),
      })),
      empresasOwned,
    });
  } catch (error) {
    console.error("[GET /api/admin/users]", error);
    return NextResponse.json({ error: "Erro ao carregar usuários" }, { status: 500 });
  }
}
