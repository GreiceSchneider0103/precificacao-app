import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function PATCH(req: Request) {
  const session = await auth();
  const email = session?.user?.email ? String(session.user.email).trim() : "";

  if (!email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { name, image } = body as { name?: unknown; image?: unknown };

  const updated = await prisma.user.update({
    where: { email },
    data: {
      ...(name !== undefined && { name: String(name) }),
      ...(image !== undefined && { image: image ? String(image) : null }),
    },
    select: { id: true, name: true, email: true, image: true },
  });

  return NextResponse.json(updated);
}

export async function GET() {
  const session = await auth();
  const email = session?.user?.email ? String(session.user.email).trim() : "";

  if (!email) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, image: true },
  });

  return NextResponse.json(user);
}
