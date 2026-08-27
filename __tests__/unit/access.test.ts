import { getEmpresaAccess, getAccessibleEmpresaIds } from "@/lib/access";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    markupRuleset: { findUnique: jest.fn(), findMany: jest.fn() },
    empresaAccess: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require("@/lib/prisma") as {
  prisma: {
    markupRuleset: { findUnique: jest.Mock; findMany: jest.Mock };
    empresaAccess: { findUnique: jest.Mock; findMany: jest.Mock };
  };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("getEmpresaAccess", () => {
  it("retorna null quando a empresa não existe", async () => {
    prisma.markupRuleset.findUnique.mockResolvedValue(null);
    const result = await getEmpresaAccess("user1", "emp1");
    expect(result).toBeNull();
    expect(prisma.empresaAccess.findUnique).not.toHaveBeenCalled();
  });

  it("retorna isOwner:true quando o usuário é o dono, sem consultar concessões", async () => {
    prisma.markupRuleset.findUnique.mockResolvedValue({ userId: "user1" });
    const result = await getEmpresaAccess("user1", "emp1");
    expect(result).toEqual({ ownerUserId: "user1", isOwner: true });
    expect(prisma.empresaAccess.findUnique).not.toHaveBeenCalled();
  });

  it("retorna isOwner:false quando o usuário tem uma concessão (EmpresaAccess)", async () => {
    prisma.markupRuleset.findUnique.mockResolvedValue({ userId: "master1" });
    prisma.empresaAccess.findUnique.mockResolvedValue({ userId: "user2", empresaId: "emp1" });
    const result = await getEmpresaAccess("user2", "emp1");
    expect(result).toEqual({ ownerUserId: "master1", isOwner: false });
  });

  it("retorna null quando o usuário não é dono nem tem concessão", async () => {
    prisma.markupRuleset.findUnique.mockResolvedValue({ userId: "master1" });
    prisma.empresaAccess.findUnique.mockResolvedValue(null);
    const result = await getEmpresaAccess("user2", "emp1");
    expect(result).toBeNull();
  });
});

describe("getAccessibleEmpresaIds", () => {
  it("combina empresas próprias e concedidas", async () => {
    prisma.markupRuleset.findMany.mockResolvedValue([{ id: "empA" }, { id: "empB" }]);
    prisma.empresaAccess.findMany.mockResolvedValue([{ empresaId: "empC" }]);
    const ids = await getAccessibleEmpresaIds("user1");
    expect(ids.sort()).toEqual(["empA", "empB", "empC"]);
  });

  it("retorna lista vazia quando não há empresas próprias nem concedidas", async () => {
    prisma.markupRuleset.findMany.mockResolvedValue([]);
    prisma.empresaAccess.findMany.mockResolvedValue([]);
    const ids = await getAccessibleEmpresaIds("user1");
    expect(ids).toEqual([]);
  });
});
