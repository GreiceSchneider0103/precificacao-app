import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { auth } from "@/auth";
import { Header } from "@/app/components/Header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
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
      className={`${geistSans.variable} ${geistMono.variable} antialiased bg-neutral-950 text-white min-h-screen`}
    >
      {/* ✅ HEADER com container e espaçamento */}
      {session?.user && (
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <Header isLoggedIn={true} userName={session.user.name} />
        </div>
      )}

      {/* ✅ CONTEÚDO com o mesmo container */}
      <main className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
    </body>
  </html>
);
}