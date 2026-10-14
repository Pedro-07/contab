# Plano de testes

> Origem: Seção 12 do plano.

## 12. Estratégia de testes

Os testes de isolamento entre tenants bloqueiam o merge desde o primeiro dia. Vazamento entre escritórios é o defeito mais grave possível neste produto.

| Nível | O que cobre | Quando roda | Bloqueia |
| --- | --- | --- | --- |
| Unitário | Regras de status da guia, cálculo de janela de 24 h, leitura de PDF por modelo, avaliação de automações, política de limites | Cada commit | Merge |
| Integração | Banco real (Postgres em container) com RLS, filas, storage, autenticação | Cada PR | Merge |
| Contrato | Adaptadores Serpro, Meta e e-mail com respostas gravadas da sandbox; payloads de webhook reais | Cada PR + semanal contra sandbox | Merge |
| Isolamento multi-tenant | Lista abaixo, com dois tenants semeados | Cada PR | Merge |
| E2E (Playwright) | Login, envio em lote → cliente vê guia → atualiza → paga; inbox recebe e responde; campanha com opt-out | Cada PR em staging | Deploy |
| Segurança | SAST, auditoria de dependências, varredura de segredos, cabeçalhos e CSP | Cada PR | Merge |
| Performance | 1.000 webhooks por minuto; campanha de 5.000 mensagens sem atrasar o inbox | Antes de cada marco | Lançamento |
| Resiliência | Serpro fora do ar, timeout, webhook duplicado, worker reiniciado no meio do job | Antes de cada marco | Lançamento |
| Restauração | Restaurar backup em ambiente limpo e conferir integridade | Trimestral | — |

### Testes negativos de isolamento (obrigatórios)

- Usuário do tenant A lê, edita e exclui guia, documento, contato, conversa e campanha do tenant B: sempre 404, sem efeito no banco.
- ID trocado manualmente na URL e no corpo (IDOR/BOLA) em todos os endpoints. Gerado automaticamente a partir da lista de rotas.
- Membro de dois escritórios troca a organização ativa e não enxerga dados da anterior em listas, cache ou socket.
- Pessoa do portal vinculada à empresa X não acessa a empresa Y do mesmo tenant.
- Portal acessado pelo domínio do tenant A com sessão do tenant B: sessão rejeitada.
- Job sem `tenant_id`: falha antes de executar. Job com tenant errado: RLS bloqueia a escrita.
- Conexão do pool reutilizada não mantém o `app.tenant_id` da transação anterior.
- URL assinada de documento do tenant A não é gerada para usuário do tenant B, e expira em 5 min.
- Webhook com `phone_number_id` do tenant A nunca cria mensagem no tenant B.
- Busca, exportação, relatório e campanha nunca misturam tenants.
- Canal de tempo real de outro tenant: inscrição negada.
- Modo suporte do operador: só com justificativa, expira em 1 h e gera log de auditoria.

Cada teste verifica a resposta HTTP **e** o estado do banco, dos arquivos e dos logs.
