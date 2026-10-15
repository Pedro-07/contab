# Incremento 2 — Clientes e documentos

- **Status:** implementado em 15/10/2026 no branch `feat/clientes-documentos` (aprovado em 14/10/2026, com D1 a D4 e as recomendações das seções 2, 4 e 6)
- **Período previsto:** 02/11/2026 a 16/11/2026 (`02-escopo-mvp-e-backlog.md`, seção 14)
- **Pronto quando:** CA6 passando; arquivo de outro tenant inacessível; definição de pronto do `CLAUDE.md`
- **Decisões que valem aqui:** ADRs 0001 a 0004; P3, P4, P8, P16, P20; decisões D1 a D4 abaixo

Legenda: **[plano]** vem do plano; **[decidido]** foi escolhido pelo Pedro em 14/10/2026; **[recomendação]** é proposta deste documento e precisa de aprovação; **[pendente]** depende de decisão.

## 0. Decisões tomadas para este incremento (14/10/2026)

| # | Decisão |
| --- | --- |
| D1 | **CA6 sem login real do portal.** Entram agora o vínculo pessoa ↔ empresa, a sessão do portal presa ao subdomínio e a escolha da empresa ativa, com o CA6 provado em teste automático. O login por código no WhatsApp (P3) entra quando o WhatsApp for conectado ("Guias, templates e entrega"). Não se cria outra forma de login. |
| D2 | **Opt-in pela importação.** A coluna "aceita WhatsApp" (e "aceita e-mail") = sim registra o opt-in com data, origem `importacao` e quem importou, desde que quem importa marque a declaração de que o escritório tem o consentimento. O escritório é o controlador (LGPD). |
| D3 | **Permissões.** Dono, admin e contador cadastram, editam, importam e sobem documentos. O atendente vê a ficha e baixa documentos, sem alterar nada. |
| D4 | **Tipos de arquivo.** PDF, JPG e PNG, até 10 MB, com o tipo checado pelo conteúdo do arquivo. |

## 1. Entra e não entra

**Entra:**
- Empresas-clientes: cadastro, edição, inativação, lista com busca e a ficha (dados, contatos, documentos).
- Contatos (pessoas) ligados a uma ou mais empresas, com papel (sócio, financeiro, outro), canal preferido e opt-in por canal com histórico.
- Importação por CSV, com pré-visualização e relatório de erros por linha.
- Documentos por empresa, organizados em pastas (categorias), com versões; upload direto para o storage e verificação do arquivo pelo worker.
- Adaptador de storage (Cloudflare R2 em produção; SeaweedFS no Docker em dev, testes e CI).
- Portal: vínculo pessoa ↔ empresa (`client_access`), sessão do portal presa ao tenant, escolha da empresa ativa, lista e download dos documentos da empresa ativa (D1).

**Não entra:** login do portal (D1), envio automático de documento pelo WhatsApp ou e-mail (próximo incremento), guias, CRM completo (inbox, tarefas, linha do tempo), `entitlements` (P20), exportação de dados do tenant, exclusão definitiva (LGPD), domínio próprio do escritório.

## 2. Schema novo (migração `0002_clientes_documentos.sql`)

Todas as tabelas são do tenant: `tenant_id NOT NULL`, RLS com a política padrão (`tenant_isolation`), chave `(tenant_id, id)`, estrangeiras compostas, IDs UUID v7, datas em `timestamptz`, exclusão lógica **[plano]**.

