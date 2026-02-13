// auth.ts (RAIZ DO PROJETO)
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
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
  callbacks: {
  async jwt({ token, user }) {
    // Só guarda o mínimo
    if (user) {
      token.id = (user as any).id;
      token.name = user.name;
      token.email = user.email;
    }
    return token;
  },
  async session({ session, token }) {
    // Passa só o id pro client
    (session.user as any).id = token.id as string;
    return session;
    },
  },
  debug: process.env.NODE_ENV === "development",
});