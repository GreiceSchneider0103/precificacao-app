import type { Metadata } from "next";
import { Source_Serif_4, Work_Sans } from "next/font/google";
import "./globals.css";
import { auth } from "@/auth";
import { Header } from "@/app/components/Header";

const sourceSerif = Source_Serif_4({
  variable: "--font-serif",
  subsets: ["latin"],
});

const workSans = Work_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Markup - Precificação Inteligente",
  description: "Sistema de precificação para marketplaces",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
  <html lang="pt-BR">
    <body
      className={`${sourceSerif.variable} ${workSans.variable} antialiased min-h-screen`}
      style={{ background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-sans), system-ui, sans-serif" }}
    >
      {/* Header com container e espaçamento */}
      {session?.user?.approved && (
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <Header isLoggedIn={true} userName={session.user.name} role={session.user.role} />
        </div>
      )}

      {/* Conteúdo com o mesmo container */}
      <main className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
    </body>
  </html>
);
}