-- Desfaz a 0002. Aplicar com o papel owner, só em caso de recuperação.
-- A 0002 só expande (tabelas e tipos novos): nada que já existia muda.
-- Atenção: apaga os dados de empresas, contatos e documentos. Os arquivos no storage
-- continuam lá e precisam ser apagados à parte, se for o caso.
DROP TABLE IF EXISTS portal_sessions;
DROP TABLE IF EXISTS client_access;
DROP TABLE IF EXISTS document_versions;
DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS contact_consents;
DROP TABLE IF EXISTS company_contacts;
DROP TABLE IF EXISTS contacts;
DROP TABLE IF EXISTS client_companies;
DROP TYPE IF EXISTS document_version_status;
DROP TYPE IF EXISTS document_category;
DROP TYPE IF EXISTS tax_regime;
DROP TYPE IF EXISTS preferred_channel;
DROP TYPE IF EXISTS poa_status;
DROP TYPE IF EXISTS contact_role;
DROP TYPE IF EXISTS consent_status;
DROP TYPE IF EXISTS consent_source;
DROP TYPE IF EXISTS consent_channel;
DROP TYPE IF EXISTS company_status;
-- O valor 'contact' de audit_actor_type fica: o Postgres não remove valor de enum,
-- e ele não atrapalha a versão anterior do código.
DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations);
