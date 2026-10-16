# Incremento 4 — Serpro: DAS, DCTFWeb, recálculo e pagamentos

- **Status:** aprovado e implementado no trial em 16/10/2026 (branch `feat/serpro`); produção depende do contrato
- **Período previsto:** 07/11/2026 a 23/11/2026 (P23, P24); começa antes, no ambiente trial
- **Pronto quando:** CA2 passando; disjuntor testado; guias do MEI, do Simples e da DCTFWeb geradas e entregues sozinhas no trial; isolamento de cada job e endpoint novo; definição de pronto do `CLAUDE.md`
- **Decisões que valem aqui:** ADRs 0001 a 0006; P1, P11, P22 a P25; RN1, RN2, RN8, RN11, RN16, RN17; I5
- **Base técnica:** [pesquisa do Integra Contador](../pesquisas/serpro-integra-contador.md) e respostas reais do trial gravadas em `fixtures/serpro/` (16/10/2026)

Legenda: **[plano]**, **[recomendação]** (precisa de aprovação), **[pendente]**.

## 1. Entra e não entra

**Entra:**
- **Adaptador do Integra Contador** (`packages/adapters/serpro`): trial e produção atrás da mesma interface; timeout, retentativa, disjuntor, idempotência e custo por tenant.
- **Conexões › Receita Federal** nos dois modos (P1): plataforma (contrato do Pedro + termo de autorização assinado pelo escritório) e próprio (credenciais e e-CNPJ do escritório, cifrados).
- **DAS do MEI** gerado sozinho todo mês (PGMEI).
- **DAS do Simples** gerado quando a declaração do mês aparece (PGDASD: consulta a última declaração e gera o DAS).
- **Guia da DCTFWeb** (Lucro Presumido e Real) gerada quando a declaração do mês aparece (DCTFWEB: recibo e guia), P24.
- **Recálculo** (RN2, CA2): o cliente toca "Atualizar guia" no link seguro; DAS vencido vira guia nova, a anterior vira `substituida`.
- **Confirmação de pagamento** (PAGTOWEB) com baixa automática (I5) e comprovante para o arquivo do cliente.
- Toda guia gerada entra como `publicada` (I5) e segue a entrega do incremento 3.

**Não entra:** parcelamentos, SITFIS, Caixa Postal, Sicalc, procurações automáticas, DEFIS e CCMEI (todos ficam para o "Fiscal completo"); assinatura do termo por clique (Web PKI); leitura de PDF em lote dos tipos assistidos (próximo incremento).

## 2. Como o Integra Contador funciona (confirmado no trial)

- **Chamada:** `POST {base}/{Apoiar|Consultar|Declarar|Emitir|Monitorar}` com `contratante`, `autorPedidoDados`, `contribuinte` e `pedidoDados` (`idSistema`, `idServico`, `versaoSistema`, `dados` como texto JSON).
- **Quem é quem:** contratante = CNPJ do contrato (o do Pedro no modo plataforma; o do escritório no modo próprio); autor = CNPJ do escritório (procurador); contribuinte = CNPJ do cliente.
- **Trial:** `https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1/`, token público fixo, só aceita os exemplos da documentação, com cota baixa (HTTP 429 "Message throttled out").
- **Produção:** `POST https://autenticacao.sapi.serpro.gov.br/authenticate` com consumer key/secret e o **e-CNPJ do contratante em mTLS**, devolvendo `access_token` e `jwt_token` (ambos em cada chamada, renovados ao expirar). No modo plataforma, o termo de autorização assinado pelo escritório (`AUTENTICAPROCURADOR/ENVIOXMLASSINADO81`) gera o token do procurador, que vai no cabeçalho `autenticar_procurador_token`.
- **Respostas que importam:**

| Serviço | Devolve |
| --- | --- |
| `PGMEI/GERARDASPDF21` | PDF, número do documento, vencimento, valores (principal, multa, juros, total) e composição |
| `PGMEI/GERARDASCODBARRA22` | os mesmos dados e o código de barras, sem PDF |
| `PGDASD/CONSULTIMADECREC14` | número da declaração e PDFs da declaração e do recibo (prova de que o mês foi transmitido) |
| `PGDASD/GERARDAS12` | PDF, número do documento, vencimento e valores |
| `DCTFWEB/CONSRECIBO32` | PDF do recibo (prova de transmissão) |
| `DCTFWEB/GERARGUIA31` | só o PDF da guia |
| `PAGTOWEB/PAGAMENTOS71` | pagamentos com número do documento, data, valor e receita |
| `PAGTOWEB/COMPARRECADACAO72` | PDF do comprovante |

## 3. Schema novo (migração `0004_serpro.sql`)

