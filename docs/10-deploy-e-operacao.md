# Deploy e operação

> Origem: Seção 13 do plano.

## 13. Operação

A operação precisa caber na rotina de um desenvolvedor solo: tudo gerenciado, sem servidor para manter na mão, e com alertas que só tocam quando alguém precisa agir.

### Ambientes e entrega

- **Ambientes:** `local` (Docker com Postgres), `staging` (dados fictícios, sandbox da Serpro e número de teste do WhatsApp) e `production`.
- **Repositório:** monorepo com `apps/web` (Next.js), `apps/worker` e `packages/*` (domínio, banco, adaptadores). Usa lint, formatação, TypeScript estrito e conventional commits.
- **CI no GitHub Actions:** testes, verificações de segurança e testes de isolamento a cada PR. O deploy em staging é automático; a produção recebe deploy por tag, após o E2E passar em staging.
- **Migrações:** rodam antes do deploy do app e seguem o padrão expandir → migrar → contrair. Toda migração tem script de rollback ou um plano de recuperação escrito.
- **Rollback:** fica a um clique na Vercel e no Railway. Feature flags por tenant permitem ligar módulos aos poucos.
- **Segredos:** ficam em variáveis de ambiente dos provedores, nunca no repositório. A chave mestra dos certificados fica no KMS. A rotação de chaves é documentada.

### Observabilidade

- **Erros:** Sentry no web e no worker, com `tenant_id` como tag e sem conteúdo de mensagens.
- **Logs:** estruturados em JSON (Better Stack ou Axiom), com `request_id`, `tenant_id`, `job_id` e retenção de 30 dias.
- **Métricas por tenant:**
  - Guias publicadas, recalculadas e pagas.
  - Chamadas e custo da Serpro.
  - Mensagens por status.
  - Fila pendente.
  - Tempo do webhook até o inbox.
- **Alertas:**
  - Taxa de erro da Serpro acima de 20%.
  - Fila de jobs atrasada mais de 5 min.
  - Webhooks falhando.
  - Certificado vencendo.
  - Qualidade do número do WhatsApp caindo.
  - Backup falhou.
- **Uptime:** monitor externo do portal, da API e do endpoint de webhook, com página de status simples.

### Backup e recuperação

- **Postgres:** PITR de 7 dias (Neon ou equivalente) mais dump diário cifrado guardado em outro provedor.
- **Arquivos:** versionamento no bucket mais cópia semanal para outra conta.
- **Teste de restauração:** trimestral, com tempo medido contra o RTO de 4 h.

### Runbooks (procedimentos escritos)

1. Serpro fora do ar: ativar o disjuntor, avisar os escritórios e reprocessar a fila quando o serviço voltar.
2. Template rejeitado ou número com qualidade baixa na Meta.
3. Certificado vencido ou senha errada.
4. Webhook parado: reprocessar eventos a partir do painel da Meta.
5. Suspeita de acesso indevido: revogar sessões, girar credenciais e acionar o plano de incidente.
6. Restaurar o backup de um tenant (rotina por `tenant_id`).

### Suporte

O canal de suporte do escritório é o próprio WhatsApp do Pedro, com SLA de resposta em horário comercial. Os defeitos são registrados em issues do GitHub com prioridade: P1 (vazamento ou sistema fora do ar), P2 (função quebrada) e P3 (melhoria).

### Papéis do banco no Neon (Fundação)

A migração 0001 exige que o papel de login `app` já exista e recusa se ele for superusuário ou tiver `BYPASSRLS`. No Neon, antes do primeiro `pnpm db:migrate`:

1. Criar o papel `app` pelo console do Neon (ou com `CREATE ROLE app LOGIN PASSWORD '...' NOSUPERUSER NOBYPASSRLS`).
2. Conferir: `select rolsuper, rolbypassrls from pg_roles where rolname = 'app'` deve devolver `false, false`.
3. `DATABASE_URL` usa o papel `app`; `DATABASE_MIGRATOR_URL` usa o dono do banco. Só o pipeline de migração conhece a segunda.
4. Os papéis sem login `security_reader` e `invitation_resolver` são criados pela própria migração.
