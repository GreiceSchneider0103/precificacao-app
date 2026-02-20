// lib/sync-utils.ts
// Utilitários para sincronizar dados entre localStorage e banco de dados

export type SyncStatus = { isSyncing: boolean; lastSync: Date | null; error: string | null };

type JsonObject = Record<string, unknown>;

// ==================== SETTINGS ====================

export async function saveSettings(activeRuleId: string, ruleSets: JsonObject[]) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeRuleId, ruleSets }),
  });
  if (!response.ok) throw new Error("Erro ao salvar configurações");
  return await response.json() as JsonObject;
}

export async function loadSettings(): Promise<JsonObject | null> {
  try {
    const response = await fetch("/api/settings");
    if (!response.ok) throw new Error("Erro ao carregar configurações");
    return await response.json() as JsonObject;
  } catch { return null; }
}

// ==================== PRODUCTS ====================

export async function saveProducts(products: JsonObject[]) {
  const response = await fetch("/api/products-db", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ products }),
  });
  if (!response.ok) throw new Error("Erro ao salvar produtos");
  return await response.json() as JsonObject;
}

export async function loadProducts(): Promise<JsonObject[]> {
  try {
    const response = await fetch("/api/products-db");
    if (!response.ok) throw new Error("Erro ao carregar produtos");
    return await response.json() as JsonObject[];
  } catch { return []; }
}

export async function deleteProduct(sku: string) {
  const response = await fetch(`/api/products-db?sku=${encodeURIComponent(sku)}`, { method: "DELETE" });
  if (!response.ok) throw new Error("Erro ao deletar produto");
  return await response.json() as JsonObject;
}

// ==================== PROMOTIONS ====================

export async function savePromotions(promotions: JsonObject[]) {
  const response = await fetch("/api/promotions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ promotions }),
  });
  if (!response.ok) throw new Error("Erro ao salvar promoções");
  return await response.json() as JsonObject;
}

export async function loadPromotions(activeOnly = false): Promise<JsonObject[]> {
  try {
    const url = activeOnly ? "/api/promotions?active=true" : "/api/promotions";
    const response = await fetch(url);
    if (!response.ok) throw new Error("Erro ao carregar promoções");
    return await response.json() as JsonObject[];
  } catch { return []; }
}

export async function clearPromotions() {
  const response = await fetch("/api/promotions", { method: "DELETE" });
  if (!response.ok) throw new Error("Erro ao limpar promoções");
  return await response.json() as JsonObject;
}

// ==================== HISTORY ====================

export async function saveHistory(entries: JsonObject[]) {
  const response = await fetch("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
  if (!response.ok) throw new Error("Erro ao salvar histórico");
  return await response.json() as JsonObject;
}

export async function loadHistory(limit = 100, channel?: string): Promise<JsonObject[]> {
  try {
    let url = `/api/history?limit=${limit}`;
    if (channel) url += `&channel=${encodeURIComponent(channel)}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Erro ao carregar histórico");
    return await response.json() as JsonObject[];
  } catch { return []; }
}

export async function clearHistory() {
  const response = await fetch("/api/history", { method: "DELETE" });
  if (!response.ok) throw new Error("Erro ao limpar histórico");
  return await response.json() as JsonObject;
}
