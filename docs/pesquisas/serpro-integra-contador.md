# Pesquisa — o que o Integra Contador (Serpro) oferece

- **Data:** 15/10/2026
- **Fonte:** [Catálogo de Serviços oficial](https://apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador/pt/catalogo_de_servicos/) (119 serviços). A página da [Loja Serpro](https://loja.serpro.gov.br/product/integracontador) não abre para leitura automática: preços e contratação precisam ser conferidos lá.
- **Objetivo:** tirar trabalho manual do escritório (RN16) e fazer o cliente receber tudo pelo WhatsApp ou e-mail (P22).

Status: **em produção** salvo indicação. Tipos do catálogo: Consultar, Emitir, Declarar, Monitorar, Apoiar.

## 1. O que entra no produto (em produção)

| Sistema | Serviços úteis | O que o sistema faz sozinho | Vai para |
| --- | --- | --- | --- |
| PGDASD (Simples) | `CONSULTIMADECREC14`, `CONSDECLARACAO13`, `GERARDAS12`, `CONSEXTRATO16`, `GERARDASAVULSO19`, `GERARDASCOBRANCA17` | Detecta que a declaração do mês foi transmitida, gera o DAS e envia; recalcula DAS vencido; guarda declaração, recibo e extrato | Cliente (DAS) e arquivo |
| PGMEI | `GERARDASPDF21`, `GERARDASCODBARRA22`, `DIVIDAATIVA24` | Gera o DAS do MEI todo mês, sem ação do escritório; consulta dívida ativa | Cliente (DAS); escritório (dívida) |
| CCMEI | `EMITIRCCMEI121`, `DADOSCCMEI122`, `CCMEISITCADASTRAL123` | Emite o certificado do MEI e confere a situação cadastral | Arquivo do cliente |
| DCTFWEB e MIT | `CONSRECIBO32`, `GERARGUIA31`, `GERARGUIAANDAMENTO313`, `CONSAPURACAO316`, `LISTAAPURACOES317` | Detecta a declaração transmitida e gera a guia de INSS e tributos federais | Cliente (guia) |
| SICALC | `CONSOLIDARGERARDARF51`, `GERARDARFCODBARRA53`, `CONSULTAAPOIORECEITAS52` | Gera DARF quando o sistema já tem código de receita, período e valor | Cliente (DARF) |
| PAGTOWEB | `PAGAMENTOS71`, `COMPARRECADACAO72`, `CONTACONSDOCARRPG73` | Confirma pagamento, para a régua e envia o comprovante | Cliente ("pagamento confirmado" + comprovante) |
| Parcelamentos (PARCSN, PARCSN-ESP, PERTSN, RELPSN, PARCMEI, PARCMEI-ESP, PERTMEI, RELPMEI) | `PARCELASPARAGERAR*`, `GERARDAS*`, `OBTERPARC*`, `DETPAGTOPARC*` | Emite a parcela do mês e envia, sem ação do escritório | Cliente (parcela) |
| DEFIS | `CONSULTIMADECREC143`, `CONSDECREC144` | Guarda o recibo e a declaração anual | Arquivo do cliente |
| REGIMEAPURACAO | `CONSULTAROPCAOREGIME103` | Mostra o regime (competência ou caixa) na ficha | Escritório |
| CAIXAPOSTAL e DTE | `INNOVAMSG63`, `MSGCONTRIBUINTE61`, `MSGDETALHAMENTO62`, `CONSULTASITUACAODTE111` | Avisa de mensagem nova da Receita e destaca a importante | Escritório (alerta interno, RN17) |
| SITFIS | `SOLICITARPROTOCOLO91` + `RELATORIOSITFIS92` | Relatório de situação fiscal em PDF, mensal ou sob demanda | Escritório; cliente só por decisão do escritório |
| PROCURACOES | `OBTERPROCURACAO41` | Confere se o cliente deu procuração ao escritório e até quando | Ficha do cliente (hoje o campo é manual) |
| EVENTOSATUALIZACAO | `SOLICEVENTOSPJ132` + `OBTEREVENTOSPJ134` | Pergunta "o que mudou" para várias empresas de uma vez, em vez de consultar cada serviço de cada empresa | Interno (reduz custo das consultas) |
| PNRCONTADOR | `CONSVINCULOS261` | A investigar: pode listar as empresas vinculadas ao contador e ajudar no cadastro inicial | Escritório |
| EPROCESSO | `CONSPROCPORINTER271` | Processos na Receita por interessado | Escritório (alerta) |
| AUTENTICAPROCURADOR | `ENVIOXMLASSINADO81` | Recebe o termo de autorização assinado pelo escritório (modo plataforma) | Conexões › Receita Federal |

## 2. O que ainda não existe ou não vem pela API

- **Em construção:** DASN-SIMEI (declaração anual do MEI), `CONSOLIDAR54` do SICALC e documentos do e-Processo.
- **Em prospecção:** relatórios de crédito e débito da DCTFWeb, MAED, PAEX e SIPADE.
- **Fora do Integra Contador:** ICMS (DARE no Maranhão), ISS municipal, FGTS Digital e emissão de parcelamento na PGFN. Esses seguem o fluxo assistido com leitura de PDF.
- **Transmissão de PGDAS-D e DCTFWeb** existe na API, mas está fora do escopo (seção 3): o escritório continua transmitindo no sistema que já usa.

## 3. Consequências para o plano

1. O que a Serpro gera não precisa de upload nem de leitura de PDF: o PDF vem pronto da API e vai direto para o arquivo do cliente e para o WhatsApp.
2. O monitoramento ("a declaração do mês saiu?", "foi pago?", "tem mensagem nova?") deve usar o EVENTOSATUALIZACAO sempre que ele cobrir o caso, para não pagar uma consulta por empresa por dia. A cobertura exata desses eventos precisa ser confirmada na PoC.
3. A situação da procuração pode ser lida da API (`OBTERPROCURACAO41`) em vez de digitada.
4. A leitura de PDF continua necessária para ICMS, ISS, FGTS e PGFN, e como contingência quando a Serpro estiver fora do ar ou o termo vencido (RN16).
5. Custo: cada chamada é cobrada (no plano: consulta R$ 0,24, emissão R$ 0,32, declaração R$ 0,40 na faixa 1, a confirmar na loja). A PoC deve medir o custo por empresa por mês.
6. A Serpro oferece um ambiente **trial** com dados fictícios fixos (`SERPRO_ENV=trial`). Dá para construir e testar o adaptador antes do contrato; só a PoC com a Contact depende do contrato.
