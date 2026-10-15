# CLAUDE.md — Plataforma Contábil Multi-tenant

SaaS multi-tenant para escritórios de contabilidade.

**Ideia central:** o escritório publica guias, documentos e cobranças (impostos **e** honorários), e o sistema **entrega automaticamente pelo WhatsApp do próprio escritório** (Cloud API, WABA do escritório), com templates da biblioteca da plataforma, PDF, Pix e link seguro.
O **CRM interno** é a central de controle: ficha 360 de cada cliente, histórico de envios com status (entregue, lido, respondido, pago), inbox, solicitações e tarefas.
O portal com login é opcional. Muitos clientes só usam o WhatsApp.

Outras definições:
- Motor fiscal via Serpro.
- Subdomínio por escritório.
- Campanhas e automações personalizadas ficam no plano superior. A régua de entrega automática é do núcleo.
Tenant piloto: Contact Consultoria.

## Fontes da verdade
- `docs/plano.md` é o índice do plano: diz em qual arquivo de `docs/` está cada seção (1 a 16). Leia a seção relevante antes de qualquer tarefa. As seções mantêm a numeração original dentro de cada arquivo.
- `docs/incrementos/` guarda o plano de cada incremento, aprovado antes do código.
- `.claude/skills/modern-software-planning/SKILL.md` define o método de planejamento, os testes de isolamento e a definição de pronto.
- `docs/adr/` guarda as decisões de arquitetura (0001 a 0009). Não contrarie um ADR sem propor um novo.
- Se o plano estiver ambíguo ou faltar uma decisão (`docs/08-riscos-e-viabilidade.md`, "Decisões pendentes" e "Inconsistências conhecidas"), **pare e pergunte**. Não invente requisito.

## Stack (ADRs 0001–0009)
- Monorepo pnpm:
  - `apps/web`: Next.js (App Router), roda na Vercel.
  - `apps/worker`: Node, roda no Railway.
  - `packages/db`: Drizzle, migrações e RLS.
  - `packages/domain`: regras de negócio puras.
  - `packages/adapters`: Serpro, Meta, e-mail, storage, realtime.
  - `packages/auth`: autenticação.
- TypeScript estrito. Zod em toda entrada (API, webhooks, jobs, env).
- Autenticação (P13, P14, P18): Better Auth em `packages/auth`, com link mágico por e-mail (Resend, `disableSignUp`, token com hash) e sessões no banco, revogáveis. Sem senha no painel. TOTP obrigatório para dono e admin, com códigos de recuperação. O plugin de dois fatores não trava o link mágico: a trava é nossa, e o painel exige `mfaVerifiedAt` na sessão. Não use o plugin `organization` do Better Auth.
- Criptografia (P17): AWS KMS em produção; chave local só em desenvolvimento, testes e CI.
- Domínios (P16):
  - `app.<domínio>`: painel de todos os escritórios (tenant pela sessão) e webhooks em `/api/webhooks/...`;
  - `<slug>.<domínio>`: portal e links seguros (tenant pelo subdomínio);
  - cookies presos ao host (`__Host-`), nomes diferentes no painel e no portal; slugs reservados na seção 8 do plano.
- Postgres: Neon em produção, Docker no local. Fila com pg-boss. Arquivos no Cloudflare R2. Tempo real com Ably. Certificados cifrados com KMS.
- Testes:
  - Vitest para unitário e integração, com Postgres real em container.
  - Playwright para E2E.

## Regras de ouro (multi-tenant)
1. O tenant é sempre resolvido **no servidor**:
   - painel: sessão + membership;
   - portal: domínio;
   - webhook: `phone_number_id` ou domínio cadastrado;
   - job: payload validado.
   - **Nunca** aceite `tenant_id` vindo do navegador.
2. Todo acesso a dados de tenant passa por um repositório que exige `TenantContext`. Consulta sem tenant é erro.
3. Toda tabela tenant-scoped tem:
   - `tenant_id NOT NULL`;
   - RLS ativo;
   - chave composta `(tenant_id, id)` e estrangeiras compostas quando possível.