| Tabela | Colunas principais | Restrições |
| --- | --- | --- |
| `client_companies` | `cnpj` (14 dígitos, sem máscara), `legal_name`, `trade_name`, `regime` (`SN`, `MEI`, `LP`, `LR`), `state_registration` (IE), `municipal_registration`, `status` (`ativa`, `inativa`), `poa_status` (procuração: `nao_verificada`, `ativa`, `vencida`), `poa_valid_until`, `responsible_user_id`, `notes`, `created_at`, `updated_at`, `deleted_at` | `(tenant_id, cnpj)` único entre as não excluídas; CNPJ com dígitos verificadores válidos; `(tenant_id, responsible_user_id)` → `memberships (tenant_id, user_id)` |
| `contacts` | `name`, `phone` (E.164), `email`, `preferred_channel` (`whatsapp`, `email`, `ambos`), `whatsapp_opt_in_at`, `email_opt_in_at`, `created_at`, `updated_at`, `deleted_at` | `(tenant_id, phone)` único quando preenchido **[plano]**; telefone ou e-mail obrigatório |
| `contact_consents` | `contact_id`, `channel` (`whatsapp`, `email`), `status` (`opt_in`, `opt_out`), `source` (`importacao`, `cadastro_manual`, …), `actor_user_id`, `occurred_at` | só inserção; os campos `*_opt_in_at` de `contacts` são o resumo, o histórico fica aqui (RN7) |
| `company_contacts` | `company_id`, `contact_id`, `role` (`socio`, `financeiro`, `outro`), `receives_deliveries` (bool), `created_at`, `deleted_at` | `(tenant_id, company_id, contact_id)` único; estrangeiras compostas para as duas pontas |
| `client_access` | `contact_id`, `company_id`, `granted_by`, `created_at`, `revoked_at` | acesso ao portal (RN9); `(tenant_id, contact_id, company_id)` único **[plano]** |
| `portal_sessions` | `token_hash`, `contact_id`, `active_company_id`, `expires_at`, `created_at`, `revoked_at` | `token_hash` único; `(tenant_id, contact_id, active_company_id)` → `client_access`; expira em 7 dias |
| `documents` | `company_id`, `category`, `title`, `visible_to_client` (padrão `true`), `created_by`, `created_at`, `deleted_at` | categoria da lista fixa abaixo |
| `document_versions` | `document_id`, `version` (1, 2, …), `storage_key`, `original_name`, `content_type`, `size_bytes`, `sha256`, `status` (`aguardando_envio`, `verificando`, `disponivel`, `rejeitado`), `rejection_reason`, `uploaded_by`, `created_at` | `(tenant_id, document_id, version)` único; `storage_key` começa com `tenants/{tenant_id}/` (CHECK) |

- **[recomendação]** O plano preliminar (seção 9) tem `portal_users` separado de `contacts`. Proponho que a pessoa do portal seja o próprio contato: o login será pelo telefone (P3), que já fica em `contacts`. Uma tabela a mais duplicaria o telefone e criaria dois cadastros da mesma pessoa. Se aprovado, atualizo `05-modelo-de-dados.md`.
- **[recomendação]** Sócios são contatos com papel `socio`. Não guardar CPF agora (minimização, LGPD): nada neste incremento precisa dele.
- **[recomendação]** Pastas = categorias fixas: `contrato_social` (contrato e alterações), `cartao_cnpj`, `alvaras_licencas`, `certidoes`, `documentos_socios`, `outros`. Pastas criadas pelo escritório ficam para depois, se pedirem.
- **[recomendação]** Mandar um arquivo novo para um documento existente cria a versão seguinte; as anteriores ficam guardadas e visíveis só no painel.

Rollback: `rollback/0002_clientes_documentos.down.sql` apaga as tabelas novas (só expansão, nada existente muda).

## 3. Regras de domínio (`packages/domain`)

- CNPJ: só dígitos, 14 posições, dígitos verificadores válidos; aceita a entrada com máscara e normaliza. **[recomendação]** Já aceitar o CNPJ alfanumérico da Receita (válido a partir de julho de 2026) na validação.
- Telefone: normaliza para E.164; número brasileiro sem DDI ganha `+55`.
- Permissões (D3): `canEditClients(role)` e `canUploadDocuments(role)` para dono, admin e contador; `canViewClients(role)` para todos.
- Arquivo (D4): aceita PDF (`%PDF-`), JPEG (`FF D8 FF`) e PNG (`89 50 4E 47 0D 0A 1A 0A`) pela assinatura dos primeiros bytes; até 10 MB.

## 4. Storage (`packages/adapters/storage`)

- **[plano]** Bucket privado; chave `tenants/{tenant_id}/companies/{company_id}/documents/{document_id}/v{n}`; URL assinada de 5 min, gerada só depois da checagem de permissão.
- **[recomendação]** SDK S3 da AWS (`@aws-sdk/client-s3` e o assinador de URL), que funciona com R2 e SeaweedFS. O adaptador recebe o `TenantContext` e monta a chave; uma chave fora de `tenants/{tenant do contexto}/` é recusada antes de chegar ao storage.
- **[recomendação] Upload direto do navegador para o storage.** A Vercel limita o corpo da requisição a cerca de 4,5 MB, menos que os 10 MB permitidos. O fluxo:
  1. o painel pede o envio (server action): checa papel, empresa, tamanho e tipo declarados; cria a versão `aguardando_envio`; devolve uma URL assinada de PUT válida por 5 min;
  2. o navegador envia o arquivo direto ao storage;
  3. o painel confirma; o servidor enfileira o job `document.verify` (com `tenant_id`);
  4. o worker confere o tamanho real, a assinatura dos primeiros bytes e calcula o SHA-256. Se estiver tudo certo, marca `disponivel`; se não, marca `rejeitado` com o motivo e apaga o objeto.
- Download: server action checa a permissão e gera uma URL assinada de GET de 5 min, com `Content-Disposition: attachment`.
- **Local e CI:** SeaweedFS (S3) no `docker-compose.yml`; o bucket e a regra de CORS são criados pela preparação dos testes e por `pnpm storage:setup`. O nome de download vai gravado no objeto no envio, porque o SeaweedFS ignora o nome pedido na URL de download. **Produção:** bucket R2 privado, CORS liberando PUT só para `https://app.<domínio>`; passo a passo no runbook (`10-deploy-e-operacao.md`).

