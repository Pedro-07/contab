# Requisitos e regras de negócio

> Origem: Seções 4, 5 e 6 do plano.

## 4. Módulos e requisitos funcionais

O sistema é dividido em nove módulos, com fronteiras claras dentro do mesmo código. A coluna Fase indica quando cada módulo entra.

| Módulo | O que faz | Fase |
| --- | --- | --- |
| Identidade e organizações | Login, organizações, membros, convites, papéis, troca de organização ativa, auditoria | MVP |
| Empresas-clientes | Cadastro (CNPJ, regime, sócios, contatos, canal preferido, opt-in), procuração e status | MVP |
| Documentos | Pastas por empresa, upload, versões, categorias e envio automático ao cliente | MVP |
| Guias | Guias por competência e tipo, geradas automaticamente pela Serpro quando há API; envio em lote com leitura de PDF só para o resto, status, Pix e código de barras, recálculo, fila manual | MVP |
| Entrega e templates | Biblioteca de templates da plataforma, régua automática, envio pelo WhatsApp do escritório com PDF e link seguro, cópia por e-mail, status de cada envio | MVP |
| Honorários | Contrato por cliente, boleto e Pix mensais na conta do escritório, régua de cobrança, baixa por webhook, recibo | MVP |
| Fiscal (Serpro) | DAS do Simples e do MEI, recálculo, pagamentos; depois parcelamentos, DCTFWeb, situação fiscal, dívida ativa e declaração de faturamento | MVP + depois |
| CRM e inbox | Ficha 360, histórico de envios, conversas em tempo real, solicitações, funis de processos, tarefas | MVP |
| Portal do cliente | Links seguros e portal básico com login, lista e download de tudo (MVP); recursos avançados (depois) | MVP + depois |
| Campanhas e automações personalizadas | Disparos segmentados e regras próprias do escritório | Depois (plano superior) |
| Plataforma | Planos, limites, medição de uso, cobrança da assinatura, modo suporte auditado | Depois |

### Fluxo central do sistema

O sistema trabalha numa ordem fixa: **coletar → organizar → vincular ao cliente certo → disponibilizar → enviar → acompanhar**. Nada chega ao cliente antes de estar guardado e vinculado.

1. **Coletar.** Rotinas agendadas e gatilhos consultam as APIs para cada empresa-cliente: guias, declarações, parcelamentos, pagamentos, situação fiscal, Caixa Postal (Serpro) e honorários (Asaas). Os arquivos do fluxo assistido entram por pasta, e-mail ou lote.
2. **Organizar e guardar.** Tudo vira registro padronizado (guia, documento, cobrança, pendência ou mensagem da Receita), com o PDF no armazenamento e com valor, vencimento, linha digitável e Pix extraídos.
3. **Vincular.** Cada item é ligado à empresa-cliente certa pelo CNPJ (e pela inscrição estadual, no ICMS), sempre dentro do tenant. O que não casar vai para revisão e nunca é enviado.
4. **Disponibilizar.** O item vinculado aparece no portal do cliente, pronto para ver e baixar, e na ficha da empresa no CRM.
5. **Enviar.** O que pode ir ao cliente (guias, documentos, honorários, declarações) sai pelo WhatsApp do escritório, com template, PDF e link, e cópia por e-mail. O que é só para o escritório (Caixa Postal, situação fiscal, débitos) vira alerta interno, e o escritório decide se avisa o cliente.
6. **Acompanhar.** Entrega, leitura, resposta e pagamento atualizam a ficha. A régua segue até o item ser pago ou substituído.

Cada etapa é um job idempotente com `tenant_id`. Se uma etapa falhar, o item para ali com o motivo visível no CRM, sem duplicar envios.

### Matriz de automação

A regra é tirar a contadora do caminho sempre que existir integração. Onde não existe, o sistema prepara tudo e ela só faz o passo que a lei ou o órgão exige.

