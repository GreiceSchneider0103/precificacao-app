// lib/utils.ts

/**
 * Utilitários gerais da aplicação
 */

/**
 * Combina classes CSS condicionalmente
 * 
 * @param classes - Array de classes ou objetos condicionais
 * @returns String com classes combinadas
 * 
 * @example
 * ```ts
 * cn('btn', isActive && 'active', { 'disabled': !enabled })
 * // 'btn active' (se isActive e enabled)
 * ```
 */
export function cn(...classes: (string | boolean | undefined | null | Record<string, boolean>)[]): string {
  return classes
    .filter(Boolean)
    .map(c => {
      if (typeof c === 'string') return c;
      if (c && typeof c === "object") {
  return Object.entries(c)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key)
    .join(" ");
}
return "";

    })
    .join(' ')
    .trim();
}

/**
 * Formata um número como moeda brasileira
 * 
 * @param value - Valor numérico
 * @param options - Opções de formatação
 * @returns String formatada como R$ X.XXX,XX
 * 
 * @example
 * ```ts
 * formatCurrency(1234.56) // 'R$ 1.234,56'
 * formatCurrency(1234.56, { hideSymbol: true }) // '1.234,56'
 * ```
 */
export function formatCurrency(
  value: number,
  options: { hideSymbol?: boolean; decimals?: number } = {}
): string {
  const { hideSymbol = false, decimals = 2 } = options;
  
  const formatted = value.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  
  return hideSymbol ? formatted : `R$ ${formatted}`;
}

/**
 * Formata um número como percentual
 * 
 * @param value - Valor numérico (0-100)
 * @param options - Opções de formatação
 * @returns String formatada como X,XX%
 * 
 * @example
 * ```ts
 * formatPercent(25.5) // '25,50%'
 * formatPercent(25.5, { decimals: 0 }) // '26%'
 * ```
 */
export function formatPercent(
  value: number,
  options: { decimals?: number } = {}
): string {
  const { decimals = 2 } = options;
  
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + '%';
}

/**
 * Debounce de função - executa apenas após delay sem novas chamadas
 * 
 * @param func - Função a ser executada
 * @param delay - Delay em milliseconds
 * @returns Função debounced
 * 
 * @example
 * ```ts
 * const search = debounce((query) => api.search(query), 300);
 * search('text'); // Só executa se não houver nova chamada em 300ms
 * ```
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}

/**
 * Throttle de função - executa no máximo uma vez por intervalo
 * 
 * @param func - Função a ser executada
 * @param limit - Intervalo mínimo entre execuções em ms
 * @returns Função throttled
 * 
 * @example
 * ```ts
 * const handleScroll = throttle(() => checkPosition(), 100);
 * window.addEventListener('scroll', handleScroll);
 * ```
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Normaliza SKU para formato padrão
 * 
 * @param sku - SKU a ser normalizado
 * @returns SKU em maiúsculas sem espaços
 * 
 * @example
 * ```ts
 * normalizeSku('prod 001') // 'PROD001'
 * ```
 */
export function normalizeSku(sku: string): string {
  return (sku || '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Capitaliza primeira letra de cada palavra
 * 
 * @param text - Texto a ser capitalizado
 * @returns Texto capitalizado
 * 
 * @example
 * ```ts
 * capitalize('joão silva') // 'João Silva'
 * ```
 */
export function capitalize(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Trunca texto com ellipsis
 * 
 * @param text - Texto a ser truncado
 * @param length - Comprimento máximo
 * @returns Texto truncado
 * 
 * @example
 * ```ts
 * truncate('Texto muito longo aqui', 10) // 'Texto muit...'
 * ```
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + '...';
}

/**
 * Gera ID único
 * 
 * @returns String única
 * 
 * @example
 * ```ts
 * generateId() // 'abc123def456'
 * ```
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) +
         Math.random().toString(36).substring(2, 15);
}

/**
 * Formata data para formato brasileiro
 * 
 * @param date - Data a ser formatada
 * @param options - Opções de formatação
 * @returns Data formatada
 * 
 * @example
 * ```ts
 * formatDate(new Date()) // '16/02/2026'
 * formatDate(new Date(), { includeTime: true }) // '16/02/2026 14:30'
 * ```
 */
export function formatDate(
  date: Date,
  options: { includeTime?: boolean; format?: 'short' | 'long' } = {}
): string {
  const { includeTime = false, format = 'short' } = options;
  
  const dateOptions: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: format === 'long' ? 'long' : '2-digit',
    year: 'numeric',
  };
  
  if (includeTime) {
    dateOptions.hour = '2-digit';
    dateOptions.minute = '2-digit';
  }
  
  return date.toLocaleDateString('pt-BR', dateOptions);
}

/**
 * Converte data relativa para texto
 * 
 * @param date - Data para comparar
 * @returns Texto descritivo ('há 2 dias', 'amanhã', etc)
 * 
 * @example
 * ```ts
 * getRelativeTime(new Date(Date.now() - 86400000)) // 'há 1 dia'
 * ```
 */
export function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'hoje';
  if (diffDays === 1) return 'ontem';
  if (diffDays === -1) return 'amanhã';
  if (diffDays > 1) return `há ${diffDays} dias`;
  return `em ${Math.abs(diffDays)} dias`;
}

