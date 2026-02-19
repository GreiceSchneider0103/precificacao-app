# 🤝 Guia de Contribuição

Obrigado por considerar contribuir com o **Markup**! Este documento contém diretrizes para ajudar você a contribuir de forma efetiva.

## 📋 Código de Conduta

Ao participar deste projeto, você concorda em seguir nosso [Código de Conduta](CODE_OF_CONDUCT.md).

## 🚀 Como Posso Contribuir?

### Reportando Bugs

Antes de criar um report de bug, verifique se já não existe uma issue sobre o problema. Se não existir:

1. Use um título claro e descritivo
2. Descreva os passos exatos para reproduzir o problema
3. Forneça exemplos específicos
4. Descreva o comportamento observado vs. esperado
5. Inclua screenshots se aplicável
6. Adicione informações do ambiente (OS, browser, versão do Node)

**Template de Bug Report:**

```markdown
### Descrição
Descrição clara do bug

### Passos para Reproduzir
1. Vá para '...'
2. Clique em '...'
3. Role até '...'
4. Veja o erro

### Comportamento Esperado
O que deveria acontecer

### Comportamento Atual
O que realmente acontece

### Screenshots
Se aplicável

### Ambiente
- OS: [ex: Windows 10]
- Browser: [ex: Chrome 120]
- Node: [ex: 18.17.0]
- Versão do App: [ex: 1.0.0]
```

### Sugerindo Melhorias

Melhorias são sempre bem-vindas! Para sugerir:

1. Use um título claro e descritivo
2. Forneça uma descrição detalhada da melhoria
3. Explique por que seria útil para a maioria dos usuários
4. Liste alguns exemplos de como funcionaria

**Template de Feature Request:**

```markdown
### Descrição da Feature
Descrição clara da funcionalidade

### Problema que Resolve
Qual problema esta feature resolve?

### Solução Proposta
Como você imagina que isso funcionaria?

### Alternativas Consideradas
Outras abordagens que você pensou

### Contexto Adicional
Qualquer outra informação relevante
```

### Pull Requests

1. Fork o repositório
2. Crie uma branch a partir de `main`:
   ```bash
   git checkout -b feature/minha-feature
   ```
