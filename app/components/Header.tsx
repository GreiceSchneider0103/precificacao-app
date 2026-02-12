"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";

const nav = [
  { href: "/minha-conta", label: "Minha Conta" },
  { href: "/configuracoes", label: "Configurações" },
  { href: "/produtos", label: "Produtos" },
  { href: "/precificacao", label: "Precificação" },
  { href: "/promocoes", label: "Promoções" },
  { href: "/historico", label: "Histórico" },
  
];

type Props = {
  isLoggedIn: boolean;
  userName?: string | null;
};

export function Header({ isLoggedIn, userName }: Props) {
  return (
    <header className="flex items-center justify-between">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl theme-logo grid place-items-center">
          <span className="text-sm font-semibold">M</span>
        </div>
        <div>
          <p className="text-xs font-medium tracking-[0.22em] theme-muted">
            MARKUP
          </p>
          <p className="text-sm theme-muted2">
            Precificação inteligente para marketplaces
          </p>
        </div>
      </Link>

      {/* Nav */}
      {isLoggedIn && (
        <nav className="flex items-center gap-2">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-xl px-4 py-2 text-sm font-semibold transition theme-nav-link"
            >
              {item.label}
            </Link>
          ))}

          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="rounded-xl px-3 py-2 text-xs font-semibold transition theme-signout"
          >
            Sair{userName ? ` (${userName.split(" ")[0]})` : ""}
          </button>
        </nav>
      )}
    </header>
  );
}
