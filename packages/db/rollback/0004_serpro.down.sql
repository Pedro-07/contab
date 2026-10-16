-- Desfaz a 0004. Aplicar com o papel owner, só em caso de recuperação.
-- A 0004 expande: tabelas e tipos novos, três colunas em guides e uma em tenant_settings.
-- Atenção: apaga a conexão com a Receita, o histórico de chamadas e a rotina do mês.
-- As guias geradas pela Serpro continuam (só perdem o número do documento e o comprovante).
DROP TABLE IF EXISTS fiscal_watches;
DROP TABLE IF EXISTS fiscal_calls;
DROP TABLE IF EXISTS fiscal_credentials;
DROP TABLE IF EXISTS fiscal_connections;
DROP INDEX IF EXISTS guides_external_number_unique;
ALTER TABLE guides DROP CONSTRAINT IF EXISTS guides_receipt_key_tenant;
ALTER TABLE guides DROP COLUMN IF EXISTS external_number;
ALTER TABLE guides DROP COLUMN IF EXISTS receipt_storage_key;
ALTER TABLE guides DROP COLUMN IF EXISTS receipt_sha256;
ALTER TABLE tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_mei_generation_day;
ALTER TABLE tenant_settings DROP COLUMN IF EXISTS mei_generation_day;
DROP TYPE IF EXISTS fiscal_watch_status;
DROP TYPE IF EXISTS fiscal_watch_kind;
DROP TYPE IF EXISTS fiscal_call_status;
DROP TYPE IF EXISTS fiscal_call_kind;
DROP TYPE IF EXISTS fiscal_credential_kind;
DROP TYPE IF EXISTS fiscal_connection_status;
DROP TYPE IF EXISTS fiscal_mode;
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