## 5. Importação por CSV

- **Arquivo:** uma linha por contato; CNPJ repetido junta os contatos na mesma empresa. Colunas: `cnpj`, `razao_social`, `nome_fantasia`, `regime`, `inscricao_estadual`, `contato_nome`, `contato_telefone`, `contato_email`, `contato_papel`, `canal_preferido`, `aceita_whatsapp`, `aceita_email`, `recebe_envios`, `acesso_portal`. Modelo para baixar na própria tela.
- **[recomendação]** Aceitar separador `;` ou `,` e arquivos salvos pelo Excel em português (Windows-1252), além de UTF-8. Limite de 1 MB e 2.000 linhas.
- **Fluxo:** enviar o arquivo → pré-visualização com o total de empresas e contatos novos e atualizados, e os erros por linha → confirmar.
- **[recomendação]** Linhas com erro não entram; as válidas entram numa única transação. CNPJ que já existe atualiza os dados da empresa; contato é reconhecido pelo telefone (ou pelo e-mail, se não houver telefone). Importar o mesmo arquivo duas vezes não duplica nada.
- **Opt-in (D2):** só é aplicado se a declaração estiver marcada na tela de confirmação; cada opt-in gera uma linha em `contact_consents` com origem `importacao`.
- O CSV é lido no servidor e não é guardado. A auditoria registra quem importou, quando e os totais, sem o conteúdo.

## 6. Telas

**Painel (`app.`):**
- **Clientes:** lista com busca por nome ou CNPJ, filtro por status e regime, paginação; botões "Nova empresa" e "Importar CSV" (só para quem pode editar).
- **Ficha da empresa:** dados cadastrais, procuração, responsável no escritório; contatos (papel, canal, opt-in, recebe envios, acesso ao portal); documentos por pasta, com envio, versões e download.
- **Contato:** dados, empresas vinculadas e histórico de consentimento.
- Item novo no menu: Clientes.

**Portal (`<slug>.`), D1:**
- Sem sessão: "Entre pelo link que o escritório enviou no seu WhatsApp".
- Com sessão: escolha da empresa (se houver mais de uma), troca de empresa, lista de documentos visíveis da empresa ativa por pasta, download.
- **[recomendação]** Para ver o portal no navegador antes do login por WhatsApp: um comando só de desenvolvimento, `pnpm portal:dev-login --slug alfa --phone ...`, que imprime um link de uso único válido por 10 min. O comando e a rota que ele usa recusam funcionar com `APP_ENV` `staging` ou `production`, e há teste para isso. O E2E usa o mesmo caminho.

Tudo funciona em 360 px e com teclado.

## 7. Casos de uso (`packages/core`)

`createCompany`, `updateCompany`, `setCompanyStatus`, `previewCsvImport`, `applyCsvImport`, `upsertContact`, `linkContact`, `unlinkContact`, `recordConsent`, `grantPortalAccess`, `revokePortalAccess`, `requestDocumentUpload`, `confirmDocumentUpload`, `getDocumentDownloadUrl`, `deleteDocument`; no portal, `openPortalSession`, `switchPortalCompany`, `listPortalDocuments` e `getPortalDocumentDownloadUrl`.

Todos recebem `TenantContext`, checam a permissão no servidor, gravam em `audit_logs` as ações de negócio e, em busca por ID sem resultado, gravam em `security_events` e respondem 404.

## 8. Testes

**Isolamento (Vitest, Postgres e SeaweedFS reais), bloqueiam o merge:**
1. Usuário do Alfa lê, edita e exclui empresa, contato e documento do Beta pelo ID: 404, nenhum efeito no banco, evento em `security_events`.
2. O mesmo CNPJ existe no Alfa e no Beta sem conflito; importar no Alfa nunca altera o Beta.
3. URL assinada de documento do Beta nunca é gerada para usuário do Alfa; a URL gerada expira em 5 min (`X-Amz-Expires=300`).
4. O adaptador recusa chave fora de `tenants/{tenant do contexto}/`; o objeto do Beta não é lido nem apagado por ação do Alfa.
5. Job `document.verify` com tenant errado não acha a versão e não toca no objeto.
6. **CA6:** João, contato da Padaria e da Loja, escolhe a empresa no portal; com a Padaria ativa, a lista e o download de documento da Loja respondem 404, e vice-versa.
7. Contato sem `client_access` para a empresa não consegue torná-la ativa; acesso revogado derruba a empresa ativa da sessão.
8. Sessão do portal do Alfa usada no host do Beta é rejeitada.
9. Atendente tenta criar empresa, importar e subir documento: negado no servidor, com evento `forbidden`.
10. Nenhum log contém conteúdo de documento, CSV, telefone ou e-mail.