| Item | Como entra no sistema | Trabalho da contadora |
| --- | --- | --- |
| DAS MEI | Serpro gera todo mês, sozinho | Nenhum |
| DAS Simples | O sistema monitora pela Serpro a declaração do mês (PGDAS-D). Assim que ela é transmitida, gera o DAS e envia ao cliente | Só transmitir a declaração, como já faz |
| Recálculo de DAS | Serpro, no clique do cliente | Nenhum |
| Parcelamentos do Simples e MEI | Serpro consulta e emite as parcelas | Nenhum |
| INSS (DCTFWeb) | Serpro emite a guia depois que a declaração é transmitida | Só transmitir, como já faz |
| DARFs federais (Sicalc) | Serpro | Nenhum, quando os dados já estão no sistema |
| Confirmação de pagamento | Serpro (consulta de pagamentos) | Nenhum |
| Situação fiscal e dívida ativa | Serpro, uma vez por mês e sob demanda | Nenhum |
| Caixa Postal da Receita | Serpro; o sistema destaca o que é importante | Ler só o que for destacado |
| Declaração de faturamento | Serpro (declarações do PGDAS-D) e assinatura local | Um clique para assinar |
| Honorários | Asaas, pela conta do escritório | Nenhum, depois de cadastrar o contrato |
| ICMS-MA (DARE) | Sem API: fluxo assistido (abaixo) | Emitir no dareweb, com tudo pré-preenchido |
| FGTS (FGTS Digital) | Sem API: fluxo assistido | Emitir no FGTS Digital |
| ISS São Luís | Sem API conhecida: fluxo assistido | Emitir no portal da prefeitura |
| Parcelamento PGFN | Sem API de emissão: fluxo assistido. A consulta de dívida ativa é automática | Emitir no Regularize |
| Documentos da empresa | Sobem uma vez e ficam disponíveis para sempre | Subir uma vez |

### Fluxo assistido (ICMS-MA, FGTS, ISS, PGFN)

Sem integração, o objetivo é reduzir o trabalho da contadora a emitir a guia no site do órgão.

1. **Fila do mês.** O sistema sabe quais clientes têm ICMS, FGTS ou ISS e mostra quem ainda está sem guia antes do vencimento.
2. **Dados prontos.** Cada item da fila traz inscrição estadual, código de receita, competência e vencimento para copiar. A contadora só informa o valor apurado, ou importa a apuração.
3. **Preenchimento com um clique (fase posterior).** Uma extensão do navegador preenche o formulário do dareweb com os dados do cliente e devolve o PDF gerado direto para o sistema. Ela continua clicando em "Gerar", sem robô rodando sozinho.
4. **Sem tela de upload.** Ela pode simplesmente salvar os PDFs numa pasta sincronizada ou encaminhar por e-mail para o endereço do escritório no sistema. O sistema lê, identifica o cliente, separa PDFs com várias guias e envia.
5. **Recálculo pedido pelo cliente.** Chega na fila já pré-preenchido com a nova data.
6. **Caminho oficial.** Consultar a SEFAZ-MA e o CRC-MA sobre webservice para escritórios. Se surgir, o ICMS-MA passa a automático sem mudar nada para o cliente.

### Entrega automática e biblioteca de templates

Este é o coração do produto. Tudo o que o escritório publica vira mensagem para o cliente, enviada pelo número do próprio escritório.

- **Biblioteca da plataforma.** Nós escrevemos, versionamos e mantemos os templates, todos na categoria utilidade. Quando o escritório conecta o WhatsApp, a plataforma submete a biblioteca à Meta no WABA dele e acompanha a aprovação. O escritório escolhe quais usar e só ajusta campos permitidos, como nome e assinatura.
- **Templates iniciais:**
  - guia disponível (PDF anexado, valor, vencimento, Pix e link seguro);
  - lembrete de vencimento;
  - guia vencida, com botão Atualizar guia;
  - guia atualizada;
  - pagamento confirmado;
  - documento disponível (PDF anexado);
  - declaração pronta;
  - honorário disponível (boleto em PDF, Pix e link);
  - lembrete e atraso de honorário;
  - aviso geral do escritório;
  - código de acesso (categoria autenticação).
- **Régua automática.** Os gatilhos do núcleo são fixos. Datas e horários são configuráveis por escritório.
  - Item publicado: envia.
  - Alguns dias antes do vencimento: lembra.
  - Vencido: oferece atualização ou segunda via.
  - Pago: confirma e para a régua.
- **Canal.** O WhatsApp é o padrão, com cópia opcional por e-mail. Se o WhatsApp falhar de forma permanente (número inválido ou sem opt-in), o envio vai por e-mail e o escritório é avisado no CRM.
- **Controle no CRM.** Cada envio fica na linha do tempo do cliente, com status (enfileirado, enviado, entregue, lido, respondido, falhou) e resultado (pago, baixado, atualizado).

### Cobrança de honorários

