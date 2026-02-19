"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function Header({ isLoggedIn, userName }: { isLoggedIn: boolean; userName?: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const links = [
    { name: "Precificação", href: "/precificacao" },
    { name: "Produtos", href: "/produtos" },
    { name: "Promoções", href: "/promocoes" },
    { name: "Configurações", href: "/configuracoes" },
  ];

  if (!isLoggedIn) return null;

  return (
    <header className="rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md px-4 py-3 relative z-50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 bg-emerald-500 rounded-lg flex items-center justify-center font-bold text-black">M</div>
          <span className="font-semibold hidden sm:inline">Markup</span>
        </div>

        {/* Menu Desktop */}
        <nav className="hidden md:flex gap-4">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className={`text-sm ${pathname === link.href ? 'text-white' : 'text-white/60 hover:text-white'}`}>
              {link.name}
            </Link>
          ))}
        </nav>

        {/* Botão Hambúrguer Mobile */}
        <button onClick={() => setIsOpen(!isOpen)} className="md:hidden p-2 text-white/60">
          {isOpen ? "✕" : "☰"}
        </button>
      </div>

      {/* Dropdown Mobile */}
      {isOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 mt-2 bg-neutral-900 border border-white/10 rounded-xl p-4 flex flex-col gap-4 shadow-xl">
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setIsOpen(false)} className="text-base font-medium">
              {link.name}
            </Link>
          ))}
          <hr className="border-white/10" />
          <div className="text-xs text-white/40">Logado como: {userName}</div>
        </div>
      )}
    </header>
  );
}