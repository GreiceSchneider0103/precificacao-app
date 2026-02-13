// auth.ts (RAIZ DO PROJETO)
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  
  // ⭐ MUDANÇA CRÍTICA: JWT → DATABASE
  // Isso faz o cookie ter só ~100 bytes em vez de 4KB+
  session: {
    strategy: "database", // ← ESTA LINHA RESOLVE O ERRO 494
    maxAge: 30 * 24 * 60 * 60, // 30 dias
  },
  
  pages: {
    signIn: "/",
  },
  
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      async authorize(credentials) {
        try {
          const email = String(credentials?.email ?? "").toLowerCase().trim();
          const password = String(credentials?.password ?? "");

          if (!email || !password) {
            console.log("❌ Email ou senha vazios");
            return null;
          }

          const user = await prisma.user.findUnique({
            where: { email },
          });

          if (!user) {
            console.log("❌ Usuário não encontrado:", email);
            return null;
          }

          if (!user.passwordHash) {
            console.log("❌ Usuário sem senha:", email);
            return null;
          }

          const passwordMatch = await bcrypt.compare(password, user.passwordHash);
          
          if (!passwordMatch) {
            console.log("❌ Senha incorreta para:", email);
            return null;
          }

          console.log("✅ Login bem-sucedido:", email);
          return {
            id: user.id,
            email: user.email ?? "",
            name: user.name ?? "",
            image: user.image,
          };
        } catch (error) {
          console.error("❌ Erro no authorize:", error);
          return null;
        }
      },
    }),

    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  
  // Com database sessions, os callbacks mudam:
  callbacks: {
    // async jwt() não é mais necessário com database sessions
    
    async session({ session, user }) {
      // 'user' vem direto do banco quando strategy = "database"
      if (session.user) {
        (session.user as any).id = user.id;
      }
      return session;
    },
  },
  
  debug: process.env.NODE_ENV === "development",
});