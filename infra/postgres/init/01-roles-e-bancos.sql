-- Executado só na primeira subida do container (e no CI).
-- Em produção (Neon), os papéis de login são criados pelo runbook em docs/10-deploy-e-operacao.md.

-- Papel da aplicação (web e worker): sem superusuário e sem BYPASSRLS.
CREATE ROLE app LOGIN PASSWORD 'app' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- Banco usado pelos testes de integração e de isolamento.
CREATE DATABASE plataforma_test OWNER owner;
