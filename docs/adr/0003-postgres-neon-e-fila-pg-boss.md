# ADR 0003 — Postgres gerenciado (Neon) e fila no próprio Postgres (pg-boss)

- **Status:** aceito
- **Data:** 14/10/2026
- **Origem:** plano, seções 7, 13 e 16

## Contexto e problema

A plataforma precisa de banco relacional com RLS, recuperação a um ponto no tempo e uma fila de jobs para as etapas do fluxo central (coletar → organizar → vincular → disponibilizar → enviar → acompanhar). Cada etapa é um job idempotente com `tenant_id`.

## Requisitos e restrições

- RPO de 15 min e RTO de 4 h (plano, seção 6).
- Menos componentes para operar.
- Jobs criados na mesma transação dos dados que os originam.

## Alternativas consideradas

1. **Postgres gerenciado com PITR (Neon) e fila no Postgres (pg-boss).**
2. **Postgres mais Redis com uma fila dedicada.** Descartado no MVP: mais um componente para operar, e a fila não participaria da transação dos dados.

## Decisão e justificativa

Postgres Neon em produção, com PITR, e Postgres em Docker no ambiente local. Fila com pg-boss no mesmo banco. Sem Redis no MVP, e os jobs nascem na mesma transação dos dados.

## Consequências

- **Positivas:** um componente a menos; enfileirar um job é atômico com a gravação do dado.
- **Negativas:** a fila tem menor vazão que Redis. As tabelas do pg-boss são globais e não têm RLS, então o isolamento dos jobs depende do `tenant_id` validado no payload (Zod) e do `SET LOCAL` aberto pelo worker antes de executar. Job sem tenant falha antes de executar.
- **Ponto técnico (recomendação):** `SET LOCAL` exige transação interativa. O driver HTTP do Neon não oferece isso, então a aplicação usa conexão por WebSocket ou TCP (`pg` com pool).

## Reavaliar quando

As campanhas passarem de cerca de 50 mil mensagens por dia.
