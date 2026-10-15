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

## Outras fontes avaliadas (15/10/2026)

Conferência de um levantamento externo sobre hubs fiscais e APIs oficiais:

| Fonte ou afirmação | O que confirmamos |
| --- | --- |
| Emissão da guia do FGTS Digital por API (Infosimples ou governo) | **Não confirmado.** O [Manual do FGTS Digital v1.50 (mar/2026)](https://www.gov.br/trabalho-e-emprego/pt-br/servicos/empregador/fgtsdigital/manual-e-documentacao-tecnica/manual-do-orientacao-do-fgts-digital-versao-1-50-20-03-2026.pdf) descreve só a emissão pelo portal, com login do empregador ou procurador. Automatizar exigiria credencial do cliente: proibido pelo `CLAUDE.md`. |
| DARE do ICMS por API | Só São Paulo oferece ([COAD](https://www.coad.com.br/home/noticias-detalhe/118760/sp-permite-que-empresas-emitam-documento-de-arrecadacao-por-meio-de-seus-proprios-sistemas)). O Maranhão emite pelo dareweb, sem API pública ([COAD](https://www.coad.com.br/home/noticias-detalhe/109354/sefaz-ma-disponibiliza-dare-com-nova-interface-e-melhor-desempenho)). |
| ISS pela API da NFS-e Nacional | Informa alíquotas, não emite a guia municipal. |
| FiscalAPI, dbdireto, LegisWeb | Mesma categoria da Infosimples (consultas, certidões, alíquotas). Não avaliados em detalhe; valem as mesmas condições acima. |

**Consequência:** ICMS-MA, ISS de São Luís e FGTS continuam no fluxo assistido (leitura de PDF). Para o SaaS, fica a ideia de um conector de DARE por estado, só onde houver API oficial (hoje, São Paulo), depois do MVP.
