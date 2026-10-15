# Incremento 3 — Guias, templates e entrega

- **Status:** aprovado pelo Pedro em 15/10/2026, com as recomendações 1, 3 a 7 e a P25 no lugar da recomendação 2
- **Período previsto:** 16/10/2026 a 06/11/2026 (P23, `02-escopo-mvp-e-backlog.md`, seção 14)
- **Pronto quando:** CA7 e CA9 passando; testes negativos de isolamento de cada endpoint, webhook e job novos; definição de pronto do `CLAUDE.md`
- **Decisões que valem aqui:** ADRs 0001 a 0008; P2, P3, P8, P9, P21 a P24; I2, I3 e I5 (resolvidas em 15/10/2026); RN1, RN5 a RN8, RN12 a RN14, RN17

Legenda: **[plano]** vem do plano ou de decisão já tomada; **[recomendação]** é proposta deste documento e precisa de aprovação; **[pendente]** depende de algo externo.

## 1. Entra e não entra

**Entra:**
- **Conexões › WhatsApp** (conexão manual, P2): WABA ID, Phone Number ID, token e app secret, cifrados; teste da conexão; URL de webhook secreta e verify token por conexão (I2).
- **Biblioteca de templates** da plataforma e submissão automática ao WABA do escritório, com o status de aprovação acompanhado (P9, I3).
- **Guias:** cadastro, status (RN1 com I5), unicidade da guia ativa (RN5) e **envio avulso** com PDF, valor, vencimento, linha digitável e Pix (contingência do marco, P23).
- **Entrega automática** (RN13): guia ou documento publicado gera envio pelo canal preferido de cada contato que recebe envios, com status (enfileirado, enviado, entregue, lido, falhou).
- **Régua do núcleo:** publicação, lembrete antes do vencimento, aviso de vencida e pagamento confirmado; horário e antecedência configuráveis por escritório.
- **Link seguro** (RN14) no subdomínio do escritório: Pix (com QR), linha digitável e PDF, sem login.
- **Baixa manual** de pagamento, auditada (a automática vem com a Serpro).
- **Opt-out por "SAIR"** no WhatsApp e por link no e-mail (RN7).
- **Login do portal por código no WhatsApp** (P3, D1 do incremento 2).
- **Alertas internos** mínimos (CA9: template pausado, falha permanente, guia substituída paga).

**Não entra:** Serpro (incremento seguinte, P23 e P24), leitura de PDF em lote (depois do marco), inbox e conversas (texto livre na janela de 24 h, RN6), honorários, campanhas, Embedded Signup (depende da aprovação de Tech Provider), domínio de e-mail próprio do escritório.

## 2. Como a entrega funciona

```text
guia publicada (ou documento marcado "enviar ao cliente")
  └─ job delivery.plan (tenant do payload)
       └─ para cada contato da empresa com "recebe envios":
            ├─ WhatsApp, se o canal preferido inclui WhatsApp, há opt-in e o template está aprovado
            ├─ e-mail, se o canal preferido inclui e-mail (ou como desvio, abaixo)
            └─ grava uma linha em deliveries por canal → job delivery.send
                 ├─ sucesso: status "enviado"; o webhook da Meta atualiza para entregue e lido
                 ├─ erro temporário: até 5 tentativas com backoff
                 └─ erro permanente ou template pausado: desvia para e-mail e cria alerta (CA9)
régua (job a cada 15 min por escritório): lembrete, vencida e pago, sempre conferindo o status
da guia imediatamente antes de enviar (RN8)
```

- **[recomendação] Anexo pelo WhatsApp:** o PDF é enviado antes à Meta (upload de mídia da Cloud API) e o template usa o ID da mídia. Assim, nenhum link público do arquivo vai para a Meta.
- **Opt-in (P25):** o contato nasce autorizado em cada canal que tem; o escritório responde por informar o cliente. Desmarcado ou com opt-out, não sai nada naquele canal. Na importação, "não" nas colunas de autorização desmarca; a declaração da tela de importação (D2) sai.
- **[recomendação] Remetente do e-mail:** domínio da plataforma, com o nome do escritório no remetente ("Contact Consultoria") e responder-para o e-mail do escritório. Domínio próprio do escritório (DKIM e SPF) fica para depois.
- **Idempotência:** chave `(tenant, item, contato, canal, gatilho)` em `deliveries`; um job repetido não envia duas vezes.

