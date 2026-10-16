-- 0004 — Conexão com a Receita (Serpro), chamadas, rotina fiscal e campos da guia (incremento 4).
-- Rollback: rollback/0004_serpro.down.sql (aplicar com o papel owner).

CREATE TYPE "public"."fiscal_call_kind" AS ENUM('consulta', 'emissao', 'declaracao', 'apoio');--> statement-breakpoint
CREATE TYPE "public"."fiscal_call_status" AS ENUM('em_andamento', 'sucesso', 'falhou');--> statement-breakpoint
CREATE TYPE "public"."fiscal_connection_status" AS ENUM('pendente', 'ativa', 'erro', 'desconectada');--> statement-breakpoint
CREATE TYPE "public"."fiscal_credential_kind" AS ENUM('serpro_termo_xml', 'serpro_procurador_token', 'serpro_consumer_key', 'serpro_consumer_secret', 'serpro_certificado', 'serpro_certificado_senha');--> statement-breakpoint
CREATE TYPE "public"."fiscal_mode" AS ENUM('plataforma', 'proprio');--> statement-breakpoint
CREATE TYPE "public"."fiscal_watch_kind" AS ENUM('das_mei', 'das_simples', 'dctfweb');--> statement-breakpoint
CREATE TYPE "public"."fiscal_watch_status" AS ENUM('aguardando', 'gerada', 'revisao', 'paga', 'desistiu');--> statement-breakpoint
CREATE TABLE "fiscal_calls" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"company_id" uuid,
	"guide_id" uuid,
	"system" text NOT NULL,
	"service" text NOT NULL,
	"kind" "fiscal_call_kind" NOT NULL,
	"purpose" text NOT NULL,
	"ambiente" text NOT NULL,
	"idempotency_key" text,
	"status" "fiscal_call_status" DEFAULT 'em_andamento' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"http_status" integer,
	"error_kind" text,
	"error_code" text,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "fiscal_calls_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "fiscal_calls_cost" CHECK ("fiscal_calls"."cost_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fiscal_connections" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"mode" "fiscal_mode" NOT NULL,
	"office_cnpj" text NOT NULL,
	"status" "fiscal_connection_status" DEFAULT 'pendente' NOT NULL,
	"status_reason" text,
	"term_valid_until" timestamp with time zone,
	"procurador_token_expires_at" timestamp with time zone,
	"breaker_failures" integer DEFAULT 0 NOT NULL,
	"breaker_first_failure_at" timestamp with time zone,
	"breaker_open_until" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "fiscal_connections_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "fiscal_connections_cnpj_format" CHECK ("fiscal_connections"."office_cnpj" ~ '^[0-9A-Z]{12}[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "fiscal_credentials" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" "fiscal_credential_kind" NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone,
	CONSTRAINT "fiscal_credentials_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "fiscal_credentials_kind_unique" UNIQUE("tenant_id","connection_id","kind")
);
--> statement-breakpoint
CREATE TABLE "fiscal_watches" (
	"tenant_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "fiscal_watch_kind" NOT NULL,
	"period" date NOT NULL,
	"status" "fiscal_watch_status" DEFAULT 'aguardando' NOT NULL,
	"next_check_at" timestamp with time zone,
	"checks" integer DEFAULT 0 NOT NULL,
	"guide_id" uuid,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_watches_tenant_id_id_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "fiscal_watches_unique" UNIQUE("tenant_id","company_id","kind","period"),
	CONSTRAINT "fiscal_watches_period_day_one" CHECK (extract(day from "fiscal_watches"."period") = 1)
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "mei_generation_day" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "guides" ADD COLUMN "external_number" text;--> statement-breakpoint
ALTER TABLE "guides" ADD COLUMN "receipt_storage_key" text;--> statement-breakpoint
ALTER TABLE "guides" ADD COLUMN "receipt_sha256" text;--> statement-breakpoint
ALTER TABLE "fiscal_calls" ADD CONSTRAINT "fiscal_calls_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_calls" ADD CONSTRAINT "fiscal_calls_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."client_companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_calls" ADD CONSTRAINT "fiscal_calls_guide_fk" FOREIGN KEY ("tenant_id","guide_id") REFERENCES "public"."guides"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_connections" ADD CONSTRAINT "fiscal_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_credentials" ADD CONSTRAINT "fiscal_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_credentials" ADD CONSTRAINT "fiscal_credentials_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."fiscal_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_watches" ADD CONSTRAINT "fiscal_watches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_watches" ADD CONSTRAINT "fiscal_watches_company_fk" FOREIGN KEY ("tenant_id","company_id") REFERENCES "public"."client_companies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_watches" ADD CONSTRAINT "fiscal_watches_guide_fk" FOREIGN KEY ("tenant_id","guide_id") REFERENCES "public"."guides"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_calls_idempotency" ON "fiscal_calls" USING btree ("tenant_id","idempotency_key") WHERE "fiscal_calls"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "fiscal_calls_month_idx" ON "fiscal_calls" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "fiscal_calls_guide_idx" ON "fiscal_calls" USING btree ("tenant_id","guide_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_connections_one_per_tenant" ON "fiscal_connections" USING btree ("tenant_id") WHERE "fiscal_connections"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "fiscal_watches_due_idx" ON "fiscal_watches" USING btree ("tenant_id","status","next_check_at");--> statement-breakpoint
CREATE UNIQUE INDEX "guides_external_number_unique" ON "guides" USING btree ("tenant_id","external_number") WHERE "guides"."external_number" is not null;--> statement-breakpoint
ALTER TABLE "guides" ADD CONSTRAINT "guides_receipt_key_tenant" CHECK ("guides"."receipt_storage_key" is null or "guides"."receipt_storage_key" like 'tenants/' || "guides"."tenant_id"::text || '/%');
--> statement-breakpoint

ALTER TABLE tenant_settings
  ADD CONSTRAINT tenant_settings_mei_generation_day CHECK (mei_generation_day between 1 and 19);
--> statement-breakpoint

-- RLS ativo e forçado em toda tabela nova do tenant (ADR 0002).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['fiscal_connections', 'fiscal_credentials', 'fiscal_calls', 'fiscal_watches']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id())', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- Permissões do papel da aplicação. Nada de DELETE (exclusão lógica).
GRANT SELECT, INSERT, UPDATE ON fiscal_connections, fiscal_credentials, fiscal_calls, fiscal_watches TO app;
