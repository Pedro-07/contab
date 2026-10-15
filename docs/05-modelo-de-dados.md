# Modelo de dados

> Origem: Seção 9 do plano. O schema detalhado de cada incremento está em `incrementos/` (Fundação: 01; clientes e documentos: 02).

## 9. Modelo de dados preliminar

São cerca de 30 tabelas em seis grupos. Escopo **global** significa sem tenant. Escopo **tenant** significa `tenant_id NOT NULL`, RLS ativo e chave composta `(tenant_id, id)`.

| Grupo | Tabela | Escopo | Campos e restrições principais |
| --- | --- | --- | --- |
| Identidade | `users` | global | e-mail e telefone únicos; sem senha (login por link mágico); `two_factor_enabled`; TOTP obrigatório para dono e admin |
| Identidade | `accounts`, `sessions`, `verifications` | global | tabelas do Better Auth; sessão no banco, revogável, com `active_tenant_id` e `mfa_verified_at`; token do link mágico com hash |
| Identidade | `two_factors` | global | tabela do plugin de dois fatores do Better Auth: segredo TOTP e códigos de recuperação de uso único |
| Identidade | `security_events` | global | tipo, usuário, tenant ativo, recurso e ID pedido, IP, data; somente inserção pelo app, leitura só pelo operador |
| Identidade | `tenants` | global | nome, slug único, domínio, status, plano |
| Identidade | `memberships` | tenant | `(tenant_id, user_id)` único, papel |
| Identidade | `invitations` | tenant | token com hash, expira em 72 h, uso único |
| Identidade | `tenant_settings`, `entitlements`, `usage_counters` | tenant | limites do plano; contadores por mês e recurso |
| Identidade | `audit_logs` | tenant | ator, ação, recurso, IP; somente inserção |
| Escritório | `client_companies` | tenant | `(tenant_id, cnpj)` único entre as não excluídas (CNPJ numérico ou alfanumérico), regime (SN, MEI, LP, LR), status e validade da procuração, responsável no escritório |
| Escritório | `company_contacts` | tenant | contato ↔ empresa, papel (sócio, financeiro, outro), recebe envios; `(tenant_id, company_id, contact_id)` único |
| Escritório | `client_access`, `portal_sessions` | tenant | a pessoa do portal é o próprio contato (incremento 2): `client_access` liga contato ↔ empresa, `(tenant_id, contact_id, company_id)` único; `portal_sessions` guarda o hash do token e a empresa ativa |
| Escritório | `documents`, `document_versions` | tenant | pasta (categoria fixa), empresa, visível ao cliente; versões com chave no storage presa a `tenants/{tenant_id}/`, tipo, tamanho, SHA-256 e status da verificação |
| Escritório | `credentials` | tenant | tipo (termo Serpro assinado, e-CNPJ só no modo próprio, WhatsApp, e-mail), conteúdo criptografado, validade |
| Guias | `guides` | tenant | tipo, competência, vencimento, valor, linha digitável, Pix, status; único `(tenant_id, company_id, type, period)` entre as ativas |
| Guias | `guide_events` | tenant | transições de status, quem e quando |
| Guias | `guide_requests` | tenant | pedido manual (tipos assistidos), responsável, SLA |
| Guias | `installment_plans`, `installments` | tenant | parcelamento, parcelas, origem (PARCSN, PARCMEI, PGFN) |
| Guias | `fiscal_calls` | tenant | chamada Serpro, serviço, custo, status, chave de idempotência |
| Guias | `batch_uploads` | tenant | lote, arquivos, resultado da leitura, pendências |
| CRM | `contacts`, `contact_consents` | tenant | nome, telefone E.164, e-mail, canal preferido; `(tenant_id, phone)` único; opt-in por canal com histórico só de inserção (origem, quem, quando) |
| CRM | `pipelines`, `stages`, `deals` | tenant | funil, etapas ordenadas, negócio com valor, responsável, etapa |
| CRM | `tasks`, `notes`, `tags`, `custom_fields`, `custom_field_values` | tenant | campos personalizados com tipo |
| CRM | `activities` | tenant | linha do tempo unificada (mensagem, guia, documento, etapa) |
| Mensagens | `channels` | tenant | número de WhatsApp ou domínio de e-mail; `phone_number_id` único global (mapeia o webhook para o tenant) |
| Mensagens | `conversations` | tenant | contato, canal, atendente, status, início da janela de 24 h |
| Mensagens | `messages` | tenant | direção, tipo, conteúdo, anexos, status da Meta; `(tenant_id, provider_message_id)` único |
| Mensagens | `campaigns`, `campaign_recipients` | tenant | segmento, agendamento, limite de envio, status por destinatário |
| Mensagens | `automations`, `automation_runs` | tenant | gatilho, condições, ações (JSON validado); execuções com resultado |
| Plataforma | `webhook_events` | tenant | ID externo único, payload, processado em |
| Plataforma | `subscriptions`, `invoices` | tenant | plano, ciclo, status de pagamento |

**Tabelas de entrega e honorários:**

| Tabela | Escopo | Campos e restrições principais |
| --- | --- | --- |
| `template_library` | global | nome, categoria Meta, idioma, corpo, variáveis, cabeçalho (documento ou texto), botões, versão; mantida só pela plataforma |
| `tenant_templates` | tenant | template da biblioteca ↔ WABA do escritório; status na Meta, ID do template na Meta, ativo; `(tenant_id, library_id, version)` único |
| `deliveries` | tenant | item enviado (guia, documento, honorário, aviso), canal, template, status, tentativas, motivo da falha; liga à mensagem e ao contato |
| `secure_links` | tenant | hash do token, item, expira em, revogado em, contador de acessos |
| `fee_contracts` | tenant | empresa, valor em centavos, dia de vencimento, multa e juros, reajuste, ativo |
| `fee_charges` | tenant | contrato, competência, valor, vencimento, status, ID no provedor, linha digitável, Pix; `(tenant_id, company_id, period)` único |

**Regras de modelagem:**

- IDs são UUID v7, ordenáveis.
- Valores ficam em centavos (`bigint`).
- Datas ficam em `timestamptz`. Competência é `date`, sempre no dia 1.
- Exclusão é lógica (`deleted_at`) nas tabelas de negócio, com rotina de exclusão definitiva para LGPD.
- Migrações são versionadas e aplicadas no pipeline antes do deploy. Política "expandir → migrar → contrair" para mudanças compatíveis.
- Nenhum dado de produção vai para desenvolvimento. O seed usa dados fictícios.
