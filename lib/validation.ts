// lib/validation.ts
import { z } from 'zod';

/**
 * Schema de validação para inputs de precificação
 * 
 * Valida todos os parâmetros necessários para calcular o preço de venda,
 * garantindo que os valores estão dentro de ranges aceitáveis.
 */
export const PricingInputSchema = z.object({
  // Produto
  sku: z.string().min(1, 'SKU é obrigatório').max(50, 'SKU muito longo'),
  name: z.string().min(1, 'Nome é obrigatório').max(200, 'Nome muito longo'),
  cmv: z.number()
    .positive('CMV deve ser maior que zero')
    .max(1000000, 'CMV muito alto'),
  
  // Configurações básicas
  markupBase: z.number()
    .min(1, 'Markup deve ser no mínimo 1')
    .max(10, 'Markup muito alto'),
  
  frete: z.number()
    .nonnegative('Frete não pode ser negativo')
    .max(10000, 'Frete muito alto'),
  
  // Canal
  channel: z.string().min(1, 'Canal é obrigatório'),
  
  // Margem alvo
  margemAlvoPercent: z.number()
    .min(0, 'Margem não pode ser negativa')
    .max(95, 'Margem não pode exceder 95%'),
  
  // Regime tributário
  regime: z.enum(['simples', 'normal'], {
    errorMap: () => ({ message: 'Regime deve ser "simples" ou "normal"' })
  }),
  
  // Operacionais
  operMode: z.enum(['percent', 'fixed']),
  operValue: z.number()
    .nonnegative('Valor operacional não pode ser negativo')
    .max(100000, 'Valor operacional muito alto'),
  
  // Ads
  adsMode: z.enum(['percent', 'fixed']),
  adsValue: z.number()
    .nonnegative('Valor de ads não pode ser negativo')
    .max(100000, 'Valor de ads muito alto'),
  
  // Rebate
  rebateMode: z.enum(['percent', 'fixed']),
  rebateValue: z.number()
    .nonnegative('Rebate não pode ser negativo')
    .max(100000, 'Rebate muito alto'),
});

export type PricingInput = z.infer<typeof PricingInputSchema>;

/**
 * Schema para configuração de canal
 */
export const ChannelConfigSchema = z.object({
  commissionPercent: z.number()
    .min(0, 'Comissão não pode ser negativa')
    .max(100, 'Comissão não pode exceder 100%'),
  
  taxFixed: z.number()
    .nonnegative('Taxa fixa não pode ser negativa')
    .max(1000, 'Taxa fixa muito alta'),
  
  mainTaxPercent: z.number()
    .min(0, 'Imposto não pode ser negativo')
    .max(100, 'Imposto não pode exceder 100%'),
  
  hasCredits: z.boolean(),
  
  creditFretePercent: z.number()
    .min(0, 'Crédito frete não pode ser negativo')
    .max(100, 'Crédito frete não pode exceder 100%'),
  
  creditCommissionPercent: z.number()
    .min(0, 'Crédito comissão não pode ser negativo')
    .max(100, 'Crédito comissão não pode exceder 100%'),
  
  targetMarginPercent: z.number()
    .min(0, 'Margem alvo não pode ser negativa')
    .max(95, 'Margem alvo não pode exceder 95%'),
  
  // Configurações específicas do Mercado Livre
  meli: z.object({
    classicCommissionPercent: z.number().min(0).max(100),
    premiumCommissionPercent: z.number().min(0).max(100),
  }).optional(),
  
  // Configurações específicas da Shopee
  shopee: z.object({
    mode: z.enum(['flat', 'tiered']),
    tiers: z.array(z.object({
      min: z.number().nonnegative(),
      max: z.number().nullable(),
      commissionPercent: z.number().min(0).max(100),
      taxFixed: z.number().nonnegative(),
    })),
  }).optional(),
});

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

/**
 * Schema para produto
 */
export const ProductSchema = z.object({
  sku: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  cmv: z.number().positive().max(1000000),
  mlb: z.string().optional(),
});

export type Product = z.infer<typeof ProductSchema>;

