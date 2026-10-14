# Prompt da primeira sessão (cole no Claude Code)

```
Leia CLAUDE.md, docs/plano.md e .claude/skills/modern-software-planning/SKILL.md.

Tarefa desta sessão: APENAS o incremento "Fundação multi-tenant" (seção 14 do plano).

Antes de codar:
1. Organize docs/ conforme a seção 12 da skill, extraindo do docs/plano.md
   (não invente; marque o que for hipótese ou decisão pendente).
2. Crie docs/adr/0001 a 0009 a partir da seção 16 do plano (e das decisões P12 a P16 da seção 2), no formato de ADR da skill.
3. Me mostre:
   - a estrutura do monorepo
   - o schema inicial (users, sessions e tabelas do Auth.js, mfa_recovery_codes, tenants,
     memberships, invitations, tenant_settings, audit_logs, security_events)
   - as políticas RLS e como o TenantContext será propagado (web, worker, jobs)
   - a lista de testes negativos de isolamento que vão rodar no CI
   E espere minha aprovação.

Depois de aprovado:
- Monorepo pnpm com apps/web (Next.js), apps/worker e packages/* conforme CLAUDE.md.
- Postgres local via Docker, Drizzle, migrações versionadas.
- RLS em toda tabela tenant-scoped, SET LOCAL app.tenant_id por transação.
- Login por link mágico (Auth.js, sessões no banco), TOTP obrigatório para dono e admin,
  organização ativa, convites com expiração, papéis (dono, admin, contador, atendente),
  auditoria (audit_logs) e log de segurança (security_events).
- Roteamento por subdomínio: app.<domínio> para o painel e <slug>.<domínio> para o portal.
- Seed com 2 tenants fictícios.
- GitHub Actions rodando lint, typecheck, testes e os testes de isolamento.

Regras: não avance para outro incremento; não aceite tenant_id vindo do cliente;
pare e pergunte se algo do plano estiver ambíguo.
```

## Próximas sessões (uma por vez, na ordem)

1. Clientes e documentos
2. Guias, templates e entrega automática pelo WhatsApp (precisa dos PDFs em `fixtures/guias/` e do WABA da Contact)
3. Inbox, CRM e solicitações
4. Serpro: DAS e recálculo (precisa da PoC da Serpro)
5. Honorários e portal básico (precisa da conta Asaas da Contact)

Modelo de prompt para cada uma:

```
Leia CLAUDE.md e a seção do incremento "<NOME>" em docs/plano.md.
Implemente APENAS esse incremento. Mostre o plano da tarefa e espere aprovação.
O item só está pronto quando cumprir a Definição de pronto e os critérios de aceitação citados.
```