- **Conta do escritório.** O escritório conecta a própria conta de pagamento (Asaas no MVP) em **Conexões › Cobrança**. O dinheiro cai direto na conta dele; a plataforma nunca recebe nem repassa valores.
- **Contrato por cliente.** Cada cliente tem valor, dia de vencimento, reajuste e regra de multa e juros.
- **Ciclo mensal.** O sistema gera boleto e Pix, envia pelo WhatsApp com o PDF e o link, segue a régua e dá baixa quando o provedor confirma o pagamento.
- **Visão no CRM.** O escritório vê quem está em dia, quem atrasou e o histórico de cada cliente.

### Inbox e CRM, no estilo Kommo

- **Para quem é o CRM.** É interno: a central de controle dos clientes atuais do escritório e de tudo o que é enviado a eles. Prospecção e funil de vendas ficam fora por enquanto.
- **Ficha 360 da empresa-cliente.** Reúne dados cadastrais, sócios, contatos, regime, responsável no escritório, guias, honorários, documentos, conversas, tarefas e observações internas.
- **Histórico de envios.** Mostra cada guia, documento, link e cobrança enviados, com status de entrega, leitura, resposta e pagamento. Tem filtros como "guias não lidas" e "honorários em atraso".
- **Inbox unificado.** Cada conversa de WhatsApp ou e-mail fica ligada a um contato e à empresa-cliente dele.
- **Atendimento.** Atendentes pegam, transferem e encerram conversas. Há indicador de não lidas, entregue e lido, e notas internas que o cliente não vê.
- **Janela de 24h.** Mensagem livre só dentro da janela de 24h aberta pelo cliente. Fora dela, só template aprovado; a interface bloqueia o envio e oferece os templates.
- **Solicitações.** Um pedido do cliente (WhatsApp, e-mail ou portal) vira um item com responsável, prazo e status.
- **Funis de processos internos.** Kanban configurável para rotinas como onboarding de cliente novo, abertura ou alteração de empresa e regularização de pendências.
- **Linha do tempo do cliente.** Mensagens, e-mails, envios, pagamentos, documentos baixados, tarefas e mudanças de etapa.
- **Campanhas e automações personalizadas (plano superior).** Avisos segmentados para a carteira e regras próprias do escritório, além da régua automática do núcleo.

### Portal do cliente

- **Link seguro (MVP).** Cada mensagem traz um link exclusivo para a guia, o documento ou a cobrança. Ele abre sem login, mostra Pix, linha digitável e PDF, e tem o botão Atualizar guia. Expira em 30 dias, ou antes, quando o item é pago ou substituído.
- **Portal básico com login (MVP).** Entrada por código no WhatsApp e troca entre empresas. Lista tudo o que foi disponibilizado para a empresa (guias, documentos, honorários e declarações), pronto para baixar. Parcelamentos e declarações sob demanda vêm depois.
- **Portal é opcional.** Muitos clientes nunca vão abri-lo, e tudo continua funcionando pelo WhatsApp.
- **Preferências de aviso.** WhatsApp, e-mail ou os dois. O opt-out é respeitado em todos os envios.

## 5. Regras de negócio e critérios de aceitação

Toda regra abaixo é aplicada no servidor. A interface só reflete o que o servidor decidiu.

### Regras de negócio

- **RN1 — Status da guia.** As transições válidas são:
  - `rascunho → publicada → paga`
  - `publicada → vencida → substituída`
  - `publicada → cancelada`
  - **Pagamento sempre vale (I5, 15/10/2026):** confirmado o pagamento (Serpro ou baixa manual auditada), qualquer guia que não esteja `cancelada` vai para `paga`, inclusive `vencida` ou `substituída`. Se a guia paga era uma substituída, a guia ativa que a substituiu vira `cancelada`, a régua para e o escritório recebe um alerta.
  - Guia gerada pela Serpro nasce `publicada`. Só a guia avulsa (envio manual) passa por `rascunho`.
  - Uma guia paga não volta a nenhum outro status.