/**
 * Schema para promoção
 */
export const PromotionSchema = z.object({
  sku: z.string().min(1).max(50),
  name: z.string().min(1).max(200),
  channel: z.string().min(1),
  originalPrice: z.number().positive(),
  promoPrice: z.number().positive(),
  startDate: z.date(),
  endDate: z.date(),
  isActive: z.boolean().default(true),
}).refine(data => data.promoPrice < data.originalPrice, {
  message: 'Preço promocional deve ser menor que o preço original',
  path: ['promoPrice'],
}).refine(data => data.endDate > data.startDate, {
  message: 'Data final deve ser posterior à data inicial',
  path: ['endDate'],
});

export type Promotion = z.infer<typeof PromotionSchema>;

/**
 * Schema para cadastro de usuário
 */
export const RegisterSchema = z.object({
  name: z.string()
    .min(2, 'Nome deve ter no mínimo 2 caracteres')
    .max(100, 'Nome muito longo'),
  
  email: z.string()
    .email('Email inválido')
    .toLowerCase(),
  
  password: z.string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .max(100, 'Senha muito longa')
    .regex(/[A-Z]/, 'Senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'Senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'Senha deve conter pelo menos um número'),
  
  confirmPassword: z.string(),
  
  phone: z.string()
    .regex(/^\+?[1-9]\d{1,14}$/, 'Telefone inválido')
    .optional(),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Senhas não coincidem',
  path: ['confirmPassword'],
});

export type RegisterInput = z.infer<typeof RegisterSchema>;

/**
 * Schema para login
 */
export const LoginSchema = z.object({
  email: z.string().email('Email inválido').toLowerCase(),
  password: z.string().min(1, 'Senha é obrigatória'),
});

export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * Schema para atualização de perfil
 */
export const UpdateProfileSchema = z.object({
  name: z.string()
    .min(2, 'Nome deve ter no mínimo 2 caracteres')
    .max(100, 'Nome muito longo')
    .optional(),
  
  phone: z.string()
    .regex(/^\+?[1-9]\d{1,14}$/, 'Telefone inválido')
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

/**
 * Schema para alteração de senha
 */
export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Senha atual é obrigatória'),
  
  newPassword: z.string()
    .min(8, 'Nova senha deve ter no mínimo 8 caracteres')
    .max(100, 'Senha muito longa')
    .regex(/[A-Z]/, 'Senha deve conter pelo menos uma letra maiúscula')
    .regex(/[a-z]/, 'Senha deve conter pelo menos uma letra minúscula')
    .regex(/[0-9]/, 'Senha deve conter pelo menos um número'),
  
  confirmNewPassword: z.string(),
}).refine(data => data.newPassword === data.confirmNewPassword, {
  message: 'Senhas não coincidem',
  path: ['confirmNewPassword'],
}).refine(data => data.newPassword !== data.currentPassword, {
  message: 'Nova senha deve ser diferente da senha atual',
  path: ['newPassword'],
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

/**
 * Função helper para validar dados
 * 
 * @param schema - Schema Zod
 * @param data - Dados a serem validados
 * @returns Resultado da validação
 */
export function validateData<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: z.ZodError } {
  try {
    const validated = schema.parse(data);
    return { success: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, errors: error };
    }
    throw error;
  }
}

/**
 * Função helper para formatar erros de validação
 * 
 * @param error - ZodError
 * @returns Objeto com erros formatados por campo
 */
export function formatValidationErrors(error: z.ZodError): Record<string, string> {
  const formatted: Record<string, string> = {};
  
  error.errors.forEach(err => {
    const path = err.path.join('.');
    formatted[path] = err.message;
  });
  
  return formatted;
}

/**
 * Função helper para validar e retornar apenas a primeira mensagem de erro
 * 
 * @param schema - Schema Zod
 * @param data - Dados a serem validados
 * @returns Primeira mensagem de erro ou null se válido
 */
export function getFirstValidationError<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): string | null {
  try {
    schema.parse(data);
    return null;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return error.errors[0]?.message || 'Erro de validação';
    }
    return 'Erro desconhecido';
  }
}
