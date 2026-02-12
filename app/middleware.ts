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
    const url = new URL("/", nextUrl.origin);
    url.searchParams.set("next", pathname);
    return Response.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};
