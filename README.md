# Plataforma Contábil Multi-tenant

SaaS para escritórios de contabilidade. Plano completo em [`docs/plano.md`](docs/plano.md); regras de trabalho em [`CLAUDE.md`](CLAUDE.md).

## Rodar localmente

Requisitos: Node 24, Docker Desktop.

```bash
corepack enable
pnpm install
cp .env.example .env              # ajuste os valores (veja abaixo)
docker compose up -d --wait       # Postgres + Mailpit
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Painel: http://app.localhost:3000 (entre com `dono@alfa.test`; o link chega no Mailpit, http://localhost:8025)
- Portal provisório: http://alfa.localhost:3000

Para o `.env` local, os valores de `.env.test` servem como base, trocando o banco para `plataforma` e `APP_ENV=development`.

## Verificações (as mesmas do CI)

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test        # unitários + integração e isolamento (precisa do docker compose)
pnpm test:e2e    # Playwright em 360 px (sobe web e worker sozinho)
```
