-- Desfaz a 0003. Aplicar com o papel owner, só em caso de recuperação.
-- A 0003 expande: tabelas e tipos novos, duas colunas em tenant_settings e uma em documents.
-- Atenção: apaga guias, conexões de WhatsApp, entregas e links. Os PDFs no storage ficam.
DROP FUNCTION IF EXISTS channel_by_webhook_key(text);
DROP FUNCTION IF EXISTS channel_by_phone_number(text);
DROP TABLE IF EXISTS secure_link_accesses;
DROP TABLE IF EXISTS secure_links;
DROP TABLE IF EXISTS guide_events;
DROP TABLE IF EXISTS deliveries;
DROP TABLE IF EXISTS guides;
DROP TABLE IF EXISTS portal_login_codes;
DROP TABLE IF EXISTS tenant_alerts;
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS tenant_templates;
DROP TABLE IF EXISTS template_library;
DROP TABLE IF EXISTS credentials;
DROP TABLE IF EXISTS channels;
ALTER TABLE documents DROP COLUMN IF EXISTS send_to_client;
ALTER TABLE tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_reminder_days;
ALTER TABLE tenant_settings DROP CONSTRAINT IF EXISTS tenant_settings_delivery_hour;
ALTER TABLE tenant_settings DROP COLUMN IF EXISTS reminder_days_before;
ALTER TABLE tenant_settings DROP COLUMN IF EXISTS delivery_hour;
ALTER TABLE tenant_settings DROP COLUMN IF EXISTS reply_to_email;
DROP TYPE IF EXISTS secure_link_item;
DROP TYPE IF EXISTS guide_source;
DROP TYPE IF EXISTS guide_status;
DROP TYPE IF EXISTS guide_type;
DROP TYPE IF EXISTS delivery_status;
DROP TYPE IF EXISTS delivery_trigger;
DROP TYPE IF EXISTS delivery_channel;
DROP TYPE IF EXISTS delivery_item_type;
DROP TYPE IF EXISTS tenant_template_status;
DROP TYPE IF EXISTS template_category;
DROP TYPE IF EXISTS credential_kind;
DROP TYPE IF EXISTS channel_status;
DROP TYPE IF EXISTS channel_kind;
-- Os valores 'padrao_escritorio' e 'cliente' de consent_source ficam (o Postgres não remove
-- valor de enum), e o papel channel_resolver também; nenhum dos dois atrapalha a versão anterior.
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
