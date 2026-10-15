# Riscos, viabilidade e decisões pendentes

> Origem: Seção 15 e parte final da seção 16 do plano.

## 15. Riscos prioritários

O risco que mais preocupa é o de escopo, não o técnico. Um CRM completo no estilo Kommo é um produto inteiro por si só, e ele foi somado a uma assinatura de R$ 500. Os dois primeiros itens da tabela tratam disso. O responsável por todos os riscos é o Pedro.

| # | Risco | Prob. | Impacto | Sinal de alerta | Mitigação | Plano B |
| --- | --- | --- | --- | --- | --- | --- |
| R1 | Escopo do CRM cresce e atrasa o portal prometido à Contact | Alta | Alto | Semana 6 sem portal no ar | MVP com CRM básico; o CRM completo só vem depois do piloto; congelar o escopo a cada incremento | Entregar o portal primeiro e o inbox em seguida, mesmo sem funil |
| R2 | Receita da Contact (R$ 500) não paga o esforço de um SaaS | Alta | Alto | Mais de 20 semanas sem um segundo escritório | Validar H4 cedo: mostrar o piloto a 3 escritórios até a semana 12 | Manter o produto só para a Contact e reduzir o escopo do CRM |
| R3 | Vazamento de dados entre escritórios | Baixa | Crítico | Teste de isolamento falhando, alerta de RLS | RLS, contexto obrigatório, testes negativos no CI, revisão de código de todo acesso a dados | Plano de incidente e comunicação em até 24 h |
| R4 | Vazamento do certificado do contratante (Pedro) | Baixa | Crítico | Uso fora do padrão nos logs de chamadas Serpro | Criptografia em envelope com KMS, acesso só pelo worker, auditoria | Revogar o certificado com a AC e emitir outro |
| R5 | Verificação de Tech Provider na Meta demora ou é negada | Média | Médio | Mais de 4 semanas sem aprovação | Começar na semana 1; Contact conectada manualmente | Usar BSP (360dialog ou Gupshup) |
| R6 | Modelo de contratação da Serpro não permite a plataforma atender vários escritórios | Média | Alto | PoC sem autenticação de procurador | PoC na semana 1 a 2; ler os termos da Serpro | Cada escritório contrata a própria Serpro |
| R7 | Leitura de PDF falha em modelos variados de guia | Média | Médio | Mais de 10% dos PDFs indo para revisão | Coletar 50 PDFs reais (anonimizados) antes de codar; parser por modelo | Revisão manual assistida com campos pré-preenchidos |
| R8 | Serpro instável no dia 20 | Média | Médio | Taxa de erro acima de 20% | Disjuntor, fila com retentativa, guias geradas com antecedência | Fila manual com aviso ao cliente |
| R9 | Bloqueio do número por denúncia de spam | Baixa (média com a P25) | Alto | Qualidade do número caindo na Meta | Opt-in, frequência limitada, templates de utilidade | Número reserva verificado |
| R10 | Desenvolvedor solo como ponto único de falha | Alta | Alto | Férias, doença, emprego CLT ocupando o tempo | Documentação e runbooks, infraestrutura gerenciada, alertas | Contrato com prazo de resposta realista; parceiro técnico de reserva |

Riscos acrescentados com a entrega pelo WhatsApp e os honorários:

| # | Risco | Prob. | Impacto | Sinal de alerta | Mitigação | Plano B |
| --- | --- | --- | --- | --- | --- | --- |
| R11 | Template rejeitado ou pausado pela Meta no WABA de um escritório | Média | Alto | Status do template muda; queda na qualidade do número | Só categoria utilidade, textos revisados, monitoramento de qualidade, variações aprovadas de reserva | Envio por e-mail e alerta ao escritório (CA9) |
| R12 | Cobrança de honorário errada (valor, duplicidade ou cliente errado) | Baixa | Alto | Reclamação de cliente; cobrança duplicada no provedor | Chave única por cliente e competência, revisão do lote no primeiro mês, cancelamento em um clique | Estorno ou cancelamento no provedor, com mensagem de correção ao cliente |

### Decisões pendentes (próximo passo de cada uma)

As decisões P1 a P6 e P8 a P16 foram tomadas em 14/10/2026 (seção 2). Ainda falta:

- [ ] **PoC Serpro (modo plataforma).** Contratar o Integra Contador como software house e emitir um DAS com o termo de autorização da Contact assinado localmente no Assinador do Serpro. Medir a validade do termo. *Bloqueia a fase fiscal.*
- [ ] **Procurações eletrônicas.** A Contact gera a procuração de cada cliente para o CNPJ do escritório no e-CAC. *Bloqueia o recálculo de cada empresa.*
- [ ] **MEI do Pedro.** Necessário para o contrato com a Serpro, a verificação de Tech Provider na Meta e a nota da assinatura.
- [ ] **Verificação de Tech Provider na Meta.** Abrir logo depois do MEI.
- [ ] **Materiais da Contact.** PDFs de guias anonimizados e lista de clientes com regime.
- [ ] **Jurídico.** Contrato com a Contact (assinatura, fidelidade, licença de uso), DPA e termos de uso. O contrato precisa prever o repasse do consumo da Serpro no modo plataforma.
- [ ] **P7 — Nome e marca.** Definir antes de março de 2027.
- [ ] **Conta AWS e chave no KMS (P17).** Criar até 23/11/2026, antes do primeiro dado real. *Bloqueia a produção com dados da Contact.*
- [ ] **Domínio provisório (P16).** Comprar para staging e confirmar se o subdomínio coringa na Vercel exige os nameservers dela. *Bloqueia o staging com subdomínios.*

* [ ] **SEFAZ-MA e CRC-MA.** Perguntar se existe webservice ou convênio para escritórios contábeis emitirem DARE. Se existir, o ICMS-MA sai do fluxo assistido.
* [ ] **PoC de monitoramento.** Detectar pela Serpro que a declaração do Simples foi transmitida e gerar o DAS sem ação da contadora. Medir o custo por cliente.

### Inconsistências conhecidas do plano (decisão pendente)

Encontradas na revisão de 14/10/2026. Não bloqueiam a Fundação. Cada uma deve ser resolvida, com pergunta ao Pedro, antes do incremento indicado.

| # | Inconsistência | Onde aparece | Resolver antes de |
| --- | --- | --- | --- |
| I1 | Quem assina a declaração de faturamento: "e-CPF A1 do contador (PAdES)" ou o e-CNPJ do escritório, localmente. Um A1 no servidor contradiz o ADR 0006 | 04 (seção 10), 07 (seção 11) | Fiscal completo |
| I2 | **Resolvida em 15/10/2026:** os dois modos. Conexão manual: endereço de webhook próprio e secreto por conexão, que identifica o escritório e o app secret para conferir a assinatura. Embedded Signup: endereço único do app, com o escritório identificado pelo `phone_number_id`. Nos dois, o `phone_number_id` da mensagem precisa pertencer à conexão, senão é recusado e registrado. | CLAUDE.md, 04, `.env.example` | — |
| I3 | **Resolvida em 15/10/2026:** só `template_library` (plataforma) + `tenant_templates` (status por escritório). A tabela `templates` saiu do modelo. | 05 | — |
| I4 | `deals` "com valor" sugere funil de vendas, mas P4 tira a prospecção do escopo. Os funis são só de processos internos? | 05, 03 | Inbox, CRM e solicitações |
| I5 | **Resolvida em 15/10/2026:** pagamento sempre vale; guia da Serpro nasce publicada. Ver RN1. | 03 (RN1) | — |
| I6 | O MVP já tem portal básico com login, mas existe o incremento pós-MVP "Portal com login e planos". Falta definir a diferença | 02 | Honorários e portal básico |
| I7 | Quantidade de PDFs de exemplo: 10 a 20 (`fixtures/guias/LEIA-ME.txt`), 20 (seção 14) ou 50 (R7) | 02, 08 | Descoberta e PoCs |
| I8 | Detalhes de texto: "quatro frentes" com cinco itens (seção 1); "nove módulos" com 11 linhas (seção 4); declarações de IR citadas na LGPD sem estar no escopo | 00, 03, 07 | Quando o tema for tocado. (O provedor do KMS, que também estava aqui, foi resolvido pela P17: AWS KMS.) |
