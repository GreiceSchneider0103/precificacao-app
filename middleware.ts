// middleware.ts
//
// IMPORTANTE: este arquivo precisa estar na RAIZ do projeto (não dentro de app/) para o
// Next.js reconhecê-lo — ele ficou por muito tempo em app/middleware.ts, onde nunca foi
// executado (nenhuma proteção abaixo estava de fato ativa). As páginas e rotas de API que
// já faziam sua própria checagem de sessão (auth() dentro de cada uma) continuaram
// seguras, mas Precificação e Configurações (client components sem checagem própria)
// dependiam só deste middleware, que estava inerte.
//
// Usa uma instância própria e "leve" do NextAuth (auth.config.ts, sem Prisma/bcrypt),
// não o `auth` de auth.ts — o middleware roda no Edge Runtime do Vercel, e importar
// auth.ts inteiro (PrismaAdapter + bcrypt) estourou o limite de 1MB do Edge Function do
// plano, derrubando o deploy.
import NextAuth from "next-auth";
import authConfig from "./auth.config";
import { NextResponse } from "next/server";

const { auth } = NextAuth(authConfig);

// 1. Caminhos que exigem login (UI)
const PROTECTED_UI_PATHS = [
  "/configuracoes",
  "/precificacao",
  "/produtos",
  "/minha-conta",
  "/usuarios",
];

// 2. Cookies legados para limpeza (evita erro "494 Request Header Too Large")
const LEGACY_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'authjs.callback-url',
  '__Secure-authjs.callback-url',
];

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const isApproved = Boolean(req.auth?.user?.approved);
  const pathname = nextUrl.pathname;

  // --- A. PROTEÇÃO DE API (Tópico C) ---
  // Bloqueia qualquer chamada para /api/* que não seja autenticação
  const isApiRoute = pathname.startsWith("/api");
  const isAuthApiRoute = pathname.startsWith("/api/auth");
  // O cron do Vercel não manda cookie de sessão — a rota se autentica sozinha via
  // Authorization: Bearer $CRON_SECRET (ver app/api/cron/tiny-sync/route.ts).
  const isCronApiRoute = pathname.startsWith("/api/cron");
  // /api/register é chamado por quem ainda não tem conta — precisa funcionar deslogado.
  const isRegisterApiRoute = pathname === "/api/register";

  if (isApiRoute && !isAuthApiRoute && !isCronApiRoute && !isRegisterApiRoute && !isLoggedIn) {
    return NextResponse.json(
      { error: "Não autorizado: Sessão inválida ou expirada" },
      { status: 401 }
    );
  }

  // Conta logada mas ainda não aprovada por um usuário master: sem acesso a nenhum dado
  // de negócio via API (só /api/user/* — perfil/senha — e as exceções acima).
  const isSelfAccountApiRoute = pathname.startsWith("/api/user");
  if (isApiRoute && !isAuthApiRoute && !isCronApiRoute && !isRegisterApiRoute && !isSelfAccountApiRoute && isLoggedIn && !isApproved) {
    return NextResponse.json(
      { error: "Sua conta ainda não foi aprovada por um administrador." },
      { status: 403 }
    );
  }

  // --- B. PROTEÇÃO DE UI ---
  const isProtectedUI = PROTECTED_UI_PATHS.some(path =>
    pathname === path || pathname.startsWith(path + "/")
  );

  if (isProtectedUI && !isLoggedIn) {
    // Redireciona para a home (/) salvando a página que tentou acessar
    const loginUrl = new URL("/", nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isProtectedUI && isLoggedIn && !isApproved) {
    return NextResponse.redirect(new URL("/pendente", nextUrl.origin));
  }

  // --- C. LIMPEZA DE COOKIES E CONTINUAÇÃO ---
  const response = NextResponse.next();

  // Limpa cookies antigos se existirem (previne erros de cabeçalho grande na Vercel)
  for (const cookieName of LEGACY_COOKIES) {
    if (req.cookies.has(cookieName)) {
      response.cookies.delete(cookieName);
      // Força expiração imediata em todos os caminhos
      response.cookies.set(cookieName, "", { path: "/", maxAge: -1 });
    }
  }

  return response;
});

// Matcher otimizado: ignora arquivos estáticos, imagens e favicon
export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};