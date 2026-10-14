# Incremento 1 — Fundação multi-tenant

- **Status:** aprovado pelo Pedro em 14/10/2026, com as decisões P17 a P20
- **Período previsto:** 26/10/2026 a 09/11/2026 (`02-escopo-mvp-e-backlog.md`, seção 14)
- **Pronto quando:** todos os testes negativos de isolamento passando no CI, mais a definição de pronto do `CLAUDE.md`
- **Decisões que valem aqui:** ADRs 0001 a 0004, 0006 e 0007; P13 a P20

Legenda: **[plano]** vem do plano; **[recomendação]** é proposta deste documento e precisa de aprovação; **[pendente]** depende de decisão.

## 1. Entra e não entra

**Entra:**
- Monorepo, Postgres local, migrações, RLS, CI.
- Login por link mágico (Better Auth, sessões no banco), TOTP para dono e admin, códigos de recuperação.
- Organizações, membros, papéis (dono, admin, contador, atendente), troca de organização ativa.
- Convites com expiração de 72 h e uso único.
- `audit_logs` e `security_events`.
- Roteamento por host: `app.<domínio>` (painel) e `<slug>.<domínio>` (portal, só a resolução do tenant e uma página provisória).
- Seed com 2 tenants fictícios.
- **[plano, P19]** Criação de tenant por comando do operador (`pnpm tenant:create --slug ... --owner-email ...`), que cria o tenant e o convite do dono. O cadastro de escritório pela internet fica para "Portal com login e planos".

**Não entra (P20):** empresas-clientes, documentos, storage, tempo real, WhatsApp, Serpro, portal com login, `entitlements` e `usage_counters`, modo suporte do operador (só a tabela e o registro ficam prontos).

## 2. Estrutura do monorepo

```text
contab/
├─ apps/
│  ├─ web/                      Next.js (App Router), Vercel
│  │  └─ src/
│  │     ├─ app/
│  │     │  ├─ (painel)/        servido em app.<domínio>: login, MFA, organizações, membros, convites, auditoria
│  │     │  ├─ (portal)/        servido em <slug>.<domínio>: página provisória
│  │     │  └─ api/auth/[...nextauth]/
│  │     ├─ middleware.ts       só reescreve a rota pelo host; não decide tenant
│  │     └─ server/             contexto do painel e do portal, server actions
│  └─ worker/                   Node, Railway
│     └─ src/
│        ├─ index.ts            inicia o pg-boss
│        ├─ define-job.ts       envelope: valida payload, abre transação com tenant
│        └─ jobs/               Fundação: invitation.send-email
├─ packages/
│  ├─ db/                       Drizzle: schema, migrações SQL (com RLS), papéis, withTenant()
│  ├─ domain/                   regras puras: papéis e permissões, convites, último dono
│  ├─ auth/                     Better Auth (link mágico, sessões, dois fatores), guard do MFA
│  ├─ adapters/                 e-mail (Resend; SMTP do Mailpit em dev) e criptografia em envelope (local | AWS KMS)
│  └─ config/                   schema Zod das variáveis de ambiente, logger (pino)
├─ e2e/                         Playwright
├─ docker-compose.yml           Postgres 16 e Mailpit
├─ .github/workflows/ci.yml
└─ pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js
```

- **[recomendação]** Mailpit no Docker captura os e-mails de link mágico e convite em desenvolvimento e nos testes E2E, sem enviar nada de verdade.
- **[recomendação]** Uma regra de lint proíbe importar o cliente bruto do banco fora de `packages/db`.

## 3. Schema inicial

IDs em UUID v7 gerados na aplicação; datas em `timestamptz`; exclusão lógica (`deleted_at`) nas tabelas de negócio **[plano]**.

### Tabelas globais (sem `tenant_id`, sem RLS)

