-- Desfaz a 0001. Aplicar com o papel owner, só em caso de recuperação.
-- Atenção: sem esta migração, o isolamento por tenant fica só na aplicação.
-- Não aplicar em produção com o app no ar; preferir corrigir com uma migração nova.
REVOKE ALL ON security_events FROM app, security_reader;
REVOKE ALL ON audit_logs, memberships, invitations, tenant_settings FROM app;
REVOKE ALL ON users, sessions, accounts, verifications, two_factors, rate_limits, tenants FROM app;
DROP FUNCTION IF EXISTS invitation_lookup(text);
DROP POLICY IF EXISTS tenant_isolation_insert ON audit_logs;
DROP POLICY IF EXISTS tenant_isolation_select ON audit_logs;
DROP POLICY IF EXISTS tenant_isolation ON tenant_settings;
DROP POLICY IF EXISTS tenant_isolation ON invitations;
DROP POLICY IF EXISTS invitation_lookup ON invitations;
DROP POLICY IF EXISTS tenant_isolation ON memberships;
DROP POLICY IF EXISTS own_memberships_read ON memberships;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE invitations DISABLE ROW LEVEL SECURITY;
ALTER TABLE memberships DISABLE ROW LEVEL SECURITY;
DROP FUNCTION IF EXISTS app_current_user_id();
DROP FUNCTION IF EXISTS app_current_tenant_id();
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