/**
 * Calcula diferença entre duas datas
 * 
 * @param date1 - Primeira data
 * @param date2 - Segunda data
 * @returns Número de dias de diferença
 * 
 * @example
 * ```ts
 * getDaysDiff(new Date('2026-01-01'), new Date('2026-01-10')) // 9
 * ```
 */
export function getDaysDiff(date1: Date, date2: Date): number {
  const diffMs = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Valida se string é um email válido
 * 
 * @param email - Email a ser validado
 * @returns true se válido
 * 
 * @example
 * ```ts
 * isValidEmail('test@example.com') // true
 * isValidEmail('invalid') // false
 * ```
 */
export function isValidEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

/**
 * Mascara telefone brasileiro
 * 
 * @param phone - Telefone a ser mascarado
 * @returns Telefone formatado
 * 
 * @example
 * ```ts
 * maskPhone('11999999999') // '(11) 99999-9999'
 * ```
 */
export function maskPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.length === 11) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 7)}-${cleaned.slice(7)}`;
  }
  
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 2)}) ${cleaned.slice(2, 6)}-${cleaned.slice(6)}`;
  }
  
  return phone;
}

/**
 * Remove máscara de telefone
 * 
 * @param phone - Telefone mascarado
 * @returns Apenas números
 * 
 * @example
 * ```ts
 * unmaskPhone('(11) 99999-9999') // '11999999999'
 * ```
 */
export function unmaskPhone(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Copia texto para clipboard
 * 
 * @param text - Texto a ser copiado
 * @returns Promise<boolean> indicando sucesso
 * 
 * @example
 * ```ts
 * await copyToClipboard('Texto copiado');
 * ```
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback para navegadores antigos
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const success = document.execCommand('copy');
    document.body.removeChild(textarea);
    return success;
  }
}

/**
 * Download de arquivo
 * 
 * @param data - Dados do arquivo
 * @param filename - Nome do arquivo
 * @param type - Tipo MIME
 * 
 * @example
 * ```ts
 * downloadFile('dados', 'export.txt', 'text/plain');
 * ```
 */
export function downloadFile(
  data: string | Blob,
  filename: string,
  type: string = 'text/plain'
): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Sleep/delay assíncrono
 * 
 * @param ms - Milliseconds para aguardar
 * @returns Promise que resolve após delay
 * 
 * @example
 * ```ts
 * await sleep(1000); // Aguarda 1 segundo
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry de função com backoff exponencial
 * 
 * @param fn - Função a ser executada
 * @param options - Opções de retry
 * @returns Resultado da função
 * 
 * @example
 * ```ts
 * const data = await retry(() => api.fetch(), { maxAttempts: 3 });
 * ```
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; delay?: number } = {}
): Promise<T> {
  const { maxAttempts = 3, delay = 1000 } = options;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await sleep(delay * Math.pow(2, attempt - 1));
    }
  }
  
  throw new Error('Retry failed');
}

/**
 * Agrupa array de objetos por chave
 * 
 * @param array - Array a ser agrupado
 * @param key - Chave para agrupamento
 * @returns Objeto agrupado
 * 
 * @example
 * ```ts
 * const products = [
 *   { channel: 'shopee', price: 100 },
 *   { channel: 'shopee', price: 150 },
 *   { channel: 'meli', price: 200 }
 * ];
 * groupBy(products, 'channel');
 * // { shopee: [...], meli: [...] }
 * ```
 */
export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce((result, item) => {
    const group = String(item[key]);
    (result[group] = result[group] || []).push(item);
    return result;
  }, {} as Record<string, T[]>);
}

/**
 * Remove duplicatas de array
 * 
 * @param array - Array com possíveis duplicatas
 * @param key - Chave para comparação (opcional, para objetos)
 * @returns Array sem duplicatas
 * 
 * @example
 * ```ts
 * unique([1, 2, 2, 3]) // [1, 2, 3]
 * unique([{id: 1}, {id: 1}, {id: 2}], 'id') // [{id: 1}, {id: 2}]
 * ```
 */
export function unique<T>(array: T[], key?: keyof T): T[] {
  if (!key) return [...new Set(array)];
  
  const seen = new Set();
  return array.filter(item => {
    const value = item[key];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/**
 * Ordena array de objetos
 * 
 * @param array - Array a ser ordenado
 * @param key - Chave para ordenação
 * @param order - Ordem (asc ou desc)
 * @returns Array ordenado
 * 
 * @example
 * ```ts
 * sortBy(products, 'price', 'desc')
 * ```
 */
export function sortBy<T>(
  array: T[],
  key: keyof T,
  order: 'asc' | 'desc' = 'asc'
): T[] {
  return [...array].sort((a, b) => {
    const valueA = a[key];
    const valueB = b[key];
    
    if (valueA < valueB) return order === 'asc' ? -1 : 1;
    if (valueA > valueB) return order === 'asc' ? 1 : -1;
    return 0;
  });
}
// lib/db/utils.ts
import { auth } from "@/auth";

export async function getSessionOrThrow() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }
  return session;
}