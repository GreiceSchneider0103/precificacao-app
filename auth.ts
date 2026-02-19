import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma"; // ajuste o path
import { compare } from "bcryptjs"; // se você usa bcrypt

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),

  // ✅ IMPORTANTE: Com Credentials provider, PRECISA usar JWT
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 dias
  },

  jwt: {
    maxAge: 30 * 24 * 60 * 60, // 30 dias
  },

  providers: [
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

        // ✅ retorno mínimo - apenas id e email no JWT
        return { 
          id: user.id, 
          email: user.email,
          name: user.name ?? ""
        };
      },
    }),
  ],

  callbacks: {
    // ✅ mantém JWT compacto - apenas id e email
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
      }
      return token;
    },

    // ✅ adiciona dados à sessão do cliente
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        // ensure email is always a string to satisfy TypeScript and prevent undefined assignments
        session.user.email = String((token as any)?.email ?? "");
      }
      return session;
    },
  },

  // ✅ importante ter secret fixo
  secret: process.env.AUTH_SECRET,

  debug: process.env.NODE_ENV === "development",
  
  // ✅ desabilitamos eventos de rastreamento que podem aumentar tamanho
  pages: {
    signIn: "/signin",
    error: "/auth/error",
  },
});