3. Faça suas alterações seguindo o [Guia de Estilo](#-guia-de-estilo)
4. Escreva ou atualize testes
5. Certifique-se que todos os testes passam:
   ```bash
   npm run test
   ```
6. Commit suas mudanças usando [Conventional Commits](#conventional-commits)
7. Push para sua branch
8. Abra um Pull Request

**Checklist do PR:**

- [ ] Meu código segue o guia de estilo do projeto
- [ ] Revisei meu próprio código
- [ ] Comentei em partes complexas do código
- [ ] Atualizei a documentação relevante
- [ ] Minhas mudanças não geram novos warnings
- [ ] Adicionei testes que provam que minha correção funciona
- [ ] Testes novos e existentes passam localmente
- [ ] Mudanças dependentes foram merged e publicadas

## 📝 Conventional Commits

Usamos [Conventional Commits](https://www.conventionalcommits.org/) para mensagens de commit:

### Formato

```
<tipo>[escopo opcional]: <descrição>

[corpo opcional]

[rodapé(s) opcional(is)]
```

### Tipos

- **feat**: Nova funcionalidade
- **fix**: Correção de bug
- **docs**: Mudanças na documentação
- **style**: Formatação, missing semi-colons, etc
- **refactor**: Refatoração de código
- **perf**: Melhoria de performance
- **test**: Adição ou correção de testes
- **build**: Mudanças no sistema de build
- **ci**: Mudanças em CI/CD
- **chore**: Outras mudanças que não modificam src ou testes
- **revert**: Reverte um commit anterior

### Exemplos

```bash
feat(pricing): add Shopee tiered pricing support

fix(auth): resolve session timeout issue

docs(readme): update installation instructions

style(components): format code with prettier

refactor(api): simplify product creation logic

perf(pricing): optimize calculation algorithm

test(validation): add tests for email validation

build(deps): upgrade Next.js to v16

ci(github): add automated deployment

chore(release): bump version to 1.1.0
```

### Breaking Changes

Para mudanças que quebram compatibilidade:

```bash
feat(api)!: change product API response format

BREAKING CHANGE: product endpoint now returns { data, metadata }
```

## 🎨 Guia de Estilo

### TypeScript

- Use TypeScript para todo código novo
- Prefira `interface` para objetos e `type` para unions
- Use tipos explícitos em funções públicas
- Evite `any`, use `unknown` se necessário

```typescript
// ✅ Bom
interface User {
  id: string;
  name: string;
  email: string;
}

function getUser(id: string): Promise<User> {
  // ...
}

// ❌ Evitar
function getUser(id): any {
  // ...
}
```

### React

- Use hooks em vez de class components
- Separe lógica em custom hooks
- Use React.memo para componentes custosos
- Prefira const arrow functions

```typescript
// ✅ Bom
export const ProductCard: React.FC<Props> = ({ product }) => {
  const { price, calculate } = usePricing(product);
  
  return <div>{price}</div>;
};

// ❌ Evitar
export function ProductCard(props) {
  const price = calculatePrice(props.product);
  return <div>{price}</div>;
}
```

### Nomeação

- **Arquivos**: `kebab-case.tsx` ou `PascalCase.tsx` para componentes
- **Variáveis**: `camelCase`
- **Constantes**: `UPPER_SNAKE_CASE`
- **Interfaces/Types**: `PascalCase`
- **Funções**: `camelCase` e verbos descritivos

```typescript
// Arquivos
components/product-card.tsx
components/ProductCard.tsx
hooks/use-pricing.ts

// Código
const userName = "João";
const MAX_PRICE = 10000;

interface ProductData {
  sku: string;
}

function calculatePrice() {
  // ...
}
```

### Imports

Organize imports na seguinte ordem:

1. React e bibliotecas externas
2. Imports internos (com @/)
3. Imports relativos
4. Imports de tipos

```typescript
// 1. External
import { useState } from 'react';
import { z } from 'zod';

// 2. Internal
import { solvePOR } from '@/lib/pricing';
import { Button } from '@/components/ui/button';

// 3. Relative
import { ProductCard } from './ProductCard';

// 4. Types
import type { Product } from '@/types';
```

### Comentários

- Use JSDoc para funções públicas
- Comente o "porquê", não o "o quê"
- Mantenha comentários atualizados

```typescript
/**
 * Calcula o preço de venda ideal considerando todos os custos
 * e margem de contribuição desejada.
 * 
 * @param params - Parâmetros de entrada para cálculo
 * @returns Objeto com preço sugerido e breakdown de custos
 * 
 * @example
 * ```ts
 * const result = solvePOR({
 *   cmv: 100,
 *   margemAlvoPercent: 30,
 *   // ...
 * });
 * ```
 */
export function solvePOR(params: PricingParams): PricingResult {
  // Clampeia margem entre 0 e 95% para evitar divisão por zero
  const m = clamp(params.margemAlvoPercent / 100, 0, 0.95);
  // ...
}
```

## 🧪 Testes

### Estrutura

```
__tests__/
├── unit/              # Testes unitários
│   ├── pricing.test.ts
│   └── validation.test.ts
└── integration/       # Testes de integração
    ├── auth.test.ts
    └── api.test.ts
```

### Padrões

- Um arquivo de teste por módulo
- Nomes descritivos: `should do something when condition`
- Organize com `describe` e `it`
- Use AAA pattern (Arrange, Act, Assert)

```typescript
describe('solvePOR', () => {
  it('should calculate correct price for Shopee with 30% margin', () => {
    // Arrange
    const params = {
      cmv: 100,
      margemAlvoPercent: 30,
      // ...
    };

    // Act
    const result = solvePOR(params);

    // Assert
    expect(result.breakdown.margemPct).toBeCloseTo(30, 1);
  });
});
```

### Coverage

Mantenha cobertura mínima:
- Statements: 70%
- Branches: 70%
- Functions: 70%
- Lines: 70%

## 📦 Estrutura de Branches

- **main**: Produção, sempre deployável
- **develop**: Desenvolvimento, integração de features
- **feature/**: Novas funcionalidades
- **fix/**: Correções de bugs
- **refactor/**: Refatorações
- **docs/**: Documentação

```bash
# Feature
git checkout -b feature/shopee-integration

# Bug fix
git checkout -b fix/session-timeout

# Refactor
git checkout -b refactor/pricing-algorithm
```

## 🔄 Processo de Review

### Para Revisores

- Seja construtivo e educado
- Explique o "porquê" das sugestões
- Aprove apenas se estiver 100% confortável
- Teste localmente quando possível

### Para Autores

- Responda a todos os comentários
- Não leve para o lado pessoal
- Faça mudanças solicitadas ou argumente educadamente
- Marque conversas como resolvidas após mudanças

## 📚 Recursos Adicionais

- [Next.js Documentation](https://nextjs.org/docs)
- [React Documentation](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Prisma Guides](https://www.prisma.io/docs)

## 💬 Dúvidas?

- Abra uma [Discussion](https://github.com/GreiceSchneider0103/precificacao-app/discussions)
- Entre no nosso [Discord](#)
- Envie um email para dev@markup.com.br

---

**Obrigado por contribuir! 🎉**
