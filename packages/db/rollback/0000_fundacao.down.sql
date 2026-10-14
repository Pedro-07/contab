-- Desfaz a 0000 (aplicar depois da 0001.down). Apaga todas as tabelas da Fundação.
-- Só para ambientes sem dados reais. Em produção, a recuperação é por PITR (docs/10-deploy-e-operacao.md).
DROP TABLE IF EXISTS audit_logs, invitations, memberships, tenant_settings, security_events, tenants,
  two_factors, verifications, accounts, sessions, rate_limits, users CASCADE;
DROP TYPE IF EXISTS audit_actor_type, member_role, security_event_type, tenant_status;
DROP SCHEMA IF EXISTS drizzle CASCADE;