- **RN2 — Recálculo automático.** Só vale para DAS (Simples e MEI) vencido e não pago. A nova guia substitui a anterior e guarda o vínculo de origem. Limite: 3 recálculos por guia por dia.
- **RN3 — Tipos assistidos.** FGTS, ICMS-MA, ISS e PGFN nunca chamam API externa. "Atualizar" cria um pedido na fila do escritório.
- **RN4 — Envio em lote.** Um PDF só é publicado se o CNPJ lido existir no tenant. Se a leitura falhar ou o CNPJ não for encontrado, o PDF vai para revisão manual e nada chega ao cliente.
- **RN5 — Duplicidade de guia.** Não pode haver duas guias ativas com a mesma chave `(tenant, empresa, tipo, competência)`.
- **RN6 — Janela de 24h.** Mensagem livre de WhatsApp só dentro de 24h da última mensagem do contato. Fora disso, só template aprovado.
- **RN7 — Consentimento.** Campanhas e lembretes só vão para contatos com opt-in ativo no canal. Opt-out ("SAIR" ou link no e-mail) vale na hora e fica registrado.
  - **P25 (15/10/2026):** na entrega do núcleo (guias, documentos, lembretes e honorários), o contato nasce autorizado em cada canal que tem (telefone ou e-mail). O escritório é responsável por informar o cliente; o sistema registra a origem `padrao_escritorio`, quem cadastrou e quando. O escritório pode desmarcar, e o opt-out do cliente (SAIR ou link no e-mail) vale na hora. Campanhas continuam exigindo opt-in marcado explicitamente.
- **RN8 — Lembretes.** Guia paga não recebe lembrete. O status de pagamento é verificado imediatamente antes de cada envio.
- **RN9 — Acesso do portal.** A pessoa do portal só vê as empresas a que foi vinculada, e só dentro do tenant do domínio acessado.
- **RN10 — Papéis do escritório.**
  - **Dono:** pode tudo, inclusive certificados e cobrança.
  - **Admin:** configurações, usuários e campanhas.
  - **Contador:** guias, documentos e fiscal.
  - **Atendente:** inbox e CRM. Não vê certificados.
- **RN11 — Certificado digital.** No modo plataforma, o certificado do escritório nunca é enviado: só o dono assina o termo de autorização, localmente. No modo próprio, só o dono envia ou substitui o certificado. Certificados de clientes nunca são aceitos. A plataforma alerta 30, 7 e 1 dia antes do vencimento. Com termo ou certificado vencido, ações Serpro ficam bloqueadas e viram pedidos manuais.

* **RN12 — Templates.** Só são usados templates da biblioteca da plataforma, aprovados pela Meta no WABA do escritório. O escritório não cria template livre; pedidos de template novo passam por revisão da plataforma.
* **RN13 — Entrega automática.** Toda guia, documento ou cobrança publicada gera envio automático no canal preferido do cliente. Falha permanente no WhatsApp desvia para e-mail e cria alerta no CRM.
* **RN14 — Link seguro.** Cada item tem um token aleatório próprio, guardado só como hash. O link expira em 30 dias ou quando o item é pago ou substituído, tem limite de acessos e cada abertura é registrada.
* **RN15 — Honorários.**
  - A cobrança é gerada na conta de pagamento do próprio escritório; a plataforma não recebe nem repassa dinheiro.
  - Só existe uma cobrança por cliente e competência.
  - A baixa só acontece por confirmação do provedor (webhook) ou manualmente pelo escritório, com registro na auditoria.

- **RN16 — Automação primeiro.**
  - Para tipos com integração Serpro, o sistema não oferece upload como caminho padrão.
  - O upload só aparece como contingência, por exemplo com a Serpro fora do ar ou o termo vencido, e sempre fica registrado.
  - Tipos sem integração usam o fluxo assistido.

* **RN17 — Ordem do fluxo.** Um item só é disponibilizado ou enviado depois de guardado e vinculado a uma empresa-cliente do tenant. Item sem vínculo confirmado fica em revisão. Itens internos (Caixa Postal, situação fiscal) não são enviados ao cliente sem ação do escritório.

### Critérios de aceitação (exemplos-chave)

**CA1 — Isolamento entre escritórios**

- **Dado** um usuário do escritório A autenticado,
- **quando** ele pede a guia de ID X, que pertence ao escritório B,
- **então** o servidor responde 404,
- **e** não revela se X existe,
- **e** grava a tentativa em `security_events`.
- **Observação:** com RLS, o servidor não sabe (e não deve descobrir) se X é de outro tenant ou se não existe. Por isso, toda busca por ID sem resultado é registrada com usuário, tenant ativo, tipo de recurso, ID pedido e IP, e um alerta dispara por padrão (por exemplo, mais de 20 buscas sem resultado por minuto do mesmo usuário). O sistema nunca fura o RLS para descobrir o dono do recurso.

