// middleware.ts
import { auth } from "@/auth";

const PROTECTED_PREFIXES = [
  "/configuracoes",
  "/precificacao",
  "/historico",
  "/produtos",
  "/minha-conta",
  "/promocoes",
];

export default auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  const needsAuth = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  if (!needsAuth) return;

  if (!req.auth) {
    // evita loop: se já está na home, não redireciona
    if (pathname === "/") return;

    const url = new URL("/", nextUrl.origin);

    // evita "next" crescer infinitamente
    url.searchParams.set("next", pathname);

    return Response.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};