## 3. Schema novo (migração `0003_guias_entrega.sql`)

Tabelas do tenant com `tenant_id NOT NULL`, RLS padrão, chave `(tenant_id, id)` e estrangeiras compostas **[plano]**. Valores em centavos (`bigint`), competência em `date` com dia 1.

| Tabela | Escopo | Colunas principais | Restrições |
| --- | --- | --- | --- |
| `channels` | tenant | `kind` (`whatsapp`), `waba_id`, `phone_number_id`, `display_phone`, `verified_name`, `quality_rating`, `status` (`pendente`, `ativo`, `erro`, `desconectado`), `webhook_key_hash`, `verify_token_hash`, `last_checked_at` | `phone_number_id` único **global** (mapeia o webhook, I2) |
| `credentials` | tenant | `channel_id`, `kind` (`whatsapp_token`, `whatsapp_app_secret`), `ciphertext` (envelope com o tenant como dado autenticado, ADR 0006), `rotated_at` | o app nunca devolve o segredo à tela; só o worker e o webhook decifram |
| `template_library` | **global** | `key`, `version`, `language`, `category` (`UTILITY`, `AUTHENTICATION`), `header` (`document` ou nenhum), `body`, `variables`, `buttons`, `active` | `(key, version, language)` único; o app só lê |
| `tenant_templates` | tenant | `library_id`, `channel_id`, `meta_template_id`, `meta_name`, `status` (`enviado`, `aprovado`, `rejeitado`, `pausado`, `desativado`), `reason`, `enabled` | `(tenant_id, channel_id, library_id)` único |
| `guides` | tenant | `company_id`, `type` (`das_simples`, `das_mei`, `dctfweb`, `darf`, `icms`, `iss`, `fgts`, `pgfn`, `outro`), `period`, `due_date`, `amount_cents`, `barcode`, `pix_code`, `status` (`rascunho`, `publicada`, `vencida`, `paga`, `substituida`, `cancelada`), `source` (`avulsa`, `serpro`, `lote`), `replaces_guide_id`, `pdf_storage_key`, `pdf_sha256`, `paid_at`, `published_at` | **RN5:** único `(tenant_id, company_id, type, period)` entre `rascunho`, `publicada` e `vencida`; chave do PDF sob `tenants/{tenant_id}/` |
| `guide_events` | tenant | `guide_id`, `from_status`, `to_status`, `actor_type`, `actor_user_id`, `reason`, `created_at` | só inserção |
| `deliveries` | tenant | `item_type` (`guia`, `documento`), `item_id`, `company_id`, `contact_id`, `channel` (`whatsapp`, `email`), `trigger` (`publicacao`, `lembrete`, `vencida`, `pago`), `template_key`, `status` (`enfileirado`, `enviado`, `entregue`, `lido`, `falhou`, `cancelado`), `attempts`, `provider_message_id`, `failure_reason`, `fallback_of` | idempotência `(tenant_id, item_id, contact_id, channel, trigger)`; `provider_message_id` único |
| `secure_links` | tenant | `token_hash`, `item_type`, `item_id`, `expires_at`, `revoked_at`, `access_count`, `max_accesses` (padrão 50) | `token_hash` único global; expira em 30 dias ou quando a guia é paga ou substituída (RN14) |
| `secure_link_accesses` | tenant | `link_id`, `opened_at`, `ip` | só inserção ("registro de cada abertura", RN14) |
| `webhook_events` | tenant | `provider` (`meta`), `external_id`, `kind`, `payload`, `received_at`, `processed_at`, `error` | `(provider, external_id)` único; retenção de 30 dias **[recomendação]** |
| `portal_login_codes` | tenant | `contact_id`, `code_hash`, `expires_at` (5 min), `attempts`, `used_at` | 5 tentativas; limite por telefone e por IP |
| `tenant_alerts` | tenant | `kind`, `message`, `resource_type`, `resource_id`, `created_at`, `resolved_at` | mostrados no início do painel |

Mudanças em tabelas existentes (só expansão): `tenant_settings` ganha `reminder_days_before` (padrão 3) e `delivery_hour` (padrão 9); `documents` ganha `send_to_client` (padrão `false`).

Rollback: `rollback/0003_guias_entrega.down.sql`.

## 4. Regras de domínio (`packages/domain`)