4. Use `SET LOCAL app.tenant_id` **dentro da transação**. Nunca use `SET` de sessão, porque a conexão volta para o pool.
5. Recurso de outro tenant retorna **404** sem detalhes. Toda busca por ID sem resultado vai para `security_events` (global, só inserção pelo app). Nunca fure o RLS para descobrir o dono do recurso. Ações de negócio vão para `audit_logs` (por tenant). O modo suporte grava nos dois.
6. Jobs sempre carregam `tenant_id`. Job sem tenant falha antes de executar.
7. Arquivos ficam em `tenants/{tenant_id}/...`. URL assinada de 5 min só depois da checagem de permissão.
8. Cache, canais de tempo real e índices de busca são prefixados ou filtrados por tenant.
9. Logs e Sentry recebem `tenant_id` como campo. Conteúdo de mensagens, documentos, certificados e senhas **nunca** vai para log.
10. Limites de plano ficam só em `entitlements`. Não espalhe `if (plano === ...)` pelo código.

## Integrações
- Toda integração passa por um adaptador em `packages/adapters`, com timeout, retry com backoff, idempotência e registro de custo por tenant.
- WhatsApp **somente pela Cloud API oficial**. Proibido Baileys, Evolution ou qualquer API não oficial.
  - Cada escritório usa o **próprio WABA e número**, e a plataforma só intermedia.
  - Agora a conexão é manual, pela tela Conexões › WhatsApp, com WABA ID, Phone Number ID, token e app secret. Cada tenant tem URL de webhook e verify token próprios.
  - Depois vem o Embedded Signup, quando a aprovação de Tech Provider sair. O adaptador é o mesmo.
- Serpro em **dois modos por tenant**, pela tela Conexões › Receita Federal:
  - **plataforma** (padrão): o Pedro é o contratante (software house). O escritório assina o termo de autorização (Autentica Procurador) **localmente**, no computador dele. No MVP isso é feito no Assinador do Serpro, e o sistema recebe só o XML assinado. Depois vira um clique via Web PKI. O certificado do escritório **nunca é enviado**. O consumo é medido por tenant e entra nos entitlements.
  - **próprio**: o escritório informa consumer key/secret e o e-CNPJ.
- Certificados no servidor: **só o e-CNPJ do contratante (Pedro)**, cifrado com KMS. No modo próprio, também o do escritório, como exceção.
- **Nunca** aceite nem guarde certificado de cliente do escritório. Cada cliente dá procuração eletrônica no e-CAC ao CNPJ do escritório.
- O termo assinado tem validade. Alerte antes de vencer. Com o termo vencido, ações Serpro viram `guide_request`.
- Webhooks:
  - valide a assinatura;
  - grave em `webhook_events` com ID externo único;
  - responda 200;
  - processe na fila.
- A Serpro é chamada só pelo worker. O certificado é decifrado só em memória.
- Tipos assistidos (FGTS, ICMS-MA/DARE, ISS, PGFN) **nunca** chamam API externa. "Atualizar" cria `guide_request`.

## Fluxo central (RN17)
**coletar → organizar → vincular → disponibilizar → enviar → acompanhar**
1. **Coletar:** jobs consultam Serpro e Asaas por empresa-cliente. O fluxo assistido entra por pasta, e-mail ou lote.
2. **Organizar:** cada item vira registro padronizado (guia, documento, cobrança, pendência), com o PDF no storage e os campos extraídos.
3. **Vincular:** o item é ligado à empresa-cliente pelo CNPJ (e pela IE, no ICMS) dentro do tenant. Sem vínculo, vai para revisão e nunca é enviado.
4. **Disponibilizar:** o item aparece no portal básico (lista e download) e na ficha do CRM.
5. **Enviar:** o que é do cliente sai por WhatsApp (template + PDF + link) e e-mail. O que é interno (Caixa Postal, situação fiscal) vira alerta para o escritório.
6. **Acompanhar:** entrega, leitura e pagamento atualizam a ficha, e a régua segue até o item ser pago ou substituído.

Cada etapa é um job idempotente com `tenant_id`. Uma falha para o item naquela etapa, com o motivo visível no CRM.

## Princípio: automação primeiro (RN16)
- Tudo o que a Serpro permite gerar ou consultar é **automático**. Isso inclui:
  - DAS MEI;
  - DAS Simples, gerado quando o PGDAS-D do mês é detectado;
  - recálculo;
  - parcelamentos;
  - DCTFWeb e Sicalc;
  - pagamentos;
  - situação fiscal, dívida ativa e Caixa Postal;
  - declarações para o faturamento.
