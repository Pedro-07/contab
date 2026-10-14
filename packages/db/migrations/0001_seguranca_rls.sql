-- 0001 — Papéis, funções de contexto, RLS e permissões (ADR 0002, P15).
-- Rollback: rollback/0001_seguranca_rls.down.sql (aplicar com o papel owner).

-- Papéis sem login, criados aqui porque não têm senha. O papel de login "app"
-- é criado fora da migração (infra/postgres/init no local e no CI; runbook no Neon).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    RAISE EXCEPTION 'O papel "app" precisa existir antes desta migração (veja docs/10-deploy-e-operacao.md).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'O papel "app" não pode ser superusuário nem ter BYPASSRLS.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'security_reader') THEN
    CREATE ROLE security_reader NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'invitation_resolver') THEN
    CREATE ROLE invitation_resolver NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint

-- Contexto da transação. Devolvem NULL sem contexto, e o RLS falha fechado (zero linhas).
-- O nullif é necessário: depois de um SET LOCAL, a conexão do pool devolve '' e não NULL.
CREATE FUNCTION app_current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint

-- RLS ativo e forçado em toda tabela do tenant.
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON memberships
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
-- Exceção 1: o usuário lê as próprias memberships em qualquer tenant (lista de organizações).
CREATE POLICY own_memberships_read ON memberships FOR SELECT
  USING (user_id = app_current_user_id());
--> statement-breakpoint

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
-- Exceção 2: só o papel invitation_resolver (dono da função abaixo) lê sem contexto.
CREATE POLICY invitation_lookup ON invitations FOR SELECT TO invitation_resolver
  USING (true);
--> statement-breakpoint

ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_settings
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
--> statement-breakpoint

-- Exceção 3: auditoria só aceita inserção e leitura.
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_insert ON audit_logs FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_select ON audit_logs FOR SELECT
  USING (tenant_id = app_current_tenant_id());
--> statement-breakpoint

-- Aceite de convite: quem abre o link ainda não tem tenant. A função recebe o hash
-- de um token de 256 bits e devolve só (tenant_id, invitation_id) de um convite válido.
CREATE FUNCTION invitation_lookup(p_token_hash text)
  RETURNS TABLE (tenant_id uuid, invitation_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT i.tenant_id, i.id
      FROM invitations i
     WHERE i.token_hash = p_token_hash
       AND i.accepted_at IS NULL
       AND i.revoked_at IS NULL
       AND i.expires_at > now()
  $$;
--> statement-breakpoint
GRANT SELECT ON invitations TO invitation_resolver;
ALTER FUNCTION invitation_lookup(text) OWNER TO invitation_resolver;
REVOKE ALL ON FUNCTION invitation_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_lookup(text) TO app;
--> statement-breakpoint

-- Permissões do papel da aplicação. Nada de DELETE nas tabelas do tenant (exclusão lógica).
GRANT USAGE ON SCHEMA public TO app, security_reader;
GRANT SELECT, INSERT ON tenants TO app;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, sessions, accounts, verifications, two_factors, rate_limits TO app;
GRANT SELECT, INSERT, UPDATE ON memberships, invitations, tenant_settings TO app;
GRANT SELECT, INSERT ON audit_logs TO app;
-- Log de segurança: o app só insere; o operador lê com security_reader.
GRANT INSERT ON security_events TO app;
GRANT SELECT ON security_events TO security_reader;
