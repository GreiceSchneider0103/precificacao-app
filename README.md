# 📊 Markup - Sistema Inteligente de Precificação Multi-Canal

<div align="center">

![Next.js](https://img.shields.io/badge/Next.js-16.1.6-black?style=for-the-badge&logo=next.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=for-the-badge&logo=typescript)
![React](https://img.shields.io/badge/React-19.2.3-61DAFB?style=for-the-badge&logo=react)
![Prisma](https://img.shields.io/badge/Prisma-6.19.2-2D3748?style=for-the-badge&logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-316192?style=for-the-badge&logo=postgresql)

**Sistema profissional de precificação para vendedores multi-canal de e-commerce**

[Features](#-features) • [Instalação](#-instalação-rápida) • [Documentação](#-documentação) • [Contribuir](#-como-contribuir)

</div>

---

## 🎯 Sobre o Projeto

**Markup** é uma aplicação web completa que auxilia vendedores de e-commerce a calcular o preço de venda ideal para seus produtos em diferentes marketplaces (Mercado Livre, Shopee, Magalu, Amazon, etc.), considerando:

- ✅ CMV (Custo de Mercadoria Vendida)
- ✅ Comissões específicas de cada marketplace
- ✅ Impostos (Simples Nacional ou Regime Normal)
- ✅ Frete e custos operacionais
- ✅ Investimento em anúncios/ads
- ✅ Margem de contribuição desejada
- ✅ Créditos fiscais (PIS/COFINS)
- ✅ Precificação escalonada da Shopee (tiered pricing)

### 🎓 Por que usar o Markup?

- **Precisão Matemática**: Algoritmo complexo que considera todas as variáveis do e-commerce brasileiro
- **Multi-Canal**: Configure regras diferentes para cada marketplace
- **Gestão de Produtos**: Cadastre e sincronize seu catálogo
- **Responsivo**: Interface moderna e responsiva para desktop e mobile

---

## ✨ Features

### 🔐 Autenticação
- Login com email/senha (bcrypt)
- Login social com Google OAuth
- Sessões persistentes (30 dias)
- Recuperação de senha

### 📊 Precificação Inteligente
- Cálculo automático do preço de venda ideal
- Suporte a múltiplos canais de venda
- Regimes tributários (Simples Nacional / Normal)
- Créditos fiscais automáticos
- Precificação escalonada (Shopee)
- Breakdown detalhado de custos

### 📦 Gestão de Produtos
- CRUD completo de produtos
- Importação via planilha Excel
- SKU único por produto
- Sincronização com banco de dados

---

## 🚀 Instalação Rápida

### Pré-requisitos

- Node.js 18+ ([Download](https://nodejs.org/))
- PostgreSQL 14+ ([Download](https://www.postgresql.org/download/))
- npm ou yarn

### 1️⃣ Clone o repositório

```bash
git clone https://github.com/GreiceSchneider0103/precificacao-app.git
cd precificacao-app
```

### 2️⃣ Instale as dependências

```bash
npm install
# ou
yarn install
```

### 3️⃣ Configure as variáveis de ambiente

Crie um arquivo `.env` na raiz do projeto:

```env
# Database
DATABASE_URL="postgresql://usuario:senha@localhost:5432/markup"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="gere-uma-chave-secreta-aqui"

# Google OAuth (opcional)
GOOGLE_CLIENT_ID="seu-google-client-id"
GOOGLE_CLIENT_SECRET="seu-google-client-secret"
```

**Gerar NEXTAUTH_SECRET:**
```bash
openssl rand -base64 32
```

**Configurar Google OAuth (opcional):**
1. Acesse [Google Cloud Console](https://console.cloud.google.com/)
2. Crie um novo projeto
3. Ative a API "Google+ API"
4. Crie credenciais OAuth 2.0
5. Configure URLs autorizadas:
   - `http://localhost:3000`
   - `http://localhost:3000/api/auth/callback/google`

### 4️⃣ Configure o banco de dados

```bash
# Criar banco PostgreSQL
createdb markup

# Rodar migrations
npx prisma migrate dev

# (Opcional) Seed com dados de exemplo
npx prisma db seed
```

### 5️⃣ Execute o projeto

```bash
npm run dev
# ou
yarn dev
```

Acesse: **http://localhost:3000** 🎉

---

## 📚 Documentação

### Estrutura do Projeto

```
precificacao-app/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes
│   │   ├── auth/                 # NextAuth endpoints
│   │   ├── products/             # CRUD produtos
│   │   └── settings/             # Configurações
│   ├── precificacao/             # Calculadora
│   │   ├── components/           # Componentes modulares
│   │   ├── hooks/                # Custom hooks
│   │   └── page.tsx              # Página principal
│   ├── produtos/                 # Gestão de produtos
│   ├── configuracoes/            # Settings
│   └── components/               # Componentes globais
├── lib/                          # Bibliotecas
│   ├── pricing.ts                # Algoritmo de precificação
│   ├── validation.ts             # Schemas Zod
│   ├── prisma.ts                 # Cliente Prisma
│   └── utils.ts                  # Utilitários
├── prisma/                       # Banco de dados
│   ├── schema.prisma             # Modelo de dados
│   └── migrations/               # Migrações
├── __tests__/                    # Testes
│   ├── unit/                     # Testes unitários
│   └── integration/              # Testes de integração
└── docs/                         # Documentação adicional
```

### Como Funciona o Cálculo de Precificação

O algoritmo de precificação resolve a seguinte equação para encontrar o **POR** (Price On Request):

```
POR = (Custos Fixos - Créditos - Rebates) / 
      (1 - Comissão% - Imposto% - PIS% - Oper% - Ads% + CréditoComissão% + Rebate% - Margem%)
```

**Variáveis:**
- **CMV**: Custo de Mercadoria Vendida
- **Comissão**: % do marketplace (varia por canal)
- **Imposto**: % de imposto sobre venda
- **PIS/COFINS**: 9,25% sobre receita líquida (apenas Regime Normal)
- **Frete**: Custo de envio
- **Operacionais**: Custos operacionais (% ou R$)
- **Ads**: Investimento em anúncios (% ou R$)
- **Margem**: % de margem de contribuição desejada

---

## 🧪 Testes

```bash
npm test              # Roda todos os testes
npm run test:unit     # Testes unitários
npm run test:coverage # Cobertura de testes
```

---

## 🚢 Deploy

### Vercel (Recomendado)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/GreiceSchneider0103/precificacao-app)

1. Conecte seu repositório GitHub
2. Configure as variáveis de ambiente
3. Deploy automático! ✨

---

## 🤝 Como Contribuir

Contribuições são muito bem-vindas! 

1. **Fork** o projeto
2. Crie uma **branch** (`git checkout -b feature/MinhaFeature`)
3. **Commit** (`git commit -m 'Add: Nova feature'`)
4. **Push** (`git push origin feature/MinhaFeature`)
5. Abra um **Pull Request**

---

## 📄 Licença

Este projeto está sob a licença **MIT**.

---

## 👥 Autores

- **Greice Schneider** - [@GreiceSchneider0103](https://github.com/GreiceSchneider0103)

---

<div align="center">

**Feito com ❤️ para a comunidade de e-commerce brasileira**

⭐ Se este projeto te ajudou, considere dar uma estrela!

</div>
