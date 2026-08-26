"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { SignOutButton } from "@/app/components/AuthClientButtons";

export function Header({
  isLoggedIn,
  userName,
}: {
  isLoggedIn: boolean;
  userName?: string | null;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const links = [
    { name: "Produtos", href: "/produtos" },
    { name: "Precificação", href: "/precificacao" },
    { name: "Configurações", href: "/configuracoes" },
  ];

  if (!isLoggedIn) return null;

  return (
    <header className="relative z-50 flex items-center justify-between border-b px-1 pb-4" style={{ borderColor: "var(--border)" }}>
      {/* Logo + nav desktop */}
      <div className="flex items-center gap-9">
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md text-[13px] font-semibold"
            style={{ background: "var(--accent)", color: "var(--accent-ink)", fontFamily: "var(--font-serif), serif" }}
          >
            M
          </div>
          <span className="hidden text-[15px] font-semibold sm:inline" style={{ fontFamily: "var(--font-serif), serif" }}>
            Markup
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-7">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="flex items-center gap-1.5 pb-[18px] -mb-[18px] text-[13.5px] transition-colors"
                style={
                  active
                    ? { color: "var(--text)", fontWeight: 600, borderBottom: "2px solid var(--accent)" }
                    : { color: "var(--muted)", fontWeight: 500, borderBottom: "2px solid transparent" }
                }
              >
                {link.name}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Lado direito desktop: Minha conta + Sair */}
      <div className="hidden md:flex items-center gap-3">
        <Link
          href="/minha-conta"
          className="text-[13.5px] rounded-full px-3.5 py-1.5"
          style={
            pathname === "/minha-conta"
              ? { color: "var(--text)", fontWeight: 600, background: "var(--surface-soft)" }
              : { color: "var(--muted)", fontWeight: 500 }
          }
        >
          Minha conta
        </Link>
        <SignOutButton />
      </div>

      {/* Botão hambúrguer mobile */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden rounded-md p-2"
        style={{ color: "var(--muted)" }}
        aria-label="Menu"
      >
        {isOpen ? "✕" : "☰"}
      </button>

      {/* Dropdown mobile */}
      {isOpen && (
        <div
          className="md:hidden absolute top-full left-0 right-0 mt-2 flex flex-col gap-4 rounded-xl border p-4 shadow-lg z-50"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setIsOpen(false)}
              className="text-base"
              style={pathname === link.href ? { color: "var(--text)", fontWeight: 600 } : { color: "var(--muted)", fontWeight: 500 }}
            >
              {link.name}
            </Link>
          ))}

          <hr style={{ borderColor: "var(--border)" }} />

          <Link
            href="/minha-conta"
            onClick={() => setIsOpen(false)}
            className="text-base font-medium"
            style={{ color: "var(--muted)" }}
          >
            Minha conta
          </Link>

          <div className="text-xs" style={{ color: "var(--muted)" }}>
            Logado como: {userName}
          </div>

          <SignOutButton />
        </div>
      )}
    </header>
  );
}
