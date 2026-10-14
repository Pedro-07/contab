# ADR 0007 — Drizzle e Zod; Better Auth com link mágico, sessões no banco e TOTP

- **Status:** aceito (revisado em 14/10/2026: Auth.js trocado por Better Auth)
- **Data:** 14/10/2026
- **Origem:** plano, seções 9, 11 e 16; decisões P13, P14 e P18

## Contexto e problema

O acesso a dados precisa de SQL explícito para RLS, `SET LOCAL` e chaves compostas. Toda entrada (API, webhooks, jobs, env) precisa de validação. O login precisa de sessões revogáveis (plano, seção 11) e de MFA para quem mexe em credenciais.

## Requisitos e restrições

- TypeScript estrito, tipagem ponta a ponta.
- Dados de login no nosso Postgres, junto do isolamento por tenant.
- Sessões revogáveis no servidor.
- MFA obrigatório para dono e admin, que cadastram certificados, token do WhatsApp e chave do Asaas.
- Custo zero ou baixo. Dados reais da Contact entram por volta de 23/11/2026.

## Alternativas consideradas

- **ORM:** Drizzle contra Prisma. Prisma tem mais abstração e dificulta o controle fino do SQL de RLS.
- **Biblioteca de login:**
  - *Lucia:* descontinuado pelo autor.
  - *Auth.js:* escolhido primeiro (P13). Em 2025 passou a ser mantido pela equipe do Better Auth e recebe só correções. Não traz TOTP, códigos de recuperação nem limite de tentativas, que teriam de ser escritos à mão. O provider de senha (Credentials) só funciona com sessão JWT, que não pode ser revogada.
  - *Serviços pagos (Clerk, Auth0, WorkOS):* os usuários ficam fora do nosso banco, cobram por usuário e acrescentam um suboperador na LGPD.
  - *Supabase Auth:* só faz sentido com o banco no Supabase; escolhemos o Neon (ADR 0003).
  - *Better Auth:* **escolhido (P18).** Desenvolvimento ativo, roda dentro do sistema, com link mágico, sessões no banco, TOTP, códigos de recuperação e limite de tentativas prontos.
- **Momento do MFA:** na Fundação (escolhido) ou na fase "Segurança e piloto". Mudar o fluxo de login com usuários reais custa mais.

## Decisão e justificativa

- Drizzle ORM e Zod.
- Better Auth, isolado em `packages/auth`, com adaptador Drizzle e IDs UUID v7.
- **Link mágico** (plugin `magicLink`), enviado pelo adaptador de e-mail (Resend):
  - `disableSignUp: true`: o link só funciona para usuários que já existem, criados pelo aceite de convite ou pelo comando do operador;
  - `storeToken: "hashed"`: o token não fica em texto puro no banco;
  - validade de 15 min e uso único.
- **Sessões no banco**, revogáveis, com dois campos nossos: `activeTenantId` e `mfaVerifiedAt`. Cookie com prefixo `__Host-`.
- **TOTP e códigos de recuperação** pelo plugin `twoFactor`. Obrigatório para dono e admin, opcional para contador e atendente.
- **Trava do MFA é nossa.** O `twoFactor` do Better Auth só exige o segundo fator no login com senha; no link mágico ele não interfere. Por isso, o guard do painel exige `mfaVerifiedAt` na sessão quando o papel pede MFA e redireciona para a tela de código. A sessão só ganha `mfaVerifiedAt` depois de um código TOTP ou de recuperação válido.
- **Limite de tentativas** do Better Auth guardado no banco, não na memória, porque a Vercel roda várias instâncias.
- Não usamos o plugin `organization` do Better Auth: memberships e convites são tabelas nossas, com `tenant_id`, RLS e chaves compostas (ADR 0002).
- Passkeys ficam para a fase "Segurança e piloto". O login do portal (código no WhatsApp, P3) é outro fluxo, tratado no incremento do portal.

## Consequências

- **Positivas:** sessões revogáveis; nenhuma senha guardada; menos código de segurança escrito à mão; biblioteca em desenvolvimento ativo; tipagem ponta a ponta do banco à API.
- **Negativas:** biblioteca mais nova que o Auth.js, com menos histórico em produção; a trava do MFA no link mágico é código nosso e precisa de testes; o login depende da entrega do e-mail.
- **A confirmar na implementação:** como o plugin guarda o segredo TOTP (a documentação não diz). Se ele cifrar com o segredo da aplicação, aceitamos, porque o segredo TOTP sozinho não dá acesso: ainda é preciso o link mágico do e-mail. Se ficar em texto puro, ciframos com o adaptador de criptografia (ADR 0006).

## Reavaliar quando

A biblioteca perder manutenção, ou passkeys virarem o login principal. A troca fica contida em `packages/auth`.
