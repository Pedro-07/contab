# Respostas gravadas do Integra Contador (ambiente trial)

Gravadas em 16/10/2026 de `https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1/`,
com o token público de demonstração e os CNPJs fictícios da documentação da Serpro. **Não há
dado real aqui.** Servem de teste de contrato do adaptador (plano, seção 12).

- PDFs completos só em `pgmei-gerardaspdf21`, `pgdasd-gerardas12` e `dctfweb-gerarguia31`
  (usados para testar a leitura do PDF); nos outros, o PDF foi trocado por um mínimo.
- `erro-limite-429.json`: resposta do gateway quando passa da cota (HTTP 429).
- `erro-servico-inexistente.json`: resposta para pedido fora dos cenários (HTTP 200 com status 400).
