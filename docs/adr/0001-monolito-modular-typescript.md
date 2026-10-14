# ADR 0001 — Monólito modular em TypeScript

- **Status:** aceito
- **Data:** 14/10/2026
- **Origem:** plano, seções 7 e 16

## Contexto e problema

A plataforma tem um único desenvolvedor (Pedro, com Claude Code), um domínio de negócio só (escritórios de contabilidade) e prazo curto: entrega automática no ar em 23/11/2026 e MVP em 28/12/2026. Ela precisa atender pessoas (painel, portal, webhooks) e executar trabalho lento ou externo (Serpro, Meta, leitura de PDF, envios).

## Requisitos e restrições

- Deploy simples, que caiba na rotina de um dev solo.
- Nenhuma requisição de usuário espera pela Serpro ou pela Meta sem prazo.
- Fronteiras claras entre módulos para permitir separar depois.
- O Pedro já usa a Vercel.

## Alternativas consideradas

1. **Monólito modular com dois processos (web e worker) no mesmo repositório.**
2. **Microserviços por módulo** (fiscal, mensagens, CRM). Descartado: a skill de planejamento manda não adotar microserviços sem justificativa concreta, e o custo operacional é alto para um dev solo.
3. **Um processo único só na Vercel.** Descartado: a Vercel não segura processos longos nem sockets (ADR 0004).

## Decisão e justificativa

Monólito modular em TypeScript, num monorepo pnpm:

- `apps/web`: Next.js (App Router) para portal, painel, API e webhooks.
- `apps/worker`: Node, para tudo o que é lento ou externo.
- `packages/db`, `packages/domain`, `packages/adapters`, `packages/auth`.

Um único domínio, um desenvolvedor e deploy simples. Os módulos com fronteiras permitem separar um deles mais tarde.

## Consequências

- **Positivas:** um repositório, uma linguagem, tipos compartilhados entre web e worker, um pipeline de CI.
- **Negativas:** escala vertical antes de horizontal; um módulo pesado (campanhas) pode disputar recursos com os outros no worker.

## Reavaliar quando

Um módulo exigir escala ou deploy independente. O candidato provável é o de campanhas.