- Para tipos com integração, o upload **não** é o caminho padrão. Ele só aparece como contingência, registrada.
- Tipos sem integração (ICMS-MA/DARE, FGTS, ISS, PGFN) usam o **fluxo assistido**:
  - fila do mês com dados pré-preenchidos;
  - recebimento por pasta, e-mail ou lote, com leitura e identificação automática;
  - separação de PDFs com várias guias.
- Antes de criar qualquer tela que peça trabalho manual à contadora, verifique a "Matriz de automação" (seção 4 do plano).

## Entrega, templates e honorários (núcleo)
- Só templates da `template_library`, mantida pela plataforma (categoria utilidade). Ao conectar o WABA, eles são submetidos à Meta e o status fica em `tenant_templates`. O escritório **não cria template livre**.
- Item publicado (guia, documento, honorário) dispara a entrega automática. Toda entrega passa por `deliveries`, com status e retentativa.
- Falha permanente no WhatsApp ou template pausado: o envio vai por e-mail e cria alerta no CRM.
- Link seguro:
  - token aleatório por item, guardado só como hash;
  - sem login;
  - expira em 30 dias, ou quando o item é pago ou substituído;
  - limite de acessos e registro de cada abertura.
- Honorários:
  - a cobrança é feita na conta de pagamento **do escritório** (Asaas no MVP, chave cifrada por tenant). A plataforma nunca recebe dinheiro;
  - só existe uma cobrança por `(tenant, empresa, competência)`;
  - a baixa só acontece por webhook idempotente ou manualmente, com auditoria.

## Regras de negócio críticas
Detalhes na seção 5 do plano.
- Guia com status `paga` não muda mais. DAS recalculado gera guia nova e a antiga vira `substituída`.
- Não pode haver duas guias ativas com a mesma chave `(tenant, empresa, tipo, competência)`.
- WhatsApp: texto livre só dentro da janela de 24 h. Fora dela, só template aprovado.
- Lembretes e campanhas só para contatos com opt-in ativo. O pagamento é rechecado antes de cada envio.
- Valores em centavos (`bigint`), datas em `timestamptz`, competência em `date` com dia 1, IDs em UUID v7.

## Definição de pronto
Toda tarefa precisa cumprir:
- Critérios de aceitação cobertos por teste automatizado.
- Autorização no backend e **teste negativo de isolamento** para cada endpoint ou job novo.
- Erros, timeouts e estados vazios tratados.
- Migração com rollback ou plano de recuperação. Padrão expandir → migrar → contrair.
- Funciona em 360 px e com teclado.
- `pnpm lint && pnpm typecheck && pnpm test` passando.

## Modo de trabalho
- Um incremento por sessão (seção 14 do plano). Não avance sem eu pedir.
- Antes de implementar algo grande, mostre o plano da tarefa (arquivos, schema, testes) e espere aprovação.
- Commits pequenos, em conventional commits, em português.
- Ao terminar, atualize `docs/` se alguma decisão mudou e liste as pendências.

## Comandos
```bash
corepack enable                 # ou use "corepack pnpm" no lugar de "pnpm"
pnpm install
cp .env.example .env            # e ajuste os valores
docker compose up -d --wait     # Postgres local + Mailpit (http://localhost:8025)
pnpm db:migrate                 # migrações + RLS + fila (papel owner)
pnpm db:seed                    # 2 tenants fictícios (Alfa e Beta)
pnpm storage:setup              # bucket local (SeaweedFS) e CORS do painel
pnpm dev                        # web (http://app.localhost:3000) + worker
pnpm lint && pnpm typecheck && pnpm test   # inclui os testes de isolamento
pnpm test:e2e                   # Playwright, 360 px
pnpm tenant:create --slug contact --name "Contact Consultoria" --owner-email dona@exemplo.com.br
```

## Nunca
- Commitar segredos, `.env` ou certificados.
- Usar dados reais de clientes fora de produção. Os PDFs de exemplo ficam em `fixtures/` anonimizados.
- Desabilitar RLS ou usar o papel de superusuário na aplicação.
- Pular os testes de isolamento para "ir mais rápido".
