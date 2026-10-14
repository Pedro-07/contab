# ADR 0006 — Certificados e credenciais: nenhum certificado de cliente no servidor

- **Status:** aceito
- **Data:** 14/10/2026
- **Origem:** plano, seções 10, 11 e 16; decisões P1 e P17; RN11

## Contexto e problema

O certificado digital é o ativo mais sensível da plataforma. A integração com a Serpro exige mTLS com o certificado do contratante e procuração eletrônica dos contribuintes.

## Requisitos e restrições

- O Pedro é o contratante do Integra Contador, como software house (modo plataforma, padrão).
- Escritórios com contrato próprio podem usar o modo próprio.
- Certificados de clientes do escritório nunca são aceitos.

## Alternativas consideradas

1. **Guardar o certificado de cada cliente no servidor.** Descartado: multiplica o risco sem necessidade.
2. **Guardar o certificado do escritório no servidor em todos os casos.** Descartado no modo plataforma: o escritório assina o termo localmente.
3. **Só o certificado do contratante no servidor, com criptografia em envelope.** Escolhido.

## Decisão e justificativa

| Certificado | Onde fica |
| --- | --- |
| e-CNPJ do Pedro (contratante Serpro) | Servidor, cifrado com KMS |
| e-CNPJ do escritório | Computador do escritório; assina o termo de autorização localmente (Assinador do Serpro no MVP, Web PKI depois) |
| Certificados dos clientes | Computador do escritório; usados uma vez para a procuração eletrônica no e-CAC |
| e-CNPJ do escritório no modo próprio | Servidor, cifrado com KMS (exceção) |

- Criptografia em envelope: chave mestra no **AWS KMS** (P17, região `sa-east-1`), chave de dados por tenant. O usuário IAM da aplicação só pode cifrar e decifrar com essa chave, e cada uso fica registrado no CloudTrail.
- Em desenvolvimento, testes e CI, o mesmo adaptador usa uma chave local do `.env`, só com dados fictícios. A troca é por configuração (`CRYPTO_PROVIDER`).
- O certificado é decifrado só em memória, no worker fiscal. Nunca vai para log, interface ou backup sem cifra.
- As outras credenciais (token do WhatsApp, chave do Asaas) usam o mesmo esquema. O segredo TOTP segue o ADR 0007.

## Consequências

- **Positivas:** o vazamento de um banco não expõe certificados de clientes; a superfície fica restrita ao worker.
- **Negativas:** latência e custo pequenos de KMS; o termo de autorização vence e precisa de nova assinatura (alertas 30, 7 e 1 dia antes).
- **Pendente:** criar a conta AWS e a chave antes do primeiro dado real da Contact (até 23/11/2026).

## Reavaliar quando

Surgir exigência de HSM dedicado.
