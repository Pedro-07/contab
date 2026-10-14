# ADR 0008 — WhatsApp como canal principal, com biblioteca de templates da plataforma

- **Status:** aceito
- **Data:** 14/10/2026
- **Origem:** plano, seções 4, 5 e 16; decisões P8 e P9; RN12 e RN13

## Contexto e problema

Nem todo cliente do escritório abre um portal. O WhatsApp é onde ele já está. Fora da janela de 24 h, a Meta só permite templates aprovados, e template rejeitado ou pausado interrompe a entrega.

## Requisitos e restrições

- A entrega automática pelo número do escritório é o núcleo do produto.
- O portal é opcional; cada mensagem leva um link seguro sem login.
- Os templates precisam ser aprovados no WABA de cada escritório.

## Alternativas consideradas

1. **Templates escritos livremente por cada escritório.** Descartado: aprovação e qualidade imprevisíveis, risco de bloqueio do número.
2. **Biblioteca mantida pela plataforma, submetida a cada WABA.** Escolhida.

## Decisão e justificativa

- O WhatsApp é o canal padrão, com cópia opcional por e-mail.
- A plataforma escreve, versiona e mantém os templates (`template_library`, global), todos na categoria utilidade, exceto o código de acesso (autenticação).
- Ao conectar o WABA, a biblioteca é submetida à Meta, e o status fica em `tenant_templates`.
- O escritório ativa templates e ajusta só campos permitidos, como nome e assinatura. Template novo passa por revisão da plataforma (fase posterior).
- Falha permanente no WhatsApp ou template pausado: o envio vai por e-mail e cria alerta no CRM (CA9).

## Consequências

- **Positivas:** aprovação e qualidade garantidas; menor risco de bloqueio.
- **Negativas:** o escritório tem menos liberdade de texto.

## Reavaliar quando

Houver muitos pedidos de template personalizado.