- **RN1 com I5:** máquina de estados da guia. `rascunho → publicada → vencida → substituida`, `publicada → cancelada`, e pagamento confirmado leva qualquer guia não cancelada a `paga`; se a paga era substituída, a ativa que a substituiu vira `cancelada`. `paga` é final.
- **Régua:** calcula, no fuso do escritório, quando cabe lembrete (`due_date − reminder_days_before`, no `delivery_hour`) e aviso de vencida (dia seguinte ao vencimento).
- **Templates:** definição da biblioteca em código (`packages/domain/src/templates.ts`), com variáveis tipadas; a migração e o comando `pnpm templates:sync` gravam em `template_library`. Ajustes do escritório: só nome e assinatura.
- **Escolha de canal:** função pura que recebe contato, opt-ins, status do template e gatilho e devolve os canais (e o desvio para e-mail).

**Templates iniciais deste incremento** (categoria utilidade, pt_BR): `guia_disponivel` (PDF anexo, valor, vencimento, botão do link seguro), `lembrete_vencimento`, `guia_vencida` (botão do link seguro), `pagamento_confirmado`, `documento_disponivel` (PDF anexo); e `codigo_acesso` (autenticação, login do portal). Os demais da lista do plano entram com os incrementos que os usam.

## 5. Adaptador do WhatsApp (`packages/adapters/whatsapp`)

Cloud API oficial (ADR 0005), versão da Graph API fixada em configuração, timeout de 10 s, retentativa com backoff só em erro temporário, custo registrado por tenant (contagem de mensagens por tipo; o valor real vem da Meta).

- `verifyConnection`: lê o número (nome verificado, qualidade).
- `uploadMedia` e `sendTemplate`: anexo pela mídia da Meta; a chave de idempotência é o ID da entrega.
- `submitTemplate` e `getTemplateStatus`.
- `verifySignature`: `X-Hub-Signature-256` com o app secret da conexão, em tempo constante.
- **[recomendação] Implementação falsa** (`WHATSAPP_PROVIDER=fake`) para desenvolvimento, testes e CI: guarda as mensagens em memória ou no banco de teste e simula os status da Meta. O teste com a Meta de verdade usa o número de teste do app de desenvolvedor do Pedro.

## 6. Webhook (I2)

- **Conexão manual:** `app.<domínio>/api/webhooks/whatsapp/{chave}`, com a chave aleatória da conexão (só o hash fica no banco). O GET responde ao desafio da Meta conferindo o verify token; o POST confere a assinatura com o app secret daquela conexão.
- **Embedded Signup (depois):** `app.<domínio>/api/webhooks/whatsapp`, com o tenant identificado pelo `phone_number_id`.
- Nos dois: o `phone_number_id` do payload precisa ser da conexão; senão, 200 sem processar e `security_events` (`webhook_signature_invalid` ou tenant divergente). Grava em `webhook_events` com o ID externo único, responde 200 e processa na fila.
- Processa: status das mensagens (entregue, lido, falhou), mudança de status de template (pausado ou rejeitado vira alerta) e mensagem recebida só para o opt-out "SAIR". O texto das mensagens não vai para log.

## 7. Telas

**Painel:**
- **Conexões › WhatsApp** (dono e admin **[recomendação]**): formulário da conexão, botão "Testar conexão", URL do webhook e verify token mostrados uma vez, status dos templates por tipo.
- **Guias:** lista com filtros (empresa, tipo, competência, status), nova guia avulsa (com o mesmo envio direto do PDF ao storage do incremento 2), publicar, marcar como paga (com motivo, auditado), cancelar; na guia, a linha do tempo dos envios por contato e canal.
- **Ficha da empresa:** aba de guias e o histórico de envios.
- **Documentos:** opção "enviar ao cliente" ao subir.
- **Configurações › Entrega:** antecedência do lembrete e horário de envio.
- **Início:** alertas abertos.

**Portal (`<slug>.`):**
- **Link seguro** `/g/{token}`: empresa, tipo, competência, valor, vencimento, linha digitável (copiar), Pix copia e cola com QR, baixar PDF; mensagens claras para link expirado, guia paga ou substituída.
- **Entrar:** telefone → código no WhatsApp → escolha da empresa (CA6 já pronto). A resposta nunca revela se o telefone existe.
- **[recomendação]** A entrada de desenvolvimento (`/entrar-dev`) continua, travada em `development` e `test`, porque o E2E depende dela.

Tudo em 360 px e com teclado.

## 8. Jobs (worker)