| Tabela | Colunas principais | Restrições |
| --- | --- | --- |
| `tenants` | `id`, `slug`, `name`, `status` (`trial`, `active`, `past_due`, `suspended`, `closed`), `plan`, `created_at`, `deleted_at` | `slug` único, minúsculo, `^[a-z0-9-]{3,40}$`, fora da lista de reservados |
| `users` | `id`, `email` (citext), `email_verified`, `name`, `image`, `phone` (E.164), `two_factor_enabled`, `created_at`, `updated_at` | `email` único; `phone` único quando preenchido; colunas exigidas pelo Better Auth mais `phone` |
| `accounts` | colunas exigidas pelo Better Auth | não usada pelo link mágico, mas exigida pela biblioteca |
| `sessions` | `id`, `token`, `user_id`, `expires_at`, `active_tenant_id`, `mfa_verified_at`, `ip_address`, `user_agent`, `created_at` | `active_tenant_id` e `mfa_verified_at` são campos adicionais nossos; revogar = apagar a linha |
| `verifications` | `id`, `identifier`, `value` (token com hash: `storeToken: "hashed"`), `expires_at` | link mágico de uso único, 15 min |
| `two_factors` | `id`, `user_id`, `secret`, `backup_codes` | tabela do plugin; 10 códigos de recuperação de uso único |
| `rate_limits` | tabela do limite de tentativas do Better Auth | guardado no banco porque a Vercel roda várias instâncias |
| `security_events` | `id`, `occurred_at`, `type`, `user_id`, `active_tenant_id`, `resource_type`, `resource_id`, `ip`, `request_id`, `details` (jsonb, sem conteúdo) | papel `app` só insere |

Tipos de `security_events`: `resource_not_found`, `forbidden`, `tenant_switch_denied`, `login_failed`, `mfa_failed`, `invitation_invalid`, `webhook_signature_invalid`, `support_mode` (os dois últimos usados nos próximos incrementos).

### Tabelas do tenant (`tenant_id NOT NULL`, RLS, chave `(tenant_id, id)`)

| Tabela | Colunas principais | Restrições |
| --- | --- | --- |
| `memberships` | `tenant_id`, `id`, `user_id`, `role` (`dono`, `admin`, `contador`, `atendente`), `created_at`, `deleted_at` | `(tenant_id, user_id)` único (sem filtro, para servir de alvo da estrangeira composta); remover marca `deleted_at`, e um novo convite reativa a mesma linha |
| `invitations` | `tenant_id`, `id`, `email`, `role`, `token_hash`, `invited_by`, `expires_at`, `accepted_at`, `accepted_by`, `revoked_at` | `token_hash` único global; expira em 72 h; uso único |
| `tenant_settings` | `tenant_id` (PK), `timezone` (padrão `America/Fortaleza`), `updated_at` | 1 para 1 com `tenants` |
| `audit_logs` | `tenant_id`, `id`, `actor_type` (`member`, `operator`, `system`), `actor_user_id`, `action`, `resource_type`, `resource_id`, `ip`, `request_id`, `metadata`, `created_at` | papel `app` só insere e lê |

Estrangeiras compostas: `invitations (tenant_id, invited_by)` → `memberships (tenant_id, user_id)`, impedindo que um convite aponte para membro de outro tenant.

### Regras de domínio da Fundação (`packages/domain`)

- **[plano]** Papéis conforme RN10.
- **[recomendação]** Dono e admin convidam; só o dono convida ou promove outro dono; não é possível remover nem rebaixar o último dono; atendente e contador não gerenciam membros.
- **[recomendação]** Trocar a organização ativa exige membership ativa; a sessão perde `mfa_verified_at` se o papel no novo tenant exigir MFA e o usuário ainda não tiver verificado.

## 4. Papéis do banco e políticas RLS

| Papel | Uso | Permissões |
| --- | --- | --- |
| `owner` | migrações (`DATABASE_MIGRATOR_URL`) | dono das tabelas |
| `app` | web e worker (`DATABASE_URL`) | `NOSUPERUSER NOBYPASSRLS`; CRUD nas tabelas de tenant; em `audit_logs` só `INSERT` e `SELECT`; em `security_events` só `INSERT` |
| `security_reader` | leitura do operador | só `SELECT` em `security_events` |

Funções auxiliares, que devolvem `NULL` quando o contexto não existe (o RLS falha fechado, sem linhas):

```sql
CREATE FUNCTION app_current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
```

O `nullif` é necessário: depois que uma transação com `SET LOCAL` termina, a conexão do pool devolve `''`, não `NULL`, e `''::uuid` daria erro.

Política padrão, aplicada a toda tabela do tenant:

```sql
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON invitations
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
```

Exceções, cada uma com teste próprio:

1. **`memberships`:** além da política padrão, o usuário lê as **próprias** memberships em qualquer tenant, para listar as organizações e trocar a ativa:
   ```sql
   CREATE POLICY own_memberships_read ON memberships FOR SELECT
     USING (user_id = app_current_user_id());
   ```
2. **Aceite de convite:** quem abre o link ainda não tem tenant. **[recomendação]** Uma função `SECURITY DEFINER` estreita, `invitation_lookup(token_hash)`, devolve só `(tenant_id, invitation_id)` de um convite válido, não expirado e não usado. O tenant vem de um segredo de 256 bits conferido no servidor, não de um `tenant_id` enviado pelo navegador. Depois disso, o aceite roda em `withTenant` normal.
3. **`audit_logs`:** políticas só para `INSERT` e `SELECT`; `UPDATE` e `DELETE` revogados do papel `app`.

## 5. Como o `TenantContext` é propagado

```ts
type TenantContext = {
  tenantId: TenantId;
  actor:
    | { type: 'member'; userId: UserId; role: Role }
    | { type: 'system'; jobName: string; jobId: string };
  requestId: string;
};
```

**Banco (`packages/db`).** `withTenant(ctx, fn)` abre a transação e executa `select set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)`. O `set_config` com `true` é o mesmo que `SET LOCAL`, mas aceita parâmetro. Os repositórios recebem um `TenantTx`, tipo que só `withTenant` produz. Sem contexto, o código não compila. Tabelas globais usam `withGlobal`, liberado só para `packages/auth` e para a resolução de tenant.

**Painel (`app.<domínio>`).** `getPainelContext()`, só no servidor:
1. lê a sessão do Better Auth (cookie `__Host-`);
2. pega `active_tenant_id` **da sessão no banco**;
3. confere a membership ativa e o papel;
4. exige `mfa_verified_at` se o papel for dono ou admin. O plugin de dois fatores do Better Auth não trava o link mágico, então essa trava é nossa: sem a marca, o painel redireciona para a tela do código, e só um código TOTP ou de recuperação válido grava `mfa_verified_at`;
5. devolve o `TenantContext`.

Nenhuma rota lê tenant de parâmetro, corpo, header ou cookie próprio. A troca de organização recebe o ID escolhido como **pedido**: o servidor confere a membership, grava na sessão e registra `tenant_switch_denied` em `security_events` quando não houver vínculo.

**Portal (`<slug>.<domínio>`).** O `middleware.ts` só reescreve a rota pelo host. No servidor, o slug é resolvido em `tenants`; slug reservado ou desconhecido responde 404. Na Fundação, o portal só mostra uma página provisória com o nome do escritório.

**Worker.** `defineJob(name, schema, handler)`. Todo schema estende `{ tenantId: uuid }`. O envelope valida o payload com Zod; payload inválido ou sem tenant falha **antes** do handler, sem retentativa. Depois, abre `withTenant` com ator `system`. O enfileiramento usa `enqueue(ctx, name, payload)`, que injeta `ctx.tenantId`, e quem chama não consegue escolher outro tenant.

**Logs.** pino com `AsyncLocalStorage`: `request_id`, `tenant_id`, `user_id` e `job_id` em toda linha. Links mágicos, tokens de convite, segredos TOTP e códigos de recuperação nunca vão para log.

**404 e `security_events`.** Toda busca por ID sem resultado num repositório do tenant lança `NotFound`. O tratador da rota responde 404 sem corpo útil e grava `resource_not_found`.

## 6. Testes negativos de isolamento no CI

Seed: tenant **Alfa** e tenant **Beta**. Usuários: dono, admin, contador e atendente de Alfa; dono de Beta; e **Duplo**, atendente em Alfa e contador em Beta.

