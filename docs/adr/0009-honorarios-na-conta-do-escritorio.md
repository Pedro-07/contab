# ADR 0009 — Honorários cobrados na conta do próprio escritório

- **Status:** aceito
- **Data:** 14/10/2026
- **Origem:** plano, seções 4, 10 e 16; decisão P10; RN15

## Contexto e problema

O escritório quer cobrar os próprios honorários por boleto e Pix, com régua pelo WhatsApp e baixa automática. Receber e repassar dinheiro de terceiros traria exigências de instituição de pagamento.

## Requisitos e restrições

- A plataforma nunca recebe nem repassa dinheiro.
- Uma cobrança por `(tenant, empresa, competência)`.
- Baixa só por webhook idempotente do provedor ou manual, com auditoria.

## Alternativas consideradas

1. **Plataforma recebe e repassa (subconta ou split).** Descartado: regulação de instituição de pagamento e risco financeiro.
2. **Cobrança na conta do escritório, via provedor dele.** Escolhida.

## Decisão e justificativa

O escritório conecta a própria conta de pagamento em Conexões › Cobrança. No MVP, o provedor é o Asaas, com a chave de API cifrada por tenant (ADR 0006). Outros provedores, como Inter ou Itaú, entram depois atrás do mesmo adaptador. As tarifas do provedor ficam com o escritório.

## Consequências

- **Positivas:** sem custódia de dinheiro; sem regulação de instituição de pagamento.
- **Negativas:** cada escritório precisa ter conta no provedor suportado.

## Reavaliar quando

Escritórios pedirem outro banco: nesse caso, entra um novo adaptador.
