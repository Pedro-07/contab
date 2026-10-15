-- 0002 — Empresas-clientes, contatos, acesso ao portal e documentos (incremento 2).
-- Rollback: rollback/0002_clientes_documentos.down.sql (aplicar com o papel owner).

CREATE TYPE "public"."company_status" AS ENUM('ativa', 'inativa');--> statement-breakpoint
CREATE TYPE "public"."consent_channel" AS ENUM('whatsapp', 'email');--> statement-breakpoint
CREATE TYPE "public"."consent_source" AS ENUM('importacao', 'cadastro_manual');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('opt_in', 'opt_out');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('socio', 'financeiro', 'outro');--> statement-breakpoint
CREATE TYPE "public"."poa_status" AS ENUM('nao_verificada', 'ativa', 'vencida');--> statement-breakpoint
CREATE TYPE "public"."preferred_channel" AS ENUM('whatsapp', 'email', 'ambos');--> statement-breakpoint
CREATE TYPE "public"."tax_regime" AS ENUM('SN', 'MEI', 'LP', 'LR');--> statement-breakpoint
CREATE TYPE "public"."document_category" AS ENUM('contrato_social', 'cartao_cnpj', 'alvaras_licencas', 'certidoes', 'documentos_socios', 'outros');--> statement-breakpoint
CREATE TYPE "public"."document_version_status" AS ENUM('aguardando_envio', 'verificando', 'disponivel', 'rejeitado');--> statement-breakpoint
ALTER TYPE "public"."audit_actor_type" ADD VALUE 'contact';--> statement-breakpoint
CREATE TABLE "client_access" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "client_access_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "client_access_unique" UNIQUE("tenant_id","contact_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "client_companies" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"cnpj" text NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"regime" "tax_regime" NOT NULL,
	"state_registration" text,
	"municipal_registration" text,
	"status" "company_status" DEFAULT 'ativa' NOT NULL,
	"poa_status" "poa_status" DEFAULT 'nao_verificada' NOT NULL,
	"poa_valid_until" date,
	"responsible_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "client_companies_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "client_companies_cnpj_format" CHECK ("client_companies"."cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "company_contacts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" "contact_role" DEFAULT 'outro' NOT NULL,
	"receives_deliveries" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "company_contacts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "company_contacts_unique" UNIQUE("tenant_id","company_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "contact_consents" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" "consent_channel" NOT NULL,
	"status" "consent_status" NOT NULL,
	"source" "consent_source" NOT NULL,
	"actor_user_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_consents_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"preferred_channel" "preferred_channel" DEFAULT 'whatsapp' NOT NULL,
	"whatsapp_opt_in_at" timestamp with time zone,
	"email_opt_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contacts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "contacts_phone_e164" CHECK ("contacts"."phone" is null or "contacts"."phone" ~ '^\+[1-9][0-9]{7,14}$'),
	CONSTRAINT "contacts_phone_or_email" CHECK ("contacts"."phone" is not null or "contacts"."email" is not null)
);
--> statement-breakpoint
CREATE TABLE "portal_sessions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"contact_id" uuid NOT NULL,
	"active_company_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "portal_sessions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "portal_sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"status" "document_version_status" DEFAULT 'aguardando_envio' NOT NULL,
	"rejection_reason" text,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_versions_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "document_versions_number_unique" UNIQUE("tenant_id","document_id","version"),
	CONSTRAINT "document_versions_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "document_versions_storage_key_tenant" CHECK ("document_versions"."storage_key" like 'tenants/' || "document_versions"."tenant_id"::text || '/%'),
	CONSTRAINT "document_versions_size" CHECK ("document_versions"."size_bytes" > 0 and "document_versions"."size_bytes" <= 10485760)
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"category" "document_category" NOT NULL,
	"title" text NOT NULL,
	"visible_to_client" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "documents_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "client_access" ADD CONSTRAINT "client_access_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_access" ADD CONSTRAINT "client_access_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_access" ADD CONSTRAINT "client_access_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."client_companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_access" ADD CONSTRAINT "client_access_granted_by_fk" FOREIGN KEY ("tenant_id","granted_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_companies" ADD CONSTRAINT "client_companies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_companies" ADD CONSTRAINT "client_companies_responsible_fk" FOREIGN KEY ("tenant_id","responsible_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."client_companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contacts" ADD CONSTRAINT "company_contacts_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_consents" ADD CONSTRAINT "contact_consents_actor_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_active_company_fk" FOREIGN KEY ("tenant_id","contact_id","active_company_id") REFERENCES "public"."client_access"("tenant_id","contact_id","company_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_fk" FOREIGN KEY ("tenant_id","document_id") REFERENCES "public"."documents"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_uploaded_by_fk" FOREIGN KEY ("tenant_id","uploaded_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."client_companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_companies_tenant_cnpj_unique" ON "client_companies" USING btree ("tenant_id","cnpj") WHERE "client_companies"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "company_contacts_contact_idx" ON "company_contacts" USING btree ("tenant_id","contact_id");--> statement-breakpoint
CREATE INDEX "contact_consents_contact_idx" ON "contact_consents" USING btree ("tenant_id","contact_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_tenant_phone_unique" ON "contacts" USING btree ("tenant_id","phone") WHERE "contacts"."phone" is not null and "contacts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "contacts_tenant_email_idx" ON "contacts" USING btree ("tenant_id",lower("email"));--> statement-breakpoint
CREATE INDEX "documents_company_idx" ON "documents" USING btree ("tenant_id","company_id","category");--> statement-breakpoint

-- RLS ativo e forçado em toda tabela nova (ADR 0002). Mesma política padrão da 0001.
ALTER TABLE client_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_companies FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON client_companies
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
--> statement-breakpoint
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON contacts
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
--> statement-breakpoint
ALTER TABLE company_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company_contacts
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
--> statement-breakpoint
ALTER TABLE client_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_access FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON client_access
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
--> statement-breakpoint
ALTER TABLE portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON portal_sessions
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
--> statement-breakpoint
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON documents
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
--> statement-breakpoint
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON document_versions
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
--> statement-breakpoint
-- Histórico de consentimento: só inserção e leitura (RN7, registro).
ALTER TABLE contact_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_insert ON contact_consents FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id());
CREATE POLICY tenant_isolation_select ON contact_consents FOR SELECT
  USING (tenant_id = app_current_tenant_id());
--> statement-breakpoint

-- Permissões do papel da aplicação. Nada de DELETE (exclusão lógica).
GRANT SELECT, INSERT, UPDATE ON client_companies, contacts, company_contacts, client_access,
  portal_sessions, documents, document_versions TO app;
GRANT SELECT, INSERT ON contact_consents TO app;