| Tabela | Escopo | Colunas principais | Restrições |
| --- | --- | --- | --- |
| `fiscal_connections` | tenant | `mode` (`plataforma`, `proprio`), `office_cnpj`, `status`, `term_valid_until`, `last_checked_at` | uma por escritório |
| `credentials` (existente) | tenant | novos tipos: `serpro_termo_xml`, `serpro_procurador_token`, `serpro_consumer_key`, `serpro_consumer_secret`, `serpro_certificado` | tudo cifrado (ADR 0006); certificado só no modo próprio |
| `fiscal_calls` | tenant | `company_id`, `system`, `service`, `kind` (consulta, emissão, declaração), `idempotency_key`, `status`, `http_status`, `cost_cents`, `duration_ms`, `error_code`, `created_at` | `idempotency_key` único por tenant; sem o conteúdo da resposta |
| `fiscal_watches` | tenant | `company_id`, `kind` (`das_mei`, `das_simples`, `dctfweb`), `period`, `status` (`aguardando`, `gerada`, `desistiu`), `next_check_at`, `checks` | `(tenant_id, company_id, kind, period)` único |
| `guides` (existente) | tenant | novas colunas `external_number` (número do documento na Receita) e `source_payload_hash` | `(tenant_id, external_number)` único quando preenchido |

Mudança em `tenant_settings`: `mei_generation_day` (padrão 5, S2).

## 4. Rotina automática (worker)

```text
serpro.dispatch (plataforma, a cada hora) → serpro.tenant por escritório com conexão ativa
serpro.tenant: para cada empresa ativa e competência aberta, cria ou avança um fiscal_watch
  MEI:       no dia configurado → GERARDASPDF21 → guia publicada → entrega
  Simples:   CONSULTIMADECREC14 até achar a declaração do mês → GERARDAS12 → guia → entrega
  DCTFWeb:   CONSRECIBO32 até achar o recibo do mês → GERARGUIA31 → guia → entrega
  Pagamento: PAGAMENTOS71 das guias publicadas ou vencidas → baixa (I5) + COMPARRECADACAO72
recálculo (botão do cliente): GERARDAS12 / GERARDASPDF21 com a nova data → guia nova, antiga substituida
```

- **Idempotência [plano]:** chave `(tenant, empresa, tipo, competência, vencimento)` em `fiscal_calls`; repetir não gera segunda guia nem segunda cobrança da Serpro.
- **Disjuntor [plano]:** 5 falhas seguidas em 1 minuto abrem o disjuntor por escritório; recálculos vão para a fila manual com aviso, até voltar.
- **Limite do recálculo [plano, RN2]:** 3 por guia por dia; só DAS vencido e não pago.
- **Falha:** a etapa para com o motivo visível na ficha e um alerta; nada sai para o cliente sem guia válida (RN17).

## 5. Leitura do PDF da guia

A DCTFWeb devolve só o PDF, e nenhum serviço de DAS devolve o Pix copia e cola. **[recomendação]** Ler o texto do PDF (pdf.js, sem OCR) para tirar linha digitável, Pix copia e cola e, na DCTFWeb, valor e vencimento. Os PDFs gravados do trial servem de teste. O mesmo leitor vira a base da leitura de PDF em lote do próximo incremento. Se a leitura falhar, a guia vai para revisão e não é enviada (RN17).

## 6. Telas

- **Conexões › Receita Federal:** modo, CNPJ do escritório, envio do termo assinado (XML) ou das credenciais do modo próprio, validade, botão "Testar conexão" (consulta barata) e consumo do mês.
- **Ficha da empresa:** situação da rotina fiscal do mês (aguardando declaração, guia gerada, falhou com o motivo) e botão "Buscar agora".
- **Link seguro:** botão "Atualizar guia" para DAS vencido (CA2); se a Serpro não responder em 15 s, "Estamos gerando sua guia, ela chega no WhatsApp".
- **Configurações › Entrega:** dia de geração do DAS do MEI.

## 7. Testes

- **Contrato:** o adaptador contra as respostas gravadas do trial (`fixtures/serpro/`), incluindo 429 e erro de dados.
- **Trial ao vivo (opcional, fora do CI):** um comando roda os cenários da Serpro e confere que o formato não mudou.
- **Isolamento:** conexão, chamadas, watches e guias de outro escritório dão 404; job do Alfa com empresa do Beta não chama a Serpro; credencial de um tenant não decifra no outro; o CNPJ do contribuinte sempre vem da empresa do tenant, nunca do pedido.
- **Regras:** idempotência (duplo clique não gera duas guias), disjuntor, RN2 (limite e só DAS vencido), I5 na baixa automática, RN8, leitura do PDF.
- **CA2:** DAS vencido, cliente toca "Atualizar guia", recebe a nova; a antiga vira `substituida`. Falha da Serpro por 15 s mostra o aviso e tenta 3 vezes antes de virar pedido manual.
- **E2E:** escritório no modo plataforma (trial), DAS do MEI gerado sozinho e entregue no WhatsApp simulado.

