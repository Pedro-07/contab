# Contexto, visão e descoberta

> Origem: Seções 1 e 2 do plano. Inclui também a descoberta (hipóteses H1 a H5 e o indicador de tempo de reenvio), por isso não existe um `01-descoberta-e-indicadores.md` separado.

## 1. Resumo executivo

Vamos construir uma plataforma SaaS multi-tenant para escritórios de contabilidade. A Contact Consultoria é o primeiro tenant, assinando por R$ 500/mês. A mesma base atende outros escritórios sem reconstrução.

**Problema.** O escritório perde horas reenviando guias, recalculando boletos vencidos e mandando documentos que o cliente já recebeu. A conversa com o cliente fica espalhada no WhatsApp pessoal, sem histórico, funil ou automação.

**Usuários.** São três:

- **Equipe do escritório:** contadora, assistentes e atendentes.
- **Clientes do escritório:** as empresas atendidas, que usam o portal.
- **Operador da plataforma:** Pedro, com suporte e administração.

**Solução.** Um monólito modular com quatro frentes:

- **Entrega automática pelo WhatsApp do escritório (núcleo).** Guias com PDF, código de barras e Pix, documentos, links, avisos e cobranças (impostos e honorários). Tudo sai do número do próprio escritório, com templates mantidos pela plataforma.
- **CRM interno.** É a central de controle: a ficha de cada cliente e tudo o que foi enviado, entregue, lido, respondido e pago, além de conversas, solicitações e tarefas.
- **Motor fiscal.** Integração com a Receita via Serpro para gerar, recalcular e confirmar guias.
- **Cobrança de honorários.** Boleto e Pix na conta do próprio escritório, com baixa automática.
- **Portal do cliente (opcional).** Cada mensagem traz um link seguro que abre sem login. O portal completo existe para quem quiser acessar.

**Resultado esperado.** O cliente recebe tudo no WhatsApp sem ninguém do escritório enviar nada: a guia do mês, o lembrete, a guia atualizada quando vence, o documento pedido e a cobrança dos honorários. O escritório acompanha tudo no CRM e só entra quando o cliente precisa falar com uma pessoa. O tempo gasto com reenvio cai de \~8 h/mês para menos de 1 h/mês no tenant piloto (hipótese, medida no piloto).

**Decisão central.** Tudo nasce multi-tenant, com isolamento por organização tratado como requisito de segurança. Não fazemos um sistema de um cliente só para adaptar depois, porque isso custaria mais do que construir certo agora.

## 2. Confirmado, hipóteses e perguntas abertas

### Confirmado

- **Negócio:** a Contact aceitou a assinatura de cerca de R$ 500/mês. Tem cerca de 25 clientes: uns 6 no Simples Nacional, 3 MEI e o restante no Lucro Presumido ou Real (informado em 15/10/2026).
- **Pedidos da contadora:** portal com login, guias do mês, recálculo de guia vencida com um clique, parcelamentos, documentos da empresa e declaração de faturamento dos últimos 12 meses assinada.
- **Pedidos do Pedro:** multi-tenant, CRM no estilo Kommo com disparos de WhatsApp e e-mail, e chat de WhatsApp pela API oficial.
- **Preços da Serpro:** consulta R$ 0,24, emissão R$ 0,32 e declaração R$ 0,40 na faixa 1. Consulta de dívida ativa R$ 0,6591.
- **Sem API pública:** FGTS, ICMS-MA (DARE), ISS e parcelamento PGFN. Ficam em modo assistido.
- **Desenvolvimento:** solo, pelo Pedro, com Claude Code. Os sites de clientes ficam na Vercel, com DNS na Cloudflare.

### Hipóteses (validar)

- **H1.** A Contact tem e-CNPJ A1. Hoje ela entra no e-CAC com o certificado de cada cliente. Ela consegue gerar as procurações eletrônicas para o escritório (veja a seção 10).
- **H2.** Cerca de 25% das guias vencem e são recalculadas.
- **H3.** A maioria dos clientes prefere WhatsApp a e-mail.
- **H4.** Outros escritórios de São Luís pagariam R$ 300 a 600/mês pela plataforma.
- **H5.** Um escritório pequeno usa um único número de WhatsApp.

### Decisões tomadas em 14/10/2026

| # | Decisão | Onde muda o plano |
| --- | --- | --- |
| P1 | **Serpro:** o Pedro contrata o Integra Contador como software house, e o consumo entra nos planos. Escritório que já tiver contrato próprio pode cadastrar a conexão dele na tela Conexões. | Seção 10, conexão fiscal em dois modos |
| P2 | **WhatsApp:** cada escritório usa o próprio número e WABA, e a plataforma só intermedia (como no Kommo). No início a conexão é manual; depois da aprovação como Tech Provider, passa a ser por Embedded Signup. | Seção 10 |
| P3 | **Login do portal:** telefone e código no WhatsApp, com escolha da empresa. CNPJ e senha ficam como alternativa. | Seções 4 e 11 |
| P4 | **CRM interno:** serve só para os clientes atuais do escritório (ficha, atendimento, tarefas, equipe). Sem prospecção por enquanto. | Seções 3 e 4 |
| P5 | **Plano da Contact (R$ 500):** inclui inbox e CRM interno. Campanhas e automações ficam no plano superior. | Seção 8 (planos) |
| P6 | **Endereço:** subdomínio por escritório. | Seção 8 |
| P7 | **Nome e marca:** definir depois, antes do lançamento de março de 2027. | Seção 14 |

**Decisões complementares (14/10, tarde):**

