import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google"; // ✅ Adicionado Google
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 dias de persistência
  },

  providers: [
    // ✅ CONFIGURAÇÃO GOOGLE SEGURA
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
      // allowDangerousEmailAccountLinking: false, // Opcional, já é falso por padrão
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
        
        // Regra de segurança: Se o usuário existe mas não tem senha (ex: criou via Google), 
        // ele não pode logar via Credentials até definir uma senha.
        if (!user || !user.passwordHash) return null;

        const ok = await compare(password, user.passwordHash);
        if (!ok) return null;

        return { 
          id: user.id, 
          email: user.email,
          name: user.name ?? ""
        };
      },
    }),
  ],

  callbacks: {
    // ✅ TÓPICO B: PROTEÇÃO DE LINKING E VERIFICAÇÃO DE E-MAIL
    async signIn({ user, account, profile }) {
      // 1. Bloqueio de login por Credentials sem e-mail verificado
      // Remova as duas barras abaixo se quiser obrigar verificação de e-mail antes do login
      /*
      if (account?.provider === "credentials") {
        const dbUser = await prisma.user.findUnique({ where: { email: user.email! } });
        if (!dbUser?.emailVerified) return false; // Barra o login
      }
      */

      // 2. Proteção de Account Linking (Google vs Credentials)
      if (account?.provider === "google") {
        const existingUser = await prisma.user.findUnique({
          where: { email: user.email! },
          include: { accounts: true }
        });

        if (existingUser) {
          const hasGoogleLinked = existingUser.accounts.some((acc: any) => acc.provider === "google");
          
          // Se o e-mail já existe via senha, mas não está vinculado ao Google:
          if (!hasGoogleLinked) {
            // SÓ permite o link automático se o e-mail da conta Credentials já foi VERIFICADO
            if (!existingUser.emailVerified) {
              // Redireciona para erro explicando que ele deve verificar o e-mail ou logar com senha primeiro
              return "/auth/error?error=EmailNotVerified"; 
            }
          }
        }
      }
      return true;
    },

    // ✅ TÓPICO B: INJEÇÃO DO USER ID NO JWT
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
      }
      // Permite atualizar a sessão em tempo real se necessário
      if (trigger === "update" && session) {
        return { ...token, ...session.user };
      }
      return token;
    },

    // ✅ TÓPICO B: DISPONIBILIZAR ID NO CLIENTE (session.user.id)
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },

  secret: process.env.AUTH_SECRET,
  
  pages: {
    signIn: "/signin",
    error: "/auth/error", // Rota para onde os erros de signIn (como o acima) serão enviados
  },

  // Importante: No Next.js App Router (Vercel), NextAuth v5 roda melhor com runtime Node.js
  // Não é necessário configurar nada aqui, apenas evitar 'export const runtime = "edge"' nas rotas de API do auth.
});

// Tipagem para o TypeScript não reclamar do session.user.id
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    }
  }
}