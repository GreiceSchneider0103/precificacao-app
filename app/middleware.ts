// middleware.ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";

// 1. Caminhos que exigem login (UI)
const PROTECTED_UI_PATHS = [
  "/configuracoes",
  "/precificacao",
  "/produtos",
  "/minha-conta",
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
  const pathname = nextUrl.pathname;

  // --- A. PROTEÇÃO DE API (Tópico C) ---
  // Bloqueia qualquer chamada para /api/* que não seja autenticação
  const isApiRoute = pathname.startsWith("/api");
  const isAuthApiRoute = pathname.startsWith("/api/auth");
  // O cron do Vercel não manda cookie de sessão — a rota se autentica sozinha via
  // Authorization: Bearer $CRON_SECRET (ver app/api/cron/tiny-sync/route.ts).
  const isCronApiRoute = pathname.startsWith("/api/cron");

  if (isApiRoute && !isAuthApiRoute && !isCronApiRoute && !isLoggedIn) {
    return NextResponse.json(
      { error: "Não autorizado: Sessão inválida ou expirada" },
      { status: 401 }
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