## 8. Pendências e riscos

- **[pendente] CNPJ e contrato do Pedro** para a produção (modo plataforma); até lá, modo próprio com a Contact como ponte.
- **[pendente] Termo de autorização da Contact** e procurações dos clientes no e-CAC.
- **Custo:** cada consulta da rotina custa (consulta R$ 0,24 e emissão R$ 0,32 na faixa 1, a confirmar). A frequência da consulta é decisão da seção 9.
- **Trial limitado:** aceita só os exemplos da documentação e tem cota; o comportamento real (por exemplo, `dataConsolidacao` no recálculo) só se confirma em produção.

## 9. Decisões (16/10/2026)

| # | Decisão |
| --- | --- |
| S1 | **Frequência:** uma consulta por dia útil por empresa, do dia 1 até achar a declaração do mês ou chegar o vencimento; achou, para. Mais o botão "Buscar agora" na ficha. Custo estimado de R$ 1 a 3 por empresa por mês. |
| S2 | **DAS do MEI:** gerado no dia 5 de cada mês (configurável por escritório), para a competência anterior. |
| S3 | **Leitura do PDF:** sim. Linha digitável, Pix copia e cola e, na DCTFWeb, valor e vencimento saem do texto do PDF; leitura falha vai para revisão (RN17). |

## 10. Registro da implementação (16/10/2026)

**Feito:** adaptador (trial, produção e gravado) em `packages/adapters/src/serpro`; migração `0004_serpro.sql` com rollback; rotina no worker (`@contab/core/serpro-worker`, jobs `serpro.dispatch`, `serpro.tenant`, `serpro.watch`, `serpro.recalc`, `serpro.connect`); telas Conexões › Receita Federal, situação e "Buscar agora" na ficha, "Atualizar guia" no painel e no link seguro, dia do MEI em Configurações; `pnpm serpro:trial` e `pnpm serpro:cifrar`. Testes: 30 de unidade e contrato, 26 de integração (incluindo isolamento) e 1 E2E. Os 7 serviços passam ao vivo no trial.

**O que mudou em relação ao plano:**

- Os segredos da Serpro ficam em `fiscal_credentials` (tabela nova), e não em `credentials`: a tabela do WhatsApp exige o canal.
- **S3, Pix:** o Pix copia e cola não está no texto do PDF, só na imagem do QR Code. A guia sai com a linha digitável conferida (dígitos e valor iguais ao da Receita); o Pix fica como pendência (ler o QR exige renderizar o PDF).
- **Pagamento [confirmado pelo Pedro em 16/10]:** consulta a cada 3 dias úteis e no dia útil seguinte ao vencimento, por até 30 dias (cerca de 6 consultas por guia, perto de R$ 1,50). O plano não fixava a frequência.
- **Recálculo:** a data de consolidação é hoje (ou o próximo dia útil); a guia nova vale até essa data. Recálculo só de DAS (MEI e Simples); DCTFWeb vencida segue pelo escritório.
- O E2E cobre o DAS do Simples: é o único exemplo do trial com linha digitável real. MEI e DCTFWeb do trial vêm com a linha zerada e vão para revisão (coberto nos testes de integração).
- Guia que sai da Receita mas não confere (leitura do PDF ou vínculo) fica em rascunho com alerta; o escritório confere o PDF e publica.

**Pendências:**

- **[pendente] Contrato e e-CNPJ do Pedro** para testar a produção. O transporte de produção (autenticação mTLS, token do procurador) segue a documentação, mas não foi exercitado.
- **[pendente] Modelo do termo de autorização:** hoje o escritório envia o XML já assinado; gerar o termo pronto para assinar depende de confirmar o formato na documentação da Serpro (a página estava fora do ar em 16/10).
- **[pendente] Respostas reais de "sem declaração" e "sem procuração":** a classificação usa o status e o texto; confirmar com as primeiras chamadas em produção.
- **[pendente] Comprovante com storage fora do ar:** se o PDF do comprovante não for guardado, a baixa vale e a chamada fica `falhou`, mas o comprovante não é pedido de novo sozinho. A guia (emissão) já tenta de novo e mostra o erro na rotina.
- **[pendente] Seed:** o João Fictício do Alfa nasce sem autorização de WhatsApp (sem registro em `contact_consents`), então as guias dele não saem no ambiente local; pela P25 deveria nascer autorizado.
- **Pix do QR Code** (acima) e feriados no cálculo de dia útil (hoje só fim de semana).