| Job | Payload | O que faz |
| --- | --- | --- |
| `delivery.plan` | `tenantId`, item | cria as linhas de `deliveries` por contato e canal |
| `delivery.send` | `tenantId`, `deliveryId` | confere RN8 e opt-in na hora, envia, trata erro e desvio |
| `regua.tenant` | `tenantId` | lembretes, vencidas (marca `vencida`) e reenvios agendados do escritório |
| `regua.dispatch` | — | **[recomendação]** job da plataforma a cada 15 min: só lista os escritórios ativos (tabela global) e enfileira um `regua.tenant` por escritório. Não acessa dado de tenant; é a exceção documentada à regra 6 |
| `webhook.meta.process` | `tenantId`, `eventId` | aplica status, alertas e opt-out |
| `templates.sync` | `tenantId`, `channelId` | submete a biblioteca e atualiza o status |

## 9. Testes

**Isolamento (bloqueiam o merge):**
1. Guia, entrega, conexão, template, alerta e link do Beta: o Alfa recebe 404 e nada muda no banco; evento em `security_events`.
2. Link seguro do Alfa aberto no host do Beta: 404.
3. Webhook com `phone_number_id` do Alfa na URL de conexão do Beta: recusado, nada gravado no Beta, evento registrado; assinatura inválida também.
4. Jobs `delivery.*`, `regua.tenant` e `webhook.meta.process` com tenant errado não acham nem enviam nada.
5. `regua.dispatch` não lê nenhuma tabela de tenant (teste de permissão do papel usado).
6. Segredos (token e app secret) nunca voltam para a tela nem aparecem em log; o ciphertext de um tenant não decifra no contexto de outro.
7. Login do portal: código de um escritório não vale em outro; telefone de outro escritório não recebe código.

**Regras:** RN1 com I5 (todas as transições), RN5, RN8 (guia paga não recebe lembrete), RN7 (sem opt-in não sai WhatsApp; SAIR desliga na hora), RN14 (expiração, limite de acessos, guia paga ou substituída), régua no fuso do escritório, escolha de canal, idempotência das entregas e dos webhooks.

**Critérios de aceitação:**
- **CA7:** guia avulsa publicada para a Padaria → em até 2 min o contato recebe o template com PDF, Pix e link (adaptador falso); status vai a entregue e depois lido pelos webhooks simulados.
- **CA9:** template pausado pela Meta (webhook simulado) → o lembrete sai por e-mail e o alerta aparece no painel.

**E2E (360 px):** conectar o WhatsApp (adaptador falso), publicar guia avulsa, ver a entrega na linha do tempo, abrir o link seguro, marcar como paga e ver o "pagamento confirmado"; login no portal com código.

## 10. Arquivos

```text
packages/db/migrations/0003_guias_entrega.sql (+ rollback)
packages/db/src/schema/channels.ts, guides.ts, deliveries.ts
packages/db/src/repositories/channels.ts, templates.ts, guides.ts, deliveries.ts, secure-links.ts, webhook-events.ts, alerts.ts, portal-login.ts
packages/domain/src/guides.ts, regua.ts, templates.ts, channels.ts
packages/adapters/src/whatsapp/ (cloud-api.ts, fake.ts, signature.ts)
packages/adapters/src/email/ (anexos)
packages/core/src/channels.ts, guides.ts, deliveries.ts, regua.ts, secure-links.ts, webhooks.ts, portal-login.ts, alerts.ts
apps/worker/src/jobs/ (delivery, regua, webhook, templates) e cli/templates-sync.ts
apps/web/src/app/api/webhooks/whatsapp/...
apps/web/src/app/painel/(protegido)/conexoes, guias, configuracoes
apps/web/src/app/portal/[slug]/g/[token], entrar
tests/integration/guias.test.ts, entregas.test.ts, webhooks.test.ts, links.test.ts, portal-login.test.ts
e2e/tests/guias-entrega.spec.ts
```

## 11. Pendências e riscos

- **[pendente] App de desenvolvedor na Meta** com número de teste, para validar o adaptador real (o CI usa o falso).
- **[pendente] Meta Business da Contact** verificado e WABA conectado, para o piloto.
- **Templates na Meta:** a aprovação pode levar de horas a dias e textos podem ser rejeitados. Mitigação: textos de utilidade sem promoção e variações de reserva (R11).
- **Prazo:** é o maior incremento até aqui. Se apertar, o login do portal por código vai para logo depois do marco, porque o link seguro já cobre o caso principal (P22).
