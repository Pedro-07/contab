# ADR 0004 — Web na Vercel, worker no Railway, tempo real gerenciado e domínios

- **Status:** aceito
- **Data:** 14/10/2026
- **Origem:** plano, seções 7, 8, 13 e 16; decisão P16 (domínios)

## Contexto e problema

O web atende pessoas e webhooks; o worker executa processos longos. O inbox precisa mostrar mensagens recebidas em até 3 s. Cada escritório tem um endereço próprio para o portal (P6).

## Requisitos e restrições

- O Pedro já usa a Vercel, com DNS na Cloudflare.
- A Vercel não segura processos longos nem sockets.
- Operar um servidor de WebSocket próprio não cabe na rotina de um dev solo.
- Sessão de um escritório nunca pode valer no endereço de outro.

## Alternativas consideradas

- **Tempo real:** Ably ou Pusher (gerenciados) contra um servidor de WebSocket próprio. O próprio foi descartado pelo custo de operação.
- **Domínios (P16):** um subdomínio por escritório também para o painel, contra um painel único em `app.<domínio>`. O painel único foi escolhido porque o tenant do painel vem da sessão e da membership, e quem participa de dois escritórios troca a organização ativa sem trocar de endereço.

## Decisão e justificativa

- `apps/web` na Vercel; `apps/worker` no Railway.
- Tempo real gerenciado (Ably), com canais privados por tenant autorizados pelo servidor.
- **Domínios:**
  - `app.<domínio>`: painel de todos os escritórios e webhooks em `/api/webhooks/...`;
  - `<slug>.<domínio>`: portal do cliente e links seguros; o subdomínio resolve o tenant no servidor;
  - slugs reservados: `app`, `api`, `www`, `admin`, `status`, `mail`, `suporte`, `staging`, `docs`;
  - cookies presos ao host (prefixo `__Host-`, sem atributo `Domain`), com nomes diferentes no painel e no portal;
  - desenvolvimento em `app.localhost:3000` e `<slug>.localhost:3000`;
  - domínio-base lido de `APP_BASE_DOMAIN`, para trocar sem mudar código quando a marca (P7) for definida.

## Consequências

- **Positivas:** nenhum servidor para manter na mão; rollback em um clique na Vercel e no Railway; o subdomínio dá ao cliente final o endereço do escritório dele.
- **Negativas:** mais um fornecedor (Ably). **A verificar:** até onde se sabe, o certificado coringa da Vercel exige o DNS daquele domínio nos nameservers dela, o que conflita com o DNS na Cloudflare. Se confirmado, só o domínio do produto vai para a Vercel.

## Reavaliar quando

O custo de tempo real passar de R$ 150 por mês, ou um escritório pedir domínio próprio (fase posterior ao MVP).
