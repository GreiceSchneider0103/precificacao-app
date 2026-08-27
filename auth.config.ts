// auth.config.ts
//
// Config "edge-safe" do NextAuth — usada pelo middleware.ts (roda no Edge Runtime do
// Vercel). Não pode incluir nada que puxe Prisma/bcrypt para o bundle (PrismaAdapter,
// Credentials.authorize, o callback signIn que consulta o banco) — isso estourava o
// limite de tamanho do Edge Function do plano (1MB) quando o middleware importava
// auth.ts inteiro. auth.ts reaproveita este config e adiciona as partes que só rodam em
// Node.js (rotas de API, server components).
import type { NextAuthConfig } from "next-auth";

export default {
  // Só login por e-mail/senha (ver auth.ts) — sem provider OAuth aqui.
  providers: [],

  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },

  callbacks: {
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
} satisfies NextAuthConfig;
