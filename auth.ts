import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),

  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },

  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
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

    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.role = (user as { role?: string }).role;
        token.approved = (user as { approved?: boolean }).approved;
      }
      if (trigger === "update" && session) return { ...token, ...(session as Record<string, unknown>) };
      return token;
    },

    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
        // Fail-closed em role: token sem role reconhecível vira MEMBER (mais restritivo),
        // não MASTER.
        session.user.role = (token.role as "MASTER" | "MEMBER" | undefined) ?? "MEMBER";
        // `approved` é campo novo: sessões já ativas antes deste recurso existir (só a
        // conta original, já confiável) não têm esse campo no token ainda — tratar
        // `undefined` como aprovado evita trancar quem já usava o sistema fora do ar até
        // relogar. Só `false` explícito (contas novas, que authorize()/adapter já
        // preenchem de verdade) bloqueia de fato.
        session.user.approved = token.approved !== false;
      }
      return session;
    },
  },

  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/signin", error: "/auth/error" },
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