| # | Decisão | Onde muda o plano |
| --- | --- | --- |
| P8 | **WhatsApp é o canal principal.** A entrega automática pelo número do escritório é o núcleo do produto. O portal é opcional, e cada mensagem leva um link seguro sem login. | Seções 1, 3, 4 e 14 |
| P9 | **Templates são da plataforma.** Nós escrevemos e mantemos a biblioteca, que é submetida automaticamente à Meta no WABA de cada escritório. O escritório ativa os templates, mas não cria template livre. | Seções 4, 5 e 10 |
| P10 | **Cobranças incluem guias e honorários.** O escritório cobra os próprios honorários por boleto e Pix, na conta de pagamento dele, com régua pelo WhatsApp. | Seções 4, 5, 9 e 10 |

| # | Decisão | Onde muda o plano |
| --- | --- | --- |
| P11 | **Automação primeiro.** Tudo o que a Serpro permite gerar ou consultar é feito automaticamente. A contadora só sobe arquivo quando não há integração (ICMS-MA, FGTS, ISS, PGFN), e mesmo esses fluxos são assistidos para dar o mínimo de trabalho. | Seções 3, 4 e 5 |

**Decisões da revisão do plano (14/10, noite):**

| # | Decisão | Onde muda o plano |
| --- | --- | --- |
| P12 | **ADRs.** São registrados os ADRs 0001 a 0009 (seção 16), incluindo 0008 (WhatsApp como canal principal) e 0009 (honorários na conta do escritório). | Seção 16 |
| P13 | **Login sem senha.** O painel entra por link mágico no e-mail (via Resend), com sessões guardadas no banco e revogáveis. Não há senha no painel. A biblioteca escolhida primeiro foi o Auth.js, substituído pelo Better Auth (P18). | Seções 9, 11 e 16 (ADR 0007) |
| P14 | **MFA na Fundação.** TOTP obrigatório para dono e admin, opcional para contador e atendente, com códigos de recuperação. A sessão só vale depois do segundo fator (`mfa_verified`). Passkeys ficam para a fase "Segurança e piloto". | Seções 9, 11 e 14 |
| P15 | **Log de segurança separado da auditoria.** `audit_logs` (por tenant) guarda ações de negócio. `security_events` (global, só inserção pelo app) guarda acessos negados, buscas por ID sem resultado, logins falhos, webhooks inválidos e o modo suporte. | Seções 5 (CA1), 8, 9 e 11 |
| P16 | **Domínios.** O painel de todos os escritórios fica em `app.<domínio>`, e o portal e os links seguros ficam em `<slug>.<domínio>`. Os webhooks chegam em `app.<domínio>/api/webhooks/...`. Os cookies ficam presos ao host. O domínio próprio do escritório fica para depois do MVP. | Seções 8 e 13 |
| P17 | **KMS na AWS.** AWS KMS guarda a chave mestra da criptografia em envelope (certificados e credenciais de integração). Em desenvolvimento, testes e CI, uma chave local no `.env`, com dados fictícios. A conta e a chave na AWS são criadas antes de entrar o primeiro dado real da Contact (até 23/11/2026). | Seção 11; ADR 0006 |
| P18 | **Better Auth no lugar do Auth.js.** Link mágico, sessões no banco, TOTP, códigos de recuperação e limite de tentativas prontos. O plugin de organizações dele não é usado. | ADR 0007 |
| P19 | **Criação de escritório por comando do operador** (`pnpm tenant:create`), que cria o tenant e o convite do dono. O cadastro pela internet fica para "Portal com login e planos". | Seções 8 e 14 |
| P20 | **Fora da Fundação:** `entitlements` e `usage_counters` (entram com planos e com as integrações que geram consumo) e o fluxo do modo suporte (a Fundação deixa só o registro em `security_events` e `audit_logs`). | Seções 8, 9 e 14 |

**Decisões de 15/10/2026 (antes do incremento "Guias, templates e entrega"):**

| # | Decisão | Onde muda o plano |
| --- | --- | --- |
| P21 | **WhatsApp: número próprio do escritório é o único caminho no MVP.** Cada escritório conecta a própria conta oficial (WABA e número) em Conexões › WhatsApp; depois da aprovação como Tech Provider, pelo Embedded Signup. Um número geral da plataforma (envio em nome do escritório) fica para depois do MVP, como opção de início rápido, e só depois de conferir as políticas da Meta. Se entrar, vira ADR novo (muda o ADR 0008). | Seções 4 e 10; ADR 0008 |
| P22 | **Canal do cliente:** a entrega é por WhatsApp, e-mail ou os dois, conforme a preferência do contato. O portal é o último recurso e o arquivo histórico (guias e documentos antigos), não o caminho principal. Todo documento obtido automaticamente (DAS, recibos, comprovantes, CCMEI) também vai para o arquivo do cliente. | Seções 3 e 4 |
| P23 | **Ordem: Serpro antes da leitura de PDF em lote.** Guias, templates e entrega (16/10 a 06/11) → Serpro: DAS, recálculo e pagamentos (07/11 a 23/11, construído no ambiente trial e ligado em produção quando o contrato sair) → marco 23/11 → leitura de PDF em lote (ICMS, ISS, FGTS, PGFN). Contingência do marco: envio avulso de guia pelo WhatsApp. | Seção 14 |
| P24 | **O incremento da Serpro inclui a guia da DCTFWeb**, além do DAS: a maior parte dos clientes da Contact é do Lucro Presumido ou Real, e a guia federal mensal deles sai pela API depois da transmissão. Se não couber até 23/11, vem logo depois do marco. O Pedro abre a empresa e adianta o contrato da Serpro; conferir com a Contact se a atividade cabe no MEI e o limite de faturamento. | Seção 14 |
