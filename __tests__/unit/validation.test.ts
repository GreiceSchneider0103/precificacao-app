// __tests__/unit/validation.test.ts
import {
  PricingInputSchema,
  ProductSchema,
  RegisterSchema,
  LoginSchema,
  ChangePasswordSchema,
  validateData,
  formatValidationErrors,
  getFirstValidationError,
} from '@/lib/validation';

describe('Validation Schemas', () => {
  describe('PricingInputSchema', () => {
    const validInput = {
      sku: 'PROD-001',
      name: 'Produto Teste',
      cmv: 100,
      markupBase: 2,
      frete: 15,
      channel: 'shopee',
      margemAlvoPercent: 30,
      regime: 'simples' as const,
      operMode: 'fixed' as const,
      operValue: 0,
      adsMode: 'fixed' as const,
      adsValue: 0,
      rebateMode: 'fixed' as const,
      rebateValue: 0,
    };

    it('should validate correct pricing input', () => {
      const result = PricingInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject negative CMV', () => {
      const result = PricingInputSchema.safeParse({
        ...validInput,
        cmv: -100,
      });
      expect(result.success).toBe(false);
    });

    it('should reject margin above 95%', () => {
      const result = PricingInputSchema.safeParse({
        ...validInput,
        margemAlvoPercent: 96,
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid regime', () => {
      const result = PricingInputSchema.safeParse({
        ...validInput,
        regime: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty SKU', () => {
      const result = PricingInputSchema.safeParse({
        ...validInput,
        sku: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject too high CMV', () => {
      const result = PricingInputSchema.safeParse({
        ...validInput,
        cmv: 2000000,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('ProductSchema', () => {
    const validProduct = {
      sku: 'PROD-001',
      name: 'Produto Teste',
      cmv: 100,
      mlb: 'MLB123456',
    };

    it('should validate correct product', () => {
      const result = ProductSchema.safeParse(validProduct);
      expect(result.success).toBe(true);
    });

    it('should accept product without MLB', () => {
      const { mlb, ...productWithoutMlb } = validProduct;
      const result = ProductSchema.safeParse(productWithoutMlb);
      expect(result.success).toBe(true);
    });

    it('should reject product with negative CMV', () => {
      const result = ProductSchema.safeParse({
        ...validProduct,
        cmv: -50,
      });
      expect(result.success).toBe(false);
    });

    it('should reject product with empty name', () => {
      const result = ProductSchema.safeParse({
        ...validProduct,
        name: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('RegisterSchema', () => {
    const validRegister = {
      name: 'João Silva',
      email: 'joao@example.com',
      password: 'Senha@123',
      confirmPassword: 'Senha@123',
      phone: '+5511999999999',
    };

    it('should validate correct registration', () => {
      const result = RegisterSchema.safeParse(validRegister);
      expect(result.success).toBe(true);
    });

    it('should reject passwords that do not match', () => {
      const result = RegisterSchema.safeParse({
        ...validRegister,
        confirmPassword: 'OutraSenha@123',
      });
      expect(result.success).toBe(false);
    });

    it('should reject weak password (no uppercase)', () => {
      const result = RegisterSchema.safeParse({
        ...validRegister,
        password: 'senha@123',
        confirmPassword: 'senha@123',
      });
      expect(result.success).toBe(false);
    });

    it('should reject weak password (no lowercase)', () => {
      const result = RegisterSchema.safeParse({
        ...validRegister,
        password: 'SENHA@123',
        confirmPassword: 'SENHA@123',
      });
      expect(result.success).toBe(false);
    });

    it('should reject weak password (no number)', () => {
      const result = RegisterSchema.safeParse({
        ...validRegister,
        password: 'Senha@abc',
        confirmPassword: 'Senha@abc',
      });
      expect(result.success).toBe(false);
    });

    it('should reject short password', () => {
      const result = RegisterSchema.safeParse({
        ...validRegister,
        password: 'Sen@1',
        confirmPassword: 'Sen@1',
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid email', () => {
      const result = RegisterSchema.safeParse({
        ...validRegister,
        email: 'not-an-email',
      });
      expect(result.success).toBe(false);
    });

    it('should convert email to lowercase', () => {
      const result = RegisterSchema.safeParse({
        ...validRegister,
        email: 'JOAO@EXAMPLE.COM',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('joao@example.com');
      }
    });

    it('should accept registration without phone', () => {
      const { phone, ...registerWithoutPhone } = validRegister;
      const result = RegisterSchema.safeParse(registerWithoutPhone);
      expect(result.success).toBe(true);
    });

    it('should reject invalid phone format', () => {
      const result = RegisterSchema.safeParse({
        ...validRegister,
        phone: '123',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('LoginSchema', () => {
    it('should validate correct login', () => {
      const result = LoginSchema.safeParse({
        email: 'joao@example.com',
        password: 'Senha@123',
      });
      expect(result.success).toBe(true);
    });

    it('should reject invalid email', () => {
      const result = LoginSchema.safeParse({
        email: 'not-an-email',
        password: 'Senha@123',
      });
      expect(result.success).toBe(false);
    });

    it('should reject empty password', () => {
      const result = LoginSchema.safeParse({
        email: 'joao@example.com',
        password: '',
      });
      expect(result.success).toBe(false);
    });

    it('should convert email to lowercase', () => {
      const result = LoginSchema.safeParse({
        email: 'JOAO@EXAMPLE.COM',
        password: 'Senha@123',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('joao@example.com');
      }
    });
  });

  describe('ChangePasswordSchema', () => {
    const validChange = {
      currentPassword: 'SenhaAtual@123',
      newPassword: 'NovaSenha@456',
      confirmNewPassword: 'NovaSenha@456',
    };

    it('should validate correct password change', () => {
      const result = ChangePasswordSchema.safeParse(validChange);
      expect(result.success).toBe(true);
    });

    it('should reject if new passwords do not match', () => {
      const result = ChangePasswordSchema.safeParse({
        ...validChange,
        confirmNewPassword: 'OutraSenha@789',
      });
      expect(result.success).toBe(false);
    });

    it('should reject if new password equals current password', () => {
      const result = ChangePasswordSchema.safeParse({
        currentPassword: 'Senha@123',
        newPassword: 'Senha@123',
        confirmNewPassword: 'Senha@123',
      });
      expect(result.success).toBe(false);
    });

    it('should reject weak new password', () => {
      const result = ChangePasswordSchema.safeParse({
        ...validChange,
        newPassword: 'weak',
        confirmNewPassword: 'weak',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('Validation Helpers', () => {
  describe('validateData', () => {
    it('should return success for valid data', () => {
      const result = validateData(LoginSchema, {
        email: 'test@example.com',
        password: 'password',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.email).toBe('test@example.com');
      }
    });

    it('should return errors for invalid data', () => {
      const result = validateData(LoginSchema, {
        email: 'invalid-email',
        password: '',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors).toBeDefined();
      }
    });
  });

  describe('formatValidationErrors', () => {
    it('should format errors by field', () => {
      const result = LoginSchema.safeParse({
        email: 'invalid',
        password: '',
      });
      
      if (!result.success) {
        const formatted = formatValidationErrors(result.error);
        expect(formatted).toHaveProperty('email');
        expect(formatted).toHaveProperty('password');
      }
    });
  });

  describe('getFirstValidationError', () => {
    it('should return first error message', () => {
      const error = getFirstValidationError(LoginSchema, {
        email: 'invalid',
        password: '',
      });
      expect(error).toBeTruthy();
      expect(typeof error).toBe('string');
    });

    it('should return null for valid data', () => {
      const error = getFirstValidationError(LoginSchema, {
        email: 'test@example.com',
        password: 'password',
      });
      expect(error).toBeNull();
    });
  });
});
