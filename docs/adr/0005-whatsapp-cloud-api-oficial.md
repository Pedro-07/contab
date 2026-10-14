# ADR 0005 — WhatsApp só pela Cloud API oficial, com o WABA de cada escritório

- **Status:** aceito
- **Data:** 14/10/2026
- **Origem:** plano, seções 10 e 16; decisão P2

## Contexto e problema

A entrega automática pelo WhatsApp é o núcleo do produto. As mensagens precisam sair do número do próprio escritório, sem risco de bloqueio do número.

## Requisitos e restrições

- Número e conta WhatsApp Business (WABA) do escritório; a plataforma só intermedia, como no Kommo.
- A Meta cobra as mensagens no meio de pagamento do escritório.
- A aprovação como Tech Provider ainda não saiu.

## Alternativas consideradas

1. **Cloud API oficial atrás de um adaptador.**
2. **APIs não oficiais (Baileys, Evolution).** Proibidas: arriscam o bloqueio do número do cliente.
3. **BSP (360dialog, Gupshup).** Mantido como plano B caso a verificação de Tech Provider demore ou seja negada (risco R5).

## Decisão e justificativa

Somente a Cloud API oficial, atrás de um adaptador em `packages/adapters`. Cada escritório usa o próprio WABA e número.

- **Agora:** conexão manual na tela Conexões › WhatsApp (WABA ID, Phone Number ID, token permanente de usuário do sistema e app secret). Cada tenant recebe URL de webhook e verify token próprios. A assinatura `X-Hub-Signature-256` é validada com o app secret.
- **Depois:** Embedded Signup, quando sair a aprovação de Tech Provider. O adaptador e as tabelas são os mesmos.

## Consequências

- **Positivas:** sem risco de bloqueio por uso de API não oficial; provedor trocável atrás do adaptador.
- **Negativas:** templates aprovados pela Meta, janela de 24 h para texto livre e custo por mensagem.
- **Em aberto:** a forma exata de identificar o tenant no webhook (URL por tenant ou `phone_number_id`) está registrada como inconsistência I2 em `08-riscos-e-viabilidade.md`.

## Reavaliar quando

Nunca para API não oficial. Para BSP, se a verificação de Tech Provider passar de 4 semanas ou for negada.
