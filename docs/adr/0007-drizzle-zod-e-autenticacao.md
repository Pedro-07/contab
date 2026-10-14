# ADR 0007 — Drizzle e Zod; Auth.js com link mágico, sessões no banco e TOTP

- **Status:** aceito
- **Data:** 14/10/2026
- **Origem:** plano, seções 9, 11 e 16; decisões P13 e P14

## Contexto e problema

O acesso a dados precisa de SQL explícito para RLS, `SET LOCAL` e chaves compostas. Toda entrada (API, webhooks, jobs, env) precisa de validação. O login precisa de sessões revogáveis (plano, seção 11) e de MFA para quem mexe em credenciais.

## Requisitos e restrições

- TypeScript estrito, tipagem ponta a ponta.
- Sessões revogáveis no servidor.
- MFA obrigatório para dono e admin, que cadastram certificados, token do WhatsApp e chave do Asaas.
- Dados reais da Contact entram por volta de 23/11/2026.

## Alternativas consideradas

- **ORM:** Drizzle contra Prisma. Prisma tem mais abstração e dificulta o controle fino do SQL de RLS.
- **Sessão:** Auth.js contra Lucia. O Lucia foi descontinuado pelo autor; o Pedro escolheu Auth.js.
- **Login no Auth.js:**
  - *Credentials (e-mail e senha):* descartado, porque só funciona com sessão JWT, que não pode ser revogada no servidor;
  - *Link mágico por e-mail com sessões no banco:* escolhido.
- **Momento do MFA:** na Fundação ou na fase "Segurança e piloto". Escolhida a Fundação: mudar o fluxo de login com usuários reais custa mais.

## Decisão e justificativa

- Drizzle ORM e Zod.
- Auth.js com o provider de e-mail (link mágico, via Resend) e adaptador de banco: sessões em `sessions`, revogáveis. Não há senha no painel.
- TOTP implementado por nós, obrigatório para dono e admin e opcional para contador e atendente. Códigos de recuperação com hash e uso único. O segredo TOTP fica cifrado (ADR 0006). A sessão guarda `mfa_verified`, e as rotas do painel exigem essa marca quando o papel pede MFA.
- Passkeys ficam para a fase "Segurança e piloto".
- O login do portal (código no WhatsApp, P3) é outro fluxo, tratado no incremento do portal.

## Consequências

- **Positivas:** sessões revogáveis; nenhum hash de senha para vazar; tipagem ponta a ponta do banco à API.
- **Negativas:** o login depende da entrega do e-mail; TOTP e códigos de recuperação são código nosso, que precisa de testes; Drizzle tem menos mágica que Prisma.

## Reavaliar quando

A equipe crescer e preferir outra ferramenta, ou passkeys virarem o login principal.
