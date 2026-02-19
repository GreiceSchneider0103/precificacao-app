import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/products
 * 
 * Retorna produtos do usuário logado com CMV > 0 (apenas produtos precificáveis).
 * 
 * Resposta:
 * {
 *   "products": [
 *     {
 *       "sku": "6332817",
 *       "name": "BANQUETA GOLD (KIT INCLUSO) - LINHO PRATA E163 - Kit 2",
 *       "cmv": 273.04,
 *       "mlb": "MLB3147733694",
 *       "updatedAt": "2026-02-16T10:30:00Z"
 *     }
 *   ],
 *   "total": 1,
 *   "filtered": 3
 * }
 */
export async function GET(request: NextRequest) {
  try {
    // ✅ Verificar autenticação
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Não autenticado" },
        { status: 401 }
      );
    }

    // ✅ Buscar produtos do usuário com CMV > 0 (apenas produtos precificáveis)
    const products = await prisma.product.findMany({
      where: {
        userId: session.user.id,
        cmv: {
          gt: 0,  // ✅ FILTRO: Apenas produtos com CMV maior que 0
        },
      },
      select: {
        id: true,
        sku: true,
        name: true,
        cmv: true,
        mlb: true,
        updatedAt: true,
        createdAt: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    // 📊 Contar total de produtos (incluindo os sem CMV) para estatística
    const totalProducts = await prisma.product.count({
      where: {
        userId: session.user.id,
      },
    });

    const filtered = totalProducts - products.length;

    console.log(
      `✓ API /api/products: Retornando ${products.length} produtos com CMV > 0 ` +
      `(${filtered} filtrados) para usuário ${session.user.email}`
    );

    return NextResponse.json({
      products: products,
      total: products.length,
      filtered: filtered,  // Quantos foram filtrados por ter CMV = 0
    });
  } catch (error) {
    console.error("❌ Erro ao buscar produtos:", error);
    
    return NextResponse.json(
      { 
        error: "Erro ao buscar produtos",
        details: error instanceof Error ? error.message : "Erro desconhecido"
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/products
 * 
 * Cria um novo produto.
 * 
 * Body:
 * {
 *   "sku": "ABC123",
 *   "name": "Nome do Produto",
 *   "cmv": 100.00,
 *   "mlb": "MLB123456"  // opcional
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // ✅ Verificar autenticação
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Não autenticado" },
        { status: 401 }
      );
    }

    // ✅ Validar dados do body
    const body = await request.json();
    const { sku, name, cmv, mlb } = body;

    if (!sku || !name || cmv === undefined) {
      return NextResponse.json(
        { error: "SKU, nome e CMV são obrigatórios" },
        { status: 400 }
      );
    }

    // ⚠️ Avisar se CMV = 0
    if (Number(cmv) <= 0) {
      console.warn(`⚠️ Produto ${sku} criado com CMV = 0. Não será listado na precificação até ter CMV > 0.`);
    }

    // ✅ Verificar se SKU já existe para este usuário
    const existing = await prisma.product.findFirst({
      where: {
        userId: session.user.id,
        sku: sku,
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Já existe um produto com este SKU" },
        { status: 409 }
      );
    }

    // ✅ Criar produto
    const product = await prisma.product.create({
      data: {
        sku: sku,
        name: name,
        cmv: Number(cmv),
        mlb: mlb || null,
        userId: session.user.id,
      },
    });

    console.log(`✓ Produto criado: ${product.sku} - ${product.name} (CMV: ${product.cmv})`);

    return NextResponse.json(
      { 
        message: "Produto criado com sucesso",
        product: product,
        warning: product.cmv <= 0 ? "Produto criado com CMV = 0. Não aparecerá na precificação até ter CMV > 0." : null
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("❌ Erro ao criar produto:", error);
    
    return NextResponse.json(
      { 
        error: "Erro ao criar produto",
        details: error instanceof Error ? error.message : "Erro desconhecido"
      },
      { status: 500 }
    );
  }
}