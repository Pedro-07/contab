# Pesquisa — Infosimples (APIs de consultas a portais públicos)

- **Data:** 15/10/2026
- **Fontes:** [infosimples.com](https://infosimples.com/), [preços](https://infosimples.com/consultas/precos/), [Sefaz-MA certidão negativa](https://infosimples.com/consultas/sefaz-ma-certidao-debitos/), [Sefaz-MA dívida ativa](https://infosimples.com/consultas/sefaz-ma-certidao-divida-ativa/), [Sintegra-MA](https://infosimples.com/consultas/sintegra-ma/)
- **Decisão:** **fora do MVP.** Candidata para depois, sobretudo para certidões automáticas.

## O que é

Consulta mais de 830 portais públicos (Receita, Sefaz, prefeituras, Sintegra etc.) e devolve os dados em JSON; também tem OCR de documentos. Preço por consulta, em faixas de R$ 0,20 (até 500 por mês) a R$ 0,09 (acima de 50 mil), com franquia mínima de R$ 100 por mês por conta e adicionais em algumas consultas. A página não informa SLA.

## Onde ajudaria

| Uso | Valor |
| --- | --- |
| Certidões negativas automáticas (Sefaz-MA, dívida ativa estadual e outras) emitidas todo mês e enviadas ao cliente ou ao escritório | Recurso novo, muito pedido por escritórios (bancos, licitações) |
| Cadastro preenchido pelo CNPJ e pelo Sintegra (inscrição estadual, regime de ICMS) | Menos digitação no cadastro e na importação; para os dados básicos do CNPJ há fontes gratuitas |

## Onde não ajuda

- Não encontramos emissão de DARE (ICMS-MA), ISS, FGTS ou PGFN: esses seguem no fluxo assistido com leitura de PDF.
- Dados federais (DAS, DCTFWeb, pagamentos) vêm da Serpro, fonte oficial (P1).

## Condições, se um dia entrar

1. Só como recurso de apoio, nunca no caminho principal da entrega: depende de sites públicos que mudam.
2. Só consultas por identificador público (CNPJ, CPF, inscrição estadual). Nada que exija certificado ou senha do cliente do escritório (regra do `CLAUDE.md`).
3. Adaptador em `packages/adapters` com timeout, retentativa, idempotência e custo por tenant; limite pelos `entitlements`.
4. Entra na lista pública de suboperadores (LGPD) e passa pela revisão do advogado (termos de uso dos portais).
