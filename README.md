# Tinocerto

SaaS de recrutamento e seleção multi-tenant para o mercado brasileiro —
gestão de vagas, funil de candidaturas, assessment comportamental próprio,
score de aderência a habilidades, entrevista estruturada, e uma API
pública para integração com outros sistemas de RH.

Este repositório é público para fins de portfólio e transparência técnica.
Veja [LICENSE](./LICENSE) — todos os direitos reservados, uso não autorizado.

## Stack

- **Backend**: NestJS + PostgreSQL (Row-Level Security multi-tenant) + Redis + Cerbos (autorização) + MinIO (armazenamento)
- **Frontend**: Next.js 15 (App Router) + design system próprio
- **Monorepo**: pnpm workspaces (`apps/api`, `apps/web`, `packages/design-system`)

## Estrutura

```
apps/api/       -- API NestJS (multi-tenant, RLS, autenticação de staff e candidato)
apps/web/       -- Painel do recrutador + portal público de vagas (Next.js)
packages/design-system/  -- Componentes e tokens visuais compartilhados
infra/          -- Docker Compose (dev e produção), configuração de Cerbos
cerbos/         -- Políticas de autorização (Cerbos)
```

## Rodando localmente

Pré-requisitos: Node 20, pnpm 9, Docker.

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d   # postgres, redis, cerbos, minio
cp infra/.env.example apps/api/.env                 # preencha os valores GERAR_COM: com openssl
pnpm --filter @tinocerto/api migrate
pnpm --filter @tinocerto/api start:dev
pnpm --filter @tinocerto/web dev
```

## Testes

```bash
pnpm test
```
