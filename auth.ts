import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";
import authConfig from "./auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),

  providers: [
    ...authConfig.providers,
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email || "").toLowerCase().trim();
        const password = String(credentials?.password || "");
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.passwordHash) return null;
        const ok = await compare(password, user.passwordHash);
        if (!ok) return null;
        // Login funciona normalmente mesmo sem aprovação — quem trava o acesso é o
        // middleware, redirecionando para /pendente. Assim a pessoa sabe que a conta
        // existe e está aguardando aprovação, em vez de "senha inválida".
        return { id: user.id, email: user.email, name: user.name ?? "", role: user.role, approved: user.approved };
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,
    // ✅ FIX: removido parâmetro `profile` não utilizado; tipo explícito no lugar de `any`
    async signIn({ user, account }) {
      if (account?.provider === "google") {
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email! },
          include: { accounts: true },
        });
        if (existingUser) {
          const hasGoogle = existingUser.accounts.some(
            // ✅ FIX: tipo explícito em vez de `any`
            (acc: { provider: string }) => acc.provider === "google"
          );
          if (!hasGoogle && !existingUser.emailVerified) {
            return "/auth/error?error=EmailNotVerified";
          }
        }
      }
      return true;
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: "MASTER" | "MEMBER";
      approved?: boolean;
    };
  }
}
