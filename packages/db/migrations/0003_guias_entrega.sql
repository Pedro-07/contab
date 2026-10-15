-- 0003 — Guias, WhatsApp, templates, entregas, links seguros e login do portal (incremento 3).
-- Rollback: rollback/0003_guias_entrega.down.sql (aplicar com o papel owner).

CREATE TYPE "public"."channel_kind" AS ENUM('whatsapp');--> statement-breakpoint
CREATE TYPE "public"."channel_status" AS ENUM('pendente', 'ativo', 'erro', 'desconectado');--> statement-breakpoint
CREATE TYPE "public"."credential_kind" AS ENUM('whatsapp_token', 'whatsapp_app_secret');--> statement-breakpoint
CREATE TYPE "public"."delivery_channel" AS ENUM('whatsapp', 'email');--> statement-breakpoint
CREATE TYPE "public"."delivery_item_type" AS ENUM('guia', 'documento');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('enfileirado', 'enviado', 'entregue', 'lido', 'falhou', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."delivery_trigger" AS ENUM('publicacao', 'lembrete', 'vencida', 'pago');--> statement-breakpoint
CREATE TYPE "public"."template_category" AS ENUM('UTILITY', 'AUTHENTICATION');--> statement-breakpoint
CREATE TYPE "public"."tenant_template_status" AS ENUM('enviado', 'aprovado', 'rejeitado', 'pausado', 'desativado');--> statement-breakpoint
CREATE TYPE "public"."guide_source" AS ENUM('avulsa', 'serpro', 'lote');--> statement-breakpoint
CREATE TYPE "public"."guide_status" AS ENUM('rascunho', 'publicada', 'vencida', 'paga', 'substituida', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."guide_type" AS ENUM('das_simples', 'das_mei', 'dctfweb', 'darf', 'icms', 'iss', 'fgts', 'pgfn', 'outro');--> statement-breakpoint
CREATE TYPE "public"."secure_link_item" AS ENUM('guia');--> statement-breakpoint
ALTER TYPE "public"."consent_source" ADD VALUE 'padrao_escritorio';--> statement-breakpoint
ALTER TYPE "public"."consent_source" ADD VALUE 'cliente';--> statement-breakpoint
CREATE TABLE "channels" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"kind" "channel_kind" DEFAULT 'whatsapp' NOT NULL,
	"waba_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"display_phone" text,
	"verified_name" text,
	"quality_rating" text,
	"status" "channel_status" DEFAULT 'pendente' NOT NULL,
	"status_reason" text,
	"webhook_key_hash" text NOT NULL,
	"verify_token_hash" text NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "channels_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "channels_webhookKeyHash_unique" UNIQUE("webhook_key_hash"),
	CONSTRAINT "channels_phone_number_id_unique" UNIQUE("phone_number_id")
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"kind" "credential_kind" NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "credentials_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "credentials_channel_kind_unique" UNIQUE("tenant_id","channel_id","kind")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"item_type" "delivery_item_type" NOT NULL,
	"item_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" "delivery_channel" NOT NULL,
	"trigger" "delivery_trigger" NOT NULL,
	"template_key" text NOT NULL,
	"status" "delivery_status" DEFAULT 'enfileirado' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"failure_reason" text,
	"fallback_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	CONSTRAINT "deliveries_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "deliveries_idempotency" UNIQUE("tenant_id","item_id","contact_id","channel","trigger"),
	CONSTRAINT "deliveries_provider_message_unique" UNIQUE("tenant_id","provider_message_id"),
	CONSTRAINT "deliveries_attempts" CHECK ("deliveries"."attempts" >= 0 and "deliveries"."attempts" <= 10)
);
--> statement-breakpoint
CREATE TABLE "template_library" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"language" text NOT NULL,
	"category" "template_category" NOT NULL,
	"header" text,
	"body" text NOT NULL,
	"variables" jsonb NOT NULL,
	"link_button" text,
	"email_subject" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_library_key_version_unique" UNIQUE("key","version","language")
);
--> statement-breakpoint
CREATE TABLE "tenant_templates" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"library_id" uuid NOT NULL,
	"meta_name" text NOT NULL,
	"meta_template_id" text,
	"status" "tenant_template_status" DEFAULT 'enviado' NOT NULL,
	"reason" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_templates_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "tenant_templates_unique" UNIQUE("tenant_id","channel_id","library_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "webhook_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "webhook_events_external_unique" UNIQUE("tenant_id","provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "guide_events" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"guide_id" uuid NOT NULL,
	"from_status" "guide_status",
	"to_status" "guide_status" NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_events_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "guides" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"type" "guide_type" NOT NULL,
	"period" date NOT NULL,
	"due_date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"barcode" text,
	"pix_code" text,
	"status" "guide_status" DEFAULT 'rascunho' NOT NULL,
	"source" "guide_source" NOT NULL,
	"replaces_guide_id" uuid,
	"pdf_storage_key" text,
	"pdf_sha256" text,
	"pdf_size_bytes" bigint,
	"created_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guides_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "guides_amount_positive" CHECK ("guides"."amount_cents" > 0),
	CONSTRAINT "guides_period_day_one" CHECK (extract(day from "guides"."period") = 1),
	CONSTRAINT "guides_pdf_key_tenant" CHECK ("guides"."pdf_storage_key" is null or "guides"."pdf_storage_key" like 'tenants/' || "guides"."tenant_id"::text || '/%')
);
--> statement-breakpoint
CREATE TABLE "portal_login_codes" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"used_at" timestamp with time zone,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portal_login_codes_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "secure_link_accesses" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" "inet",
	CONSTRAINT "secure_link_accesses_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "secure_links" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"item_type" "secure_link_item" NOT NULL,
	"item_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"access_count" integer DEFAULT 0 NOT NULL,
	"max_accesses" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "secure_links_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "secure_links_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tenant_alerts" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "tenant_alerts_tenant_id_id_pk" PRIMARY KEY("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "reminder_days_before" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "delivery_hour" integer DEFAULT 9 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "send_to_client" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_channel_fk" FOREIGN KEY ("tenant_id","channel_id") REFERENCES "public"."channels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."client_companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_templates" ADD CONSTRAINT "tenant_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_templates" ADD CONSTRAINT "tenant_templates_library_id_template_library_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."template_library"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_templates" ADD CONSTRAINT "tenant_templates_channel_fk" FOREIGN KEY ("tenant_id","channel_id") REFERENCES "public"."channels"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_events" ADD CONSTRAINT "guide_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_events" ADD CONSTRAINT "guide_events_guide_fk" FOREIGN KEY ("tenant_id","guide_id") REFERENCES "public"."guides"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guides" ADD CONSTRAINT "guides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guides" ADD CONSTRAINT "guides_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."client_companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guides" ADD CONSTRAINT "guides_replaces_fk" FOREIGN KEY ("tenant_id","replaces_guide_id") REFERENCES "public"."guides"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guides" ADD CONSTRAINT "guides_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_login_codes" ADD CONSTRAINT "portal_login_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portal_login_codes" ADD CONSTRAINT "portal_login_codes_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secure_link_accesses" ADD CONSTRAINT "secure_link_accesses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secure_link_accesses" ADD CONSTRAINT "secure_link_accesses_link_fk" FOREIGN KEY ("tenant_id","link_id") REFERENCES "public"."secure_links"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secure_links" ADD CONSTRAINT "secure_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secure_links" ADD CONSTRAINT "secure_links_guide_fk" FOREIGN KEY ("tenant_id","item_id") REFERENCES "public"."guides"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_alerts" ADD CONSTRAINT "tenant_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deliveries_item_idx" ON "deliveries" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "guide_events_guide_idx" ON "guide_events" USING btree ("tenant_id","guide_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "guides_active_unique" ON "guides" USING btree ("tenant_id","company_id","type","period") WHERE "guides"."status" in ('rascunho', 'publicada', 'vencida');--> statement-breakpoint
CREATE INDEX "guides_company_idx" ON "guides" USING btree ("tenant_id","company_id","period");--> statement-breakpoint
CREATE INDEX "guides_due_idx" ON "guides" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE INDEX "portal_login_codes_contact_idx" ON "portal_login_codes" USING btree ("tenant_id","contact_id","created_at");--> statement-breakpoint
CREATE INDEX "tenant_alerts_open_idx" ON "tenant_alerts" USING btree ("tenant_id","resolved_at","created_at");--> statement-breakpoint

ALTER TABLE tenant_settings
  ADD CONSTRAINT tenant_settings_reminder_days CHECK (reminder_days_before between 0 and 30),
  ADD CONSTRAINT tenant_settings_delivery_hour CHECK (delivery_hour between 0 and 23);
--> statement-breakpoint

-- RLS ativo e forçado em toda tabela nova do tenant (ADR 0002).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['channels', 'credentials', 'tenant_templates', 'webhook_events',
    'deliveries', 'guides', 'secure_links', 'portal_login_codes', 'tenant_alerts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id())', t);
  END LOOP;
  -- Históricos: só inserção e leitura.
  FOREACH t IN ARRAY ARRAY['guide_events', 'secure_link_accesses']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation_insert ON %I FOR INSERT WITH CHECK (tenant_id = app_current_tenant_id())', t);
    EXECUTE format('CREATE POLICY tenant_isolation_select ON %I FOR SELECT USING (tenant_id = app_current_tenant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Webhook do WhatsApp (I2): quem chega ainda não tem tenant. Duas funções devolvem só
-- (tenant_id, channel_id) de uma conexão ativa: pelo hash da chave secreta da URL
-- (conexão manual) ou pelo phone_number_id (Embedded Signup). Mesmo padrão da 0001.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'channel_resolver') THEN
    CREATE ROLE channel_resolver NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
CREATE POLICY channel_lookup ON channels FOR SELECT TO channel_resolver USING (true);
GRANT SELECT ON channels TO channel_resolver;
--> statement-breakpoint
CREATE FUNCTION channel_by_webhook_key(p_key_hash text)
  RETURNS TABLE (tenant_id uuid, channel_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT c.tenant_id, c.id FROM channels c
     WHERE c.webhook_key_hash = p_key_hash AND c.deleted_at IS NULL
  $$;
--> statement-breakpoint
CREATE FUNCTION channel_by_phone_number(p_phone_number_id text)
  RETURNS TABLE (tenant_id uuid, channel_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT c.tenant_id, c.id FROM channels c
     WHERE c.phone_number_id = p_phone_number_id AND c.deleted_at IS NULL
  $$;
--> statement-breakpoint
ALTER FUNCTION channel_by_webhook_key(text) OWNER TO channel_resolver;
ALTER FUNCTION channel_by_phone_number(text) OWNER TO channel_resolver;
REVOKE ALL ON FUNCTION channel_by_webhook_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION channel_by_phone_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION channel_by_webhook_key(text) TO app;
GRANT EXECUTE ON FUNCTION channel_by_phone_number(text) TO app;
--> statement-breakpoint

-- Permissões do papel da aplicação. Nada de DELETE (exclusão lógica).
GRANT SELECT ON template_library TO app;
GRANT SELECT, INSERT, UPDATE ON channels, credentials, tenant_templates, webhook_events,
  deliveries, guides, secure_links, portal_login_codes, tenant_alerts TO app;
GRANT SELECT, INSERT ON guide_events, secure_link_accesses TO app;
