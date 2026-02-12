# Markup — Login (Senha) + Google (NextAuth v5)

Este pacote adiciona autenticação ao seu projeto Next.js (App Router):
- Login com **e-mail + senha** (via Credentials Provider)
- Login com **Google**
- Proteção de rotas (Configurações, Precificação, Histórico, Produtos, Minha Conta)
- Página **Minha Conta**
- Cadastro (criar usuário) em `/cadastro`

## 1) Instalar dependências
No seu projeto, rode:

```bash
npm i next-auth @auth/prisma-adapter prisma @prisma/client bcryptjs
```

## 2) Prisma / Banco (SQLite)
Crie o arquivo `.env.local` (veja `.env.example`) e rode:

```bash
npx prisma migrate dev --name init
```

## 3) Variáveis de ambiente
Crie `.env.local` na raiz do projeto com:

- `DATABASE_URL` (SQLite)
- `NEXTAUTH_SECRET` (string aleatória)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

> Para gerar um secret rápido:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 4) Rodar
```bash
npm run dev
```

## Observações
- O cadastro cria usuário no SQLite, com senha hasheada (bcryptjs).
- O Google Login exige credenciais no Google Cloud Console (OAuth).
