// app/api/admin/users/[id]/route.ts
//
// Só para usuários MASTER: aprova/recusa cadastros e concede ou revoga acesso a
// empresas de um usuário MEMBER.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

async function requireMaster() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (session.user.role !== "MASTER") {
    return { error: NextResponse.json({ error: "Só um usuário master pode gerenciar usuários" }, { status: 403 }) };
  }
  return { masterId: session.user.id };
}

/**
 * PATCH { approved?: boolean, empresaIds?: string[] }
 * Aprova/recusa o cadastro e/ou define exatamente a lista de empresas às quais o usuário
 * tem acesso (substitui a lista atual pela enviada). As empresas precisam pertencer ao
 * próprio master que está fazendo a chamada.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const guard = await requireMaster();
  if (guard.error) return guard.error;
  const { masterId } = guard;

  try {
    const { id: targetUserId } = await context.params;
    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    if (target.role === "MASTER") {
      return NextResponse.json({ error: "Não é possível gerenciar o acesso de outro usuário master" }, { status: 400 });
    }

    const body = (await request.json()) as { approved?: boolean; empresaIds?: string[] };

    if (Array.isArray(body.empresaIds)) {
      const empresaIds = body.empresaIds.filter((id) => typeof id === "string");
      const owned = await prisma.markupRuleset.findMany({
        where: { id: { in: empresaIds }, userId: masterId },
        select: { id: true },
      });
      if (owned.length !== empresaIds.length) {
        return NextResponse.json({ error: "Uma ou mais empresas não pertencem à sua conta" }, { status: 400 });
      }

      await prisma.$transaction([
        prisma.empresaAccess.deleteMany({ where: { userId: targetUserId, empresaId: { notIn: empresaIds } } }),
        ...empresaIds.map((empresaId) =>
          prisma.empresaAccess.upsert({
            where: { userId_empresaId: { userId: targetUserId, empresaId } },
            update: {},
            create: { userId: targetUserId, empresaId },
          })
        ),
      ]);
    }

    if (typeof body.approved === "boolean") {
      await prisma.user.update({ where: { id: targetUserId }, data: { approved: body.approved } });
    }

    const updated = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        approved: true,
        createdAt: true,
        empresaAccess: { select: { empresaId: true } },
      },
    });

    return NextResponse.json({
      user: updated && {
        ...updated,
        empresaIds: updated.empresaAccess.map((a) => a.empresaId),
        empresaAccess: undefined,
      },
    });
  } catch (error) {
    console.error("[PATCH /api/admin/users/:id]", error);
    return NextResponse.json({ error: "Erro ao atualizar usuário" }, { status: 500 });
  }
}

/**
 * DELETE: remove a conta (usada para recusar um cadastro pendente, ou revogar
 * completamente um usuário já aprovado). Cascata remove sessões e concessões de acesso.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const guard = await requireMaster();
  if (guard.error) return guard.error;

  try {
    const { id: targetUserId } = await context.params;
    const target = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    if (target.role === "MASTER") {
      return NextResponse.json({ error: "Não é possível remover outro usuário master" }, { status: 400 });
    }

    await prisma.user.delete({ where: { id: targetUserId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[DELETE /api/admin/users/:id]", error);
    return NextResponse.json({ error: "Erro ao remover usuário" }, { status: 500 });
  }
}
