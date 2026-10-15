# Plano de Desenvolvimento — Plataforma Contábil Multi-tenant

Oct 14, 2026 · @Pedro

Este arquivo é o índice do plano. Em 14/10/2026, o conteúdo foi dividido, sem alteração, nos arquivos numerados de `docs/` (seção 12 da skill de planejamento). A numeração das seções foi mantida dentro de cada arquivo, então referências como "seção 14 do plano" continuam válidas.

## Onde está cada seção

| Seção do plano | Arquivo |
| --- | --- |
| 1. Resumo executivo | [00-contexto-e-visao.md](00-contexto-e-visao.md) |
| 2. Confirmado, hipóteses e decisões (P1 a P20) | [00-contexto-e-visao.md](00-contexto-e-visao.md) |
| 3. Escopo | [02-escopo-mvp-e-backlog.md](02-escopo-mvp-e-backlog.md) |
| 4. Módulos e requisitos funcionais (inclui a Matriz de automação) | [03-requisitos-e-regras-de-negocio.md](03-requisitos-e-regras-de-negocio.md) |
| 5. Regras de negócio (RN1 a RN17) e critérios de aceitação (CA1 a CA9) | [03-requisitos-e-regras-de-negocio.md](03-requisitos-e-regras-de-negocio.md) |
| 6. Requisitos não funcionais | [03-requisitos-e-regras-de-negocio.md](03-requisitos-e-regras-de-negocio.md) |
| 7. Arquitetura proposta | [04-arquitetura.md](04-arquitetura.md) |
| 8. Estratégia multi-tenant (inclui domínios e logs de segurança) | [06-multi-tenancy-e-autorizacao.md](06-multi-tenancy-e-autorizacao.md) |
| 9. Modelo de dados preliminar | [05-modelo-de-dados.md](05-modelo-de-dados.md) |
| 10. Integrações externas | [04-arquitetura.md](04-arquitetura.md) |
| 11. Segurança e LGPD | [07-seguranca-e-privacidade.md](07-seguranca-e-privacidade.md) |
| 12. Estratégia de testes | [09-plano-de-testes.md](09-plano-de-testes.md) |
| 13. Operação | [10-deploy-e-operacao.md](10-deploy-e-operacao.md) |
| 14. Plano de execução e definição de pronto | [02-escopo-mvp-e-backlog.md](02-escopo-mvp-e-backlog.md) |
| 15. Riscos prioritários | [08-riscos-e-viabilidade.md](08-riscos-e-viabilidade.md) |
| 16. ADRs | [adr/](adr/) (0001 a 0009) |
| 16. Trilha de IA | [11-engenharia-de-ia.md](11-engenharia-de-ia.md) |
| 16. Decisões pendentes e inconsistências conhecidas (I1 a I8) | [08-riscos-e-viabilidade.md](08-riscos-e-viabilidade.md) |

Não existe `01-descoberta-e-indicadores.md`: a descoberta (hipóteses e indicadores) é curta e está em `00-contexto-e-visao.md`.

## ADRs

| ADR | Decisão |
| --- | --- |
| [0001](adr/0001-monolito-modular-typescript.md) | Monólito modular em TypeScript |
| [0002](adr/0002-banco-compartilhado-com-rls.md) | Banco compartilhado com `tenant_id` e RLS; `security_events` global |
| [0003](adr/0003-postgres-neon-e-fila-pg-boss.md) | Postgres Neon e fila pg-boss |
| [0004](adr/0004-hospedagem-vercel-railway-ably-e-dominios.md) | Vercel, Railway, Ably e domínios |
| [0005](adr/0005-whatsapp-cloud-api-oficial.md) | WhatsApp só pela Cloud API oficial |
| [0006](adr/0006-certificados-e-credenciais.md) | Certificados e credenciais |
| [0007](adr/0007-drizzle-zod-e-autenticacao.md) | Drizzle, Zod e Better Auth com link mágico e TOTP |
| [0008](adr/0008-whatsapp-canal-principal-e-templates.md) | WhatsApp como canal principal e templates da plataforma |
| [0009](adr/0009-honorarios-na-conta-do-escritorio.md) | Honorários na conta do escritório |

## Pesquisas

| Tema | Arquivo |
| --- | --- |
| O que o Integra Contador (Serpro) oferece | [pesquisas/serpro-integra-contador.md](pesquisas/serpro-integra-contador.md) |

## Incrementos

| Incremento | Plano da tarefa |
| --- | --- |
| Fundação multi-tenant | [incrementos/01-fundacao-multi-tenant.md](incrementos/01-fundacao-multi-tenant.md) |
| Clientes e documentos | [incrementos/02-clientes-e-documentos.md](incrementos/02-clientes-e-documentos.md) |
