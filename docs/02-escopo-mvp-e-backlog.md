# Escopo do MVP e backlog

> Origem: Seções 3 e 14 do plano.

## 3. Escopo

O MVP precisa provar uma coisa: o cliente da Contact recebe automaticamente, pelo WhatsApp do escritório, tudo o que antes era enviado à mão, e o escritório controla esses envios no CRM. A fundação multi-tenant entra já no MVP, porque não dá para adicioná-la depois com segurança.

**Princípio de automação:** se a Serpro permite gerar ou consultar, o sistema faz sozinho. Upload manual só existe para o que não tem integração, e mesmo assim com o máximo de preenchimento automático (seção 4, Matriz de automação).

### MVP: tenant piloto Contact (semanas 1 a 10)

- Fundação multi-tenant: organizações, membros, papéis, RLS e auditoria.
- Cadastro das empresas-clientes, com contatos, canal preferido, opt-in e documentos.
- Conexão do WhatsApp do escritório e biblioteca de templates da plataforma, submetida automaticamente à Meta.
- Geração automática de tudo o que a Serpro permite. Envio em lote de PDFs, com leitura de CNPJ, valor, vencimento e código de barras, só para o que não tem API. Nos dois casos, **entrega automática** pelo WhatsApp, com cópia por e-mail.
- Régua automática: guia disponível, lembrete, vencimento, guia vencida e pagamento confirmado.
- Links seguros sem login para cada guia, documento e cobrança, e portal básico com login (código no WhatsApp) para listar e baixar tudo o que foi disponibilizado.
- Integração Serpro: gerar e recalcular o DAS do Simples e do MEI, e consultar pagamentos.
- CRM interno: ficha 360, histórico de envios com status, inbox, solicitações, um funil de processo interno e tarefas.
- Cobrança de honorários: contrato por cliente, boleto e Pix na conta do escritório, régua e baixa automática.
- Fila de pedidos manuais (FGTS, ICMS, ISS, PGFN).

### Depois do MVP (semanas 11 a 20)

- Portal avançado: parcelamentos e declarações sob demanda, e preferências de aviso.
- Campanhas segmentadas e automações personalizadas (plano superior).
- Parcelamentos (PARCSN e PARCMEI), INSS (DCTFWeb), declaração de faturamento assinada e Radar de Débitos (situação fiscal e dívida ativa).
- Pedido de template novo pelo escritório, com revisão da plataforma.
- Onboarding de novos escritórios, planos, limites, medição de uso e cobrança da assinatura.

### Fora do escopo (por enquanto)

- Integração com sistemas contábeis (Domínio, Alterdata, Omie).
- Transmissão de declarações (PGDAS-D, DCTFWeb). O escritório continua transmitindo no sistema que já usa.
- Emissão de nota fiscal.
- Aplicativo nativo nas lojas. O portal é PWA.
- WhatsApp não oficial (Baileys, Evolution e similares).
- Atendente com IA. Fica planejado na seção 16, mas não é construído agora.
- Banco separado por tenant.

## 14. Plano de execução

O plano tem três marcos:

- **23/11 — Entrega automática no ar.** A Contact passa a enviar guias pelo WhatsApp, cumprindo o prazo de 5 semanas combinado.
- **28/12 — MVP completo.** Inclui inbox, CRM, Serpro e honorários.
- **Março de 2027 — Venda a outros escritórios.** A plataforma fica pronta para novos clientes.

| Incremento / marco | Início | Fim |
| --- | --- | --- |
| Descoberta e PoCs | 19/10/2026 | 02/11/2026 |
| Fundação multi-tenant | concluída em 14/10/2026 | |
| Clientes e documentos | concluído em 15/10/2026 | |
| Guias, templates e entrega | 16/10/2026 | 06/11/2026 |
| Serpro: DAS, recálculo e pagamentos | 07/11/2026 | 23/11/2026 |
| **Marco: entrega automática no ar (Contact)** | **23/11/2026** | |
| Leitura de PDF em lote (tipos assistidos) | 24/11/2026 | 07/12/2026 |
| Inbox, CRM e solicitações | a replanejar depois do marco | |
| Honorários e portal básico | a replanejar depois do marco | |
| **Marco: MVP completo** | **28/12/2026** | |
| Campanhas e automações | 04/01/2027 | 25/01/2027 |
| Fiscal completo | 11/01/2027 | 08/02/2027 |
| Portal com login e planos | 01/02/2027 | 22/02/2027 |
| Segurança e piloto | 15/02/2027 | 08/03/2027 |
| **Marco: venda a novos escritórios** | **08/03/2027** | |