**CA2 — Recálculo de DAS**

- **Dado** um DAS vencido em 20/10 e não pago,
- **quando** o cliente toca em Atualizar guia em 22/10,
- **então** em até 15 s ele recebe a nova guia com vencimento 22/10 e valor atualizado pela Receita,
- **e** a guia anterior muda para `substituída`.
- **Falha:** se a Serpro não responder em 15 s, o cliente vê "Estamos gerando sua guia, ela chega no WhatsApp". O sistema tenta de novo em segundo plano até 3 vezes antes de abrir pedido na fila.

**CA3 — Envio em lote**

- **Dado** que a contadora sobe 30 PDFs,
- **quando** 28 têm CNPJ válido do tenant e 2 não,
- **então** 28 guias são publicadas e notificadas,
- **e** 2 aparecem em Revisão com o motivo,
- **e** nenhuma é publicada em duplicidade.

**CA4 — Janela de 24h**

- **Dado** um contato cuja última mensagem foi há 25h,
- **quando** o atendente tenta enviar texto livre,
- **então** o envio é bloqueado e a interface oferece os templates aprovados.

**CA5 — Opt-out em campanha**

- **Dado** um contato que respondeu SAIR,
- **quando** uma campanha é disparada para a tag dele,
- **então** ele é excluído do envio,
- **e** o relatório mostra o motivo "opt-out".

**CA6 — Pessoa em duas empresas**

- **Dado** que João é sócio da Padaria e da Loja, ambas no tenant Contact,
- **quando** ele entra no portal,
- **então** escolhe a empresa ativa,
- **e** nunca vê guias de uma empresa enquanto a outra está selecionada.

**CA7 — Entrega automática da guia**

- **Dado** que a contadora publicou um lote com a guia da Padaria,
- **quando** o processamento termina,
- **então** em até 2 min o contato da Padaria recebe, pelo número da Contact, o template "guia disponível" com o PDF, o Pix e o link seguro,
- **e** o CRM mostra o envio como entregue e depois como lido.

**CA8 — Honorário pago por Pix**

- **Dado** um honorário de outubro em aberto,
- **quando** o provedor confirma o pagamento por webhook,
- **então** a cobrança muda para paga, o cliente recebe o template "pagamento confirmado" e a régua daquele honorário para,
- **e** um webhook repetido não gera segunda baixa.

**CA9 — Template rejeitado**

- **Dado** que a Meta pausou o template "lembrete de vencimento" no WABA da Contact,
- **quando** chega a hora do lembrete,
- **então** o envio sai por e-mail,
- **e** o escritório vê um alerta com o motivo no CRM.

## 6. Requisitos não funcionais

As metas abaixo valem para até 20 escritórios e 2.000 empresas-clientes. Acima disso, revisamos a arquitetura.

| Categoria | Meta | Como medir |
| --- | --- | --- |
| Disponibilidade | 99,5% ao mês no portal e no inbox (cerca de 3,6 h de indisponibilidade) | Monitor externo a cada 1 min |
| Recuperação | RPO de 15 min (backup contínuo do Postgres); RTO de 4 h | Restauração testada a cada trimestre |
| Latência do portal | p95 abaixo de 800 ms nas páginas; abaixo de 1,5 s no primeiro carregamento em 4G | Métricas de servidor e Web Vitals |
| Inbox em tempo real | Mensagem recebida aparece para o atendente em até 3 s depois do webhook | Tempo entre webhook e entrega no socket |
| Recálculo | Guia nova em até 15 s no p95 (depende da Serpro) | Trace por chamada |
| Campanhas | 1.000 mensagens por hora por tenant, respeitando o tier da Meta, sem atrasar mensagens de atendimento | Fila separada por prioridade |
| Webhooks | Processados de forma idempotente; resposta 200 em até 2 s; trabalho pesado vai para a fila | ID do evento único por tenant |
| Acessibilidade | Portal WCAG 2.2 AA: contraste, teclado, leitor de tela | Verificação automática mais revisão manual |
| Mobile | Portal 100% funcional em 360 px de largura, instalável como PWA | Testes E2E em viewport móvel |
| Custo | Infraestrutura abaixo de R$ 50 por tenant por mês, sem contar Serpro e WhatsApp | Painel de custos mensal |
| Dados | Exportação completa do tenant (CSV e arquivos) em até 24 h; exclusão em até 30 dias depois do encerramento | Rotina documentada e testada |
