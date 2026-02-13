// middleware.ts
import { auth } from "@/auth";
import { NextResponse } from "next/server";

const PROTECTED_PREFIXES = [
  "/configuracoes",
  "/precificacao",
  "/historico",
  "/produtos",
  "/minha-conta",
  "/promocoes",
];

// ⭐ Cookies antigos para deletar (temporário - remove após 1 semana)
const LEGACY_COOKIES = [
  '__Secure-authjs.session-token',
  '__Secure-authjs.session-token.0',
  '__Secure-authjs.session-token.1',
  '__Secure-authjs.session-token.2',
  '__Secure-authjs.session-token.3',
  '__Secure-authjs.callback-url',
  'authjs.session-token',
  'authjs.callback-url',
];

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  // Cria response (pode ser redirect ou next)
  let response: NextResponse | Response | undefined;

  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (needsAuth && !req.auth) {
    // evita loop: se já está na home, não redireciona
    if (pathname === "/") return;

    const url = new URL("/", nextUrl.origin);
    url.searchParams.set("next", pathname);
    response = Response.redirect(url);
  } else {
    response = NextResponse.next();
  }

  // ⭐ LIMPEZA DE COOKIES ANTIGOS (previne erro 494)
  // Remove após 2025-02-20 quando todos usuários tiverem cookies limpos
  LEGACY_COOKIES.forEach(cookieName => {
    if (req.cookies.has(cookieName)) {
      // Converte Response para NextResponse se necessário
      if (!(response instanceof NextResponse)) {
        response = NextResponse.redirect(response!.url);
      }
      
      (response as NextResponse).cookies.delete(cookieName);
      (response as NextResponse).cookies.set(cookieName, '', {
        expires: new Date(0),
        path: '/',
        maxAge: -1,
      });
    }
  });

  return response;
});

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};