**Ordem revista em 15/10/2026 (P23):** a Serpro vem antes da leitura de PDF em lote, para o DAS sair sozinho já no marco de 23/11. As datas de Inbox e Honorários são revistas depois do marco; a Fundação e Clientes e documentos terminaram cerca de três semanas antes do previsto.

A semana de 28/12 fica livre por causa das festas. Ela funciona como folga do MVP. Cada incremento entrega algo que dá para ver funcionando.

| Incremento | Entrega observável | Pronto quando |
| --- | --- | --- |
| Descoberta e PoCs | Serpro respondendo com o termo da Contact; mensagem de WhatsApp enviada e recebida por webhook; templates de teste aprovados; 20 PDFs reais lidos | Taxa de leitura de PDF acima de 90%; PoC Serpro concluída |
| Fundação multi-tenant | Login por link mágico, TOTP para dono e admin, dois escritórios de teste, convites, papéis, RLS, auditoria, `security_events`, subdomínios, CI | Todos os testes negativos de isolamento passando |
| Clientes e documentos | Importação por CSV; ficha do cliente; pastas por empresa | CA6 passando; arquivo de outro tenant inacessível |
| Guias, templates e entrega | WhatsApp do escritório conectado e biblioteca aprovada; guia publicada (avulsa, como contingência) chega no WhatsApp com PDF, Pix e link seguro; régua ativa | CA7 passando |
| Inbox, CRM e solicitações | Histórico de envios por cliente; conversa em tempo real; solicitações e tarefas | CA4 e CA5 passando; inbox abaixo de 3 s |
| Serpro: DAS, recálculo e pagamentos | DAS do MEI e do Simples gerado sozinho e enviado; atualizar guia gera DAS novo; pagamento confirmado para a régua e envia o comprovante | CA2 passando; disjuntor testado; piloto com 5 clientes |
| Leitura de PDF em lote | A contadora sobe ICMS, ISS, FGTS e PGFN em lote; o sistema lê, vincula e envia; o que não casa vai para revisão | CA3 passando; leitura acima de 90% |
| Honorários e portal básico | Contratos de honorários; boleto e Pix na conta da Contact; régua e baixa automática; portal básico com lista e download | CA8 passando; um mês real de honorários cobrado |
| Campanhas e automações | Disparo segmentado; regras personalizadas do escritório | 5.000 mensagens sem atrasar o inbox nem a régua |
| Fiscal completo | Parcelamentos, DCTFWeb, declaração de faturamento assinada, Radar de Débitos | Declaração aceita por um banco real |
| Portal com login e planos | Portal com histórico; novo escritório se cadastra, conecta WhatsApp e cobrança e paga a assinatura | Onboarding sem ajuda do Pedro em até 1 h |
| Segurança e piloto | Revisão de segurança, teste de carga, restauração de backup, 2º escritório piloto | Nenhum P1 aberto; RTO medido abaixo de 4 h |

### Definição de pronto (vale para todo item)

- [ ] Critérios de aceitação atendidos e cobertos por teste automatizado.
- [ ] Autorização checada no backend e teste negativo de isolamento escrito.
- [ ] Erros, timeouts e estados vazios tratados, com mensagem clara para o usuário.
- [ ] Migração revisada, com rollback ou plano de recuperação.
- [ ] Logs e métricas úteis, sem conteúdo sensível.
- [ ] Funciona em 360 px e com teclado.
- [ ] Deploy em staging aprovado e E2E verde.
- [ ] Documentação e runbook atualizados quando houver integração nova.
