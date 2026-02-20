// lib/utils.ts

export function cn(...classes: (string | boolean | undefined | null | Record<string, boolean>)[]): string {
  return classes
    .filter(Boolean)
    .map(c => {
      if (typeof c === "string") return c;
      if (c && typeof c === "object") {
        return Object.entries(c).filter(([, value]) => Boolean(value)).map(([key]) => key).join(" ");
      }
      return "";
    })
    .join(" ")
    .trim();
}

export function formatCurrency(value: number, options: { hideSymbol?: boolean; decimals?: number } = {}): string {
  const { hideSymbol = false, decimals = 2 } = options;
  const formatted = value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return hideSymbol ? formatted : `R$ ${formatted}`;
}

export function formatPercent(value: number, options: { decimals?: number } = {}): string {
  const { decimals = 2 } = options;
  return value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + "%";
}

// ✅ FIX: substituído `any` por constraint genérica adequada
export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

export function throttle<T extends (...args: Parameters<T>) => ReturnType<T>>(func: T, limit: number): (...args: Parameters<T>) => void {
  let inThrottle = false;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => { inThrottle = false; }, limit);
    }
  };
}

export function normalizeSku(sku: string): string { return (sku || "").trim().toUpperCase().replace(/\s+/g, ""); }
export function capitalize(text: string): string { return text.toLowerCase().split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "); }
export function truncate(text: string, length: number): string { return text.length <= length ? text : text.slice(0, length) + "..."; }
export function generateId(): string { return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15); }

export function formatDate(date: Date, options: { includeTime?: boolean; format?: "short" | "long" } = {}): string {
  const { includeTime = false, format = "short" } = options;
  const dateOptions: Intl.DateTimeFormatOptions = { day: "2-digit", month: format === "long" ? "long" : "2-digit", year: "numeric" };
  if (includeTime) { dateOptions.hour = "2-digit"; dateOptions.minute = "2-digit"; }
  return date.toLocaleDateString("pt-BR", dateOptions);
}

export function getRelativeTime(date: Date): string {
  const diffDays = Math.floor((new Date().getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "hoje"; if (diffDays === 1) return "ontem"; if (diffDays === -1) return "amanhã";
  return diffDays > 1 ? `há ${diffDays} dias` : `em ${Math.abs(diffDays)} dias`;
}

export function getDaysDiff(date1: Date, date2: Date): number { return Math.floor(Math.abs(date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24)); }
export function isValidEmail(email: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

export function maskPhone(phone: string): string {
  const c = phone.replace(/\D/g, "");
  if (c.length === 11) return `(${c.slice(0, 2)}) ${c.slice(2, 7)}-${c.slice(7)}`;
  if (c.length === 10) return `(${c.slice(0, 2)}) ${c.slice(2, 6)}-${c.slice(6)}`;
  return phone;
}

export function unmaskPhone(phone: string): string { return phone.replace(/\D/g, ""); }

export async function copyToClipboard(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta); return ok;
  }
}

export function downloadFile(data: string | Blob, filename: string, type = "text/plain"): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click();
  document.body.removeChild(link); URL.revokeObjectURL(url);
}

export function sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function retry<T>(fn: () => Promise<T>, options: { maxAttempts?: number; delay?: number } = {}): Promise<T> {
  const { maxAttempts = 3, delay = 1000 } = options;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try { return await fn(); }
    catch (error) { if (attempt === maxAttempts) throw error; await sleep(delay * Math.pow(2, attempt - 1)); }
  }
  throw new Error("Retry failed");
}

export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((result, item) => {
    const group = String(item[key]);
    (result[group] = result[group] || []).push(item);
    return result;
  }, {} as Record<string, T[]>);
}

export function unique<T>(array: T[], key?: keyof T): T[] {
  if (!key) return [...new Set(array)];
  const seen = new Set<unknown>();
  return array.filter(item => { const v = item[key]; if (seen.has(v)) return false; seen.add(v); return true; });
}

export function sortBy<T>(array: T[], key: keyof T, order: "asc" | "desc" = "asc"): T[] {
  return [...array].sort((a, b) => {
    const va = a[key], vb = b[key];
    if (va < vb) return order === "asc" ? -1 : 1;
    if (va > vb) return order === "asc" ? 1 : -1;
    return 0;
  });
}
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export async function getSessionOrThrow() {
  const session = await auth();
  if (!session?.user?.id) {
    throw NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  return session;
}