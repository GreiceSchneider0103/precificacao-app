import {
  extractCostFromTinyProduto,
  tinySearchProdutoBySku,
  tinyObterProduto,
  fetchTinyCostBySku,
  runTinySyncBatch,
} from "@/lib/tiny";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    markupRuleset: { findUnique: jest.fn(), update: jest.fn() },
    product: { count: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require("@/lib/prisma") as {
  prisma: {
    markupRuleset: { findUnique: jest.Mock; update: jest.Mock };
    product: { count: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  };
};

function mockFetchOnce(body: unknown, ok = true) {
  (global.fetch as jest.Mock).mockResolvedValueOnce({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });
}

beforeEach(() => {
  global.fetch = jest.fn();
  jest.clearAllMocks();
});

describe("extractCostFromTinyProduto", () => {
  it("extrai um preco_custo numérico", () => {
    expect(extractCostFromTinyProduto({ preco_custo: 42.5 })).toBe(42.5);
  });

  it("extrai um preco_custo em string com vírgula decimal", () => {
    expect(extractCostFromTinyProduto({ preco_custo: "42,50" })).toBe(42.5);
  });

  it("extrai um preco_custo em string com ponto decimal", () => {
    expect(extractCostFromTinyProduto({ preco_custo: "42.50" })).toBe(42.5);
  });

  it("retorna null quando preco_custo está ausente", () => {
    expect(extractCostFromTinyProduto({})).toBeNull();
    expect(extractCostFromTinyProduto(undefined)).toBeNull();
    expect(extractCostFromTinyProduto(null)).toBeNull();
  });

  it("retorna null para valor não numérico", () => {
    expect(extractCostFromTinyProduto({ preco_custo: "abc" })).toBeNull();
  });

  it("prioriza preco_custo_medio (Custo médio) sobre preco_custo quando ambos existem", () => {
    expect(extractCostFromTinyProduto({ preco_custo: 10, preco_custo_medio: 822.99 })).toBe(822.99);
  });

  it("cai para preco_custo quando preco_custo_medio está ausente ou zerado", () => {
    expect(extractCostFromTinyProduto({ preco_custo: 15.5, preco_custo_medio: 0 })).toBe(15.5);
    expect(extractCostFromTinyProduto({ preco_custo: 15.5 })).toBe(15.5);
  });
});

describe("tinySearchProdutoBySku", () => {
  it("encontra o produto cujo código bate exatamente (case-insensitive)", async () => {
    mockFetchOnce({
      retorno: {
        status: "OK",
        produtos: [
          { produto: { id: 111, codigo: "outro-sku" } },
          { produto: { id: 222, codigo: "abc-123" } },
        ],
      },
    });
    const result = await tinySearchProdutoBySku("token", "ABC-123");
    expect(result).toEqual({ id: "222" });
  });

  it("retorna null quando nenhum resultado bate exatamente", async () => {
    mockFetchOnce({
      retorno: { status: "OK", produtos: [{ produto: { id: 111, codigo: "outro-sku" } }] },
    });
    const result = await tinySearchProdutoBySku("token", "ABC-123");
    expect(result).toBeNull();
  });

  it("lança erro com o motivo do Tiny quando o status não é OK (ex: token inválido)", async () => {
    mockFetchOnce({ retorno: { status: "Erro", erros: [{ erro: "Token inválido" }] } });
    await expect(tinySearchProdutoBySku("token", "ABC-123")).rejects.toThrow("Token inválido");
  });

  it("lança erro genérico quando o status não é OK e o Tiny não detalha o motivo", async () => {
    mockFetchOnce({ retorno: { status: "Erro" } });
    await expect(tinySearchProdutoBySku("token", "ABC-123")).rejects.toThrow(/recusou a pesquisa/);
  });

  it("lança erro quando a resposta HTTP não é ok", async () => {
    mockFetchOnce({}, false);
    await expect(tinySearchProdutoBySku("token", "ABC-123")).rejects.toThrow();
  });
});

describe("tinyObterProduto", () => {
  it("retorna cmv e nome quando o Tiny responde OK", async () => {
    mockFetchOnce({ retorno: { status: "OK", produto: { preco_custo: "99,90", nome: "Produto X" } } });
    const result = await tinyObterProduto("token", "222");
    expect(result).toEqual({ cmv: 99.9, nome: "Produto X" });
  });

  it("retorna null quando o Tiny não retorna produto", async () => {
    mockFetchOnce({ retorno: { status: "OK" } });
    const result = await tinyObterProduto("token", "222");
    expect(result).toBeNull();
  });
});

describe("fetchTinyCostBySku", () => {
  it("retorna ok:true com o custo médio quando o SKU é encontrado", async () => {
    mockFetchOnce({ retorno: { status: "OK", produtos: [{ produto: { id: 222, codigo: "ABC-123" } }] } });
    mockFetchOnce({ retorno: { status: "OK", produto: { preco_custo_medio: 822.99, nome: "Produto X" } } });
    const result = await fetchTinyCostBySku("token", "ABC-123");
    expect(result).toEqual({ ok: true, cmv: 822.99, nome: "Produto X" });
  });

  it("retorna ok:false reason:not_found quando o SKU não existe no Tiny", async () => {
    mockFetchOnce({ retorno: { status: "OK", produtos: [] } });
    const result = await fetchTinyCostBySku("token", "ABC-123");
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("retorna ok:false reason:no_cost quando o SKU existe mas o Tiny não retorna custo", async () => {
    mockFetchOnce({ retorno: { status: "OK", produtos: [{ produto: { id: 222, codigo: "ABC-123" } }] } });
    mockFetchOnce({ retorno: { status: "OK", produto: { nome: "Produto X" } } });
    const result = await fetchTinyCostBySku("token", "ABC-123");
    expect(result).toEqual({ ok: false, reason: "no_cost" });
  });
});

describe("runTinySyncBatch", () => {
  it("processa tudo e marca done=true quando o orçamento de tempo é suficiente", async () => {
    prisma.markupRuleset.findUnique.mockResolvedValue({ id: "emp1", tinyApiToken: "tok" });
    prisma.product.count.mockResolvedValue(2);
    prisma.product.findMany.mockResolvedValue([
      { id: "p1", sku: "SKU1", name: "Produto 1", updatedAt: new Date(0) },
      { id: "p2", sku: "SKU2", name: "Produto 2", updatedAt: new Date(1) },
    ]);
    prisma.product.update.mockResolvedValue({});
    prisma.markupRuleset.update.mockResolvedValue({});

    // 2 produtos x (pesquisa + obter) = 4 chamadas fetch
    mockFetchOnce({ retorno: { status: "OK", produtos: [{ produto: { id: 1, codigo: "SKU1" } }] } });
    mockFetchOnce({ retorno: { status: "OK", produto: { preco_custo: 10, nome: "P1" } } });
    mockFetchOnce({ retorno: { status: "OK", produtos: [{ produto: { id: 2, codigo: "SKU2" } }] } });
    mockFetchOnce({ retorno: { status: "OK", produto: { preco_custo: 20, nome: "P2" } } });

    const result = await runTinySyncBatch("emp1", { budgetMs: 5000 });

    expect(result.processed).toBe(2);
    expect(result.total).toBe(2);
    expect(result.updated).toBe(2);
    expect(result.errors).toHaveLength(0);
    expect(result.done).toBe(true);
    expect(prisma.product.update).toHaveBeenCalledTimes(2);
    expect(prisma.markupRuleset.update).toHaveBeenCalledWith({
      where: { id: "emp1" },
      data: { tinyLastSyncAt: expect.any(Date) },
    });
  }, 10000);

  it("interrompe antes de terminar quando o orçamento de tempo estoura, sem marcar done", async () => {
    prisma.markupRuleset.findUnique.mockResolvedValue({ id: "emp1", tinyApiToken: "tok" });
    prisma.product.count.mockResolvedValue(3);
    prisma.product.findMany.mockResolvedValue([
      { id: "p1", sku: "SKU1", name: "Produto 1", updatedAt: new Date(0) },
      { id: "p2", sku: "SKU2", name: "Produto 2", updatedAt: new Date(1) },
      { id: "p3", sku: "SKU3", name: "Produto 3", updatedAt: new Date(2) },
    ]);
    prisma.product.update.mockResolvedValue({});

    // Orçamento de 0ms: processa no máximo o 1º item antes de estourar o relógio.
    const result = await runTinySyncBatch("emp1", { budgetMs: 0 });

    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(result.processed).toBeLessThan(3);
    expect(result.total).toBe(3);
    expect(result.done).toBe(false);
    expect(prisma.markupRuleset.update).not.toHaveBeenCalled();
  });

  it("lança erro quando a empresa não tem token do Tiny configurado", async () => {
    prisma.markupRuleset.findUnique.mockResolvedValue({ id: "emp1", tinyApiToken: null });
    await expect(runTinySyncBatch("emp1", { budgetMs: 5000 })).rejects.toThrow(
      "Empresa sem token da API do Tiny configurado"
    );
  });

  it("acumula erro por SKU sem interromper os demais", async () => {
    prisma.markupRuleset.findUnique.mockResolvedValue({ id: "emp1", tinyApiToken: "tok" });
    prisma.product.count.mockResolvedValue(2);
    prisma.product.findMany.mockResolvedValue([
      { id: "p1", sku: "SKU1", name: "Produto 1", updatedAt: new Date(0) },
      { id: "p2", sku: "SKU2", name: "Produto 2", updatedAt: new Date(1) },
    ]);
    prisma.product.update.mockResolvedValue({});
    prisma.markupRuleset.update.mockResolvedValue({});

    mockFetchOnce({}, false); // 1º SKU falha na pesquisa
    mockFetchOnce({ retorno: { status: "OK", produtos: [{ produto: { id: 2, codigo: "SKU2" } }] } });
    mockFetchOnce({ retorno: { status: "OK", produto: { preco_custo: 20, nome: "P2" } } });

    const result = await runTinySyncBatch("emp1", { budgetMs: 5000 });

    expect(result.processed).toBe(2);
    expect(result.updated).toBe(1);
    expect(result.errors).toEqual([{ sku: "SKU1", message: expect.any(String) }]);
    expect(result.done).toBe(true);
  }, 10000);

  it("quando o Tiny não retorna custo (soft fail), não atualiza o CMV mas avança o updatedAt do SKU", async () => {
    prisma.markupRuleset.findUnique.mockResolvedValue({ id: "emp1", tinyApiToken: "tok" });
    prisma.product.count.mockResolvedValue(1);
    prisma.product.findMany.mockResolvedValue([{ id: "p1", sku: "SKU1", name: "Produto 1", updatedAt: new Date(0) }]);
    prisma.product.update.mockResolvedValue({});
    prisma.markupRuleset.update.mockResolvedValue({});

    mockFetchOnce({ retorno: { status: "OK", produtos: [{ produto: { id: 1, codigo: "SKU1" } }] } });
    mockFetchOnce({ retorno: { status: "OK", produto: { nome: "Produto 1" } } }); // sem custo

    const result = await runTinySyncBatch("emp1", { budgetMs: 5000 });

    expect(result.updated).toBe(0);
    expect(result.errors).toEqual([{ sku: "SKU1", message: "Tiny não retornou um custo válido para este SKU" }]);
    // Mesmo sem custo, o updatedAt avança (para não travar a fila nas próximas rodadas).
    expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: "p1" }, data: { updatedAt: expect.any(Date) } });
  }, 10000);
});