### Banco (integração, Postgres real)
1. **Varredura do catálogo:** toda tabela com coluna `tenant_id` tem RLS ativo **e forçado** e a política `tenant_isolation`. Tabela nova sem RLS quebra o CI.
2. O papel `app` não é superusuário nem tem `BYPASSRLS`.
3. Sem contexto: `SELECT` em cada tabela do tenant devolve 0 linhas, e `INSERT` falha.
4. Com contexto Alfa: `SELECT`, `UPDATE` e `DELETE` em linhas de Beta afetam 0 linhas; `INSERT` com `tenant_id` de Beta é recusado.
5. **Reúso do pool:** com pool de tamanho 1, a transação 1 usa Alfa; a transação 2, sem contexto, na mesma conexão, não enxerga nada.
6. Estrangeira composta impede convite apontando para membro de outro tenant.
7. O papel `app` não consegue `UPDATE` nem `DELETE` em `audit_logs`, nem `SELECT` em `security_events`.
8. `own_memberships_read` mostra ao Duplo só as memberships dele, nunca as dos colegas de Beta enquanto o contexto é Alfa.
9. `invitation_lookup` com hash inexistente, expirado ou usado devolve vazio.

### Código
10. Teste de tipo: repositório chamado sem `TenantTx` não compila.
11. Lint: import do cliente bruto do banco fora de `packages/db` falha.

### HTTP e sessão
12. Usuário de Alfa pede membership, convite e registro de auditoria de Beta pelo ID (na URL e no corpo): 404, nenhum efeito no banco, uma linha em `security_events`.
13. `tenant_id` de Beta enviado em query, corpo ou header por usuário de Alfa: ignorado; a resposta é sempre sobre Alfa.
14. Troca de organização para tenant sem membership: negada, sessão inalterada, `tenant_switch_denied` registrado.
15. Duplo troca de Alfa para Beta: as listas de membros e convites mostram só Beta.
16. Convite de Alfa: cria membership só em Alfa; segundo uso, convite expirado e convite revogado são recusados.
17. Autorização: admin não convida dono; contador e atendente não convidam; o último dono não pode ser removido nem rebaixado.
18. Dono ou admin sem `mfa_verified_at` não acessa rotas do painel; código de recuperação só funciona uma vez.
19. Cookie do painel é `__Host-` e não vale em `alfa.<domínio>`; sessão do painel não autentica no portal.
20. `beta.<domínio>` resolve Beta; `app` como slug e slug desconhecido respondem 404.

### Jobs
21. Job sem `tenantId` ou com payload inválido falha antes do handler.
22. Job de Alfa tentando gravar com `tenant_id` de Beta é bloqueado pelo RLS.
23. `enqueue` não aceita tenant diferente do contexto.

### Logs
24. Linhas de log de uma requisição de Alfa trazem `tenant_id` de Alfa; link mágico, token de convite, segredo TOTP e código de recuperação nunca aparecem na saída capturada.

**[recomendação]** O teste 12 é gerado a partir da lista de rotas e cresce a cada incremento, como pede o plano. Os testes de isolamento de recursos que ainda não existem (guias, documentos, conversas, portal, URL assinada, webhook, tempo real, modo suporte) entram no incremento de cada recurso.

## 7. CI (GitHub Actions)

Em todo PR e push na `main`:
1. `pnpm install --frozen-lockfile`
2. `pnpm lint` e `pnpm typecheck`
3. Serviços: Postgres 16 e Mailpit
4. `pnpm db:migrate` com o papel `owner`; testes rodam com o papel `app`
5. `pnpm test` (unitários, integração e isolamento)
6. `pnpm test:e2e` (Playwright: login por link mágico, MFA, convite, troca de organização, em viewport de 360 px)
7. Auditoria de dependências e varredura de segredos

Todas as etapas bloqueiam o merge. O E2E em staging fica para quando o domínio provisório existir.

## 8. Pendências que afetam este incremento

- **[decidido, P17] KMS.** O adaptador de criptografia tem as implementações `local` (desenvolvimento, testes e CI) e `aws-kms`. A conta AWS e a chave são criadas até 23/11/2026, antes do primeiro dado real.
- **[a confirmar na implementação] Segredo TOTP.** A documentação do Better Auth não diz se o segredo é cifrado no banco. Se não for, ciframos com o adaptador (ADR 0007).
- **[pendente] Domínio provisório (P16).** Não bloqueia o desenvolvimento, que roda em `*.localhost`; bloqueia o staging.