**Regras e casos de uso:** CNPJ (válidos, inválidos, com máscara, alfanumérico), telefone, CSV (separadores, Windows-1252, CNPJ repetido, linha inválida, segunda importação sem duplicar, opt-in só com a declaração), arquivo com extensão PDF e conteúdo PNG rejeitado, arquivo acima de 10 MB rejeitado, versão nova preservando a anterior.

**E2E (Playwright, 360 px):** contador importa um CSV → abre a ficha → envia um PDF → o documento fica disponível → `portal:dev-login` do João → escolhe a Padaria → vê e baixa o PDF → troca para a Loja → o PDF da Padaria some.

## 9. Arquivos

```text
packages/db/migrations/0002_clientes_documentos.sql      tabelas, RLS, grants
packages/db/rollback/0002_clientes_documentos.down.sql
packages/db/src/schema/clients.ts, documents.ts, portal.ts
packages/db/src/repositories/companies.ts, contacts.ts, documents.ts, portal-sessions.ts
packages/db/src/seed-data.ts                              empresas e contatos fictícios (João em duas empresas do Alfa)
packages/domain/src/cnpj.ts, phone.ts, files.ts, roles.ts (permissões novas)
packages/adapters/src/storage/index.ts                    S3/R2/SeaweedFS, chave presa ao tenant
packages/core/src/companies.ts, contacts.ts, csv-import.ts, documents.ts, portal.ts
apps/worker/src/jobs/document-verify.ts
apps/worker/src/cli/portal-dev-login.ts
apps/web/src/app/painel/(protegido)/clientes/...          lista, nova, importar, [id] (ficha), contatos
apps/web/src/app/portal/[slug]/...                        escolha de empresa, documentos, entrada de dev
apps/web/src/server/portal.ts                             sessão do portal pelo host
packages/config/src/env.ts                                variáveis do storage
docker-compose.yml                                        SeaweedFS
tests/integration/clientes.test.ts, documentos.test.ts, portal.test.ts, csv.test.ts
e2e/tests/clientes-documentos.spec.ts
fixtures/csv/clientes-exemplo.csv                         dados fictícios
docs/05-modelo-de-dados.md, docs/10-deploy-e-operacao.md  ajustes (portal_users, R2)
```

## 10. Pendências e riscos

- **[pendente] Lista de clientes da Contact** (já está em "Decisões pendentes"): o formato do CSV acima é proposto sem ver a planilha real. Se ela tiver outro formato, ajusto o modelo de importação.
- **Bucket R2 e domínio de staging:** só são necessários para o deploy em staging; o desenvolvimento e o CI usam SeaweedFS.
- **Risco:** a rota de entrada de desenvolvimento do portal (seção 6) é uma porta de entrada sem login. A mitigação é a trava por `APP_ENV` com teste automático; ela é removida quando o login por WhatsApp chegar.

## 11. Execução (registro da implementação)

- **SeaweedFS no lugar do MinIO (14/10/2026).** A imagem `minio/minio` não está mais disponível no Docker Hub nem no quay.io sem login. O SeaweedFS é compatível com S3, confere a assinatura das URLs e aplica regra de CORS por bucket, como o R2. Em produção nada muda (R2).
- **Sem `current_version_id` em `documents`.** A versão atual é a maior versão `disponivel`. Assim não existe estrangeira circular entre as duas tabelas, e uma versão recusada nunca vira a atual.
- **Nome de download gravado no objeto.** O SeaweedFS ignora o `response-content-disposition` da URL de GET. A URL de envio passou a assinar também o `content-disposition`, e o navegador manda os cabeçalhos devolvidos pelo servidor. Funciona igual no R2.
- **Ator `contact` no `TenantContext`** e o valor `contact` em `audit_actor_type`, para as ações da pessoa do portal.
- **Server actions com até 2 MB** (`next.config.ts`), para caber o CSV de 1 MB com o envelope do formulário.
- **Verificação:** 171 testes Vitest (unitários, integração e isolamento, incluindo os 10 da seção 8) e 8 E2E em 360 px, todos verdes em 15/10/2026.

### Pendências

- Lista de clientes real da Contact, para conferir o formato do CSV (seção 10).
- Bucket R2 e regra de CORS em staging e produção (runbook em `10-deploy-e-operacao.md`).
- A entrada de desenvolvimento do portal (`/entrar-dev/...` e `pnpm portal:dev-login`) sai quando o login por código no WhatsApp chegar.
- Versões com envio não concluído (`aguardando_envio`) ficam guardadas; uma limpeza periódica pode entrar com a rotina de retenção (LGPD).
