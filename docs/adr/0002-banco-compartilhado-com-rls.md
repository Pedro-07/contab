# ADR 0002 — Banco e esquema compartilhados, com `tenant_id` e RLS

- **Status:** aceito
- **Data:** 14/10/2026
- **Origem:** plano, seções 8 e 16; decisão P15 (log de segurança)

## Contexto e problema

O tenant é o escritório de contabilidade, e as empresas-clientes ficam dentro dele. Vazamento de dados entre escritórios é o defeito mais grave possível no produto (plano, seção 12). A meta inicial é de até 20 escritórios e 2.000 empresas-clientes.

## Requisitos e restrições

- Isolamento tratado como requisito de segurança, em mais de uma camada.
- Operação compatível com um dev solo: uma migração e um backup.
- Custo de infraestrutura abaixo de R$ 50 por tenant por mês.

## Alternativas consideradas

| Modelo | Isolamento | Custo e operação | Veredito |
| --- | --- | --- | --- |
| Banco e esquema compartilhados + RLS | Bom, com duas camadas | Uma migração, um backup, barato | **Escolhido** |
| Esquema por tenant | Melhor | Migração × N esquemas, pool complexo | Não compensa para um dev solo |
| Banco por tenant | Máximo | Custo e operação multiplicados | Só se um contrato exigir |
| Híbrido | Flexível | Exige automação madura | Reavaliar com mais de 50 tenants |

## Decisão e justificativa

Banco e esquema compartilhados. Toda tabela tenant-scoped tem `tenant_id NOT NULL`, RLS ativo, chave composta `(tenant_id, id)` e estrangeiras compostas quando possível. O contexto vai para o banco com `SET LOCAL app.tenant_id` dentro de cada transação, o que é seguro com pool de conexões. A aplicação usa um papel sem `BYPASSRLS`, e as migrações usam outro papel.

O RLS é a **segunda** barreira. A primeira é a aplicação: todo repositório exige um `TenantContext`, e consulta sem tenant é erro.

**Log de segurança (P15).** Acesso a recurso de outro tenant responde 404 sem detalhes. Como o RLS esconde o recurso, o servidor não sabe (e não deve descobrir) se ele é de outro tenant ou se não existe. Por isso:

- Toda busca por ID sem resultado vai para `security_events`, uma tabela **global** em que o papel da aplicação só pode inserir (sem SELECT, UPDATE ou DELETE). Um alerta dispara por padrão de repetição.
- Ações de negócio ficam em `audit_logs`, por tenant e com RLS.
- O modo suporte do operador grava nas duas tabelas.

## Consequências

- **Positivas:** barato, uma migração, isolamento em duas camadas, testes negativos simples de montar com dois tenants semeados.
- **Negativas:** exige disciplina e testes de isolamento em todo PR. Tabelas globais (por exemplo, a fila do pg-boss e `security_events`) ficam fora do RLS e precisam de controles próprios. `security_events` registra também buscas legítimas por IDs inexistentes, então o alerta precisa ser por padrão, não por evento.

## Reavaliar quando

Um contrato exigir banco dedicado, ou a base passar de 50 tenants.
