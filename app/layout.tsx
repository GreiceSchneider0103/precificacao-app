import "./globals.css";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { Header } from "./components/Header";

export const metadata: Metadata = {
  title: "Markup",
  description: "Precificação Inteligente para Marketplaces.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const isLoggedIn = !!session?.user;

  const userName =
    (session?.user as { name?: string | null } | undefined)?.name ?? undefined;

  return (
    <html lang="pt-BR" className="dark" data-theme="dark">
      <body className="min-h-screen">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <Header isLoggedIn={isLoggedIn} userName={userName} />
          <main className="mt-8">{children}</main>
          <footer className="mt-10 border-t theme-footer pt-6 text-xs">
            Markup
          </footer>
        </div>
      </body>
    </html>
  );
}
