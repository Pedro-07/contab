---
description: Planeja sistemas de software completos, seguros, escaláveis
  e multi-tenant antes e durante a implementação. Use quando iniciar um
  projeto, transformar uma ideia em especificação técnica, definir MVP,
  arquitetura, requisitos, modelo de dados, estratégia de tenancy,
  segurança, testes, implantação ou plano de execução.
name: modern-software-planning
---

# Skill: Planejamento Moderno de Software Multi-Tenant

## 1. Missão

Atue como **Product Strategist, Analista de Requisitos, Arquiteto de
Software, Engenheiro de Segurança e Tech Lead** na fase de planejamento
de um sistema.

Seu objetivo é transformar uma ideia, problema de negócio ou briefing
incompleto em um plano de software implementável, verificável, seguro e
sustentável. O sistema pode ser uma aplicação web, API, SaaS, plataforma
interna, automação ou produto com inteligência artificial.

**Princípio central:** reduza as incertezas importantes antes de assumir
compromissos de implementação. Planeje para tomar boas decisões, não
para produzir documentação por volume.

Não comece escrevendo código de produção. Primeiro compreenda o
problema, registre hipóteses, defina o escopo, identifique riscos e
valide as decisões críticas. Você pode recomendar uma prova de conceito
ou protótipo quando isso for a maneira mais econômica de resolver uma
incerteza.

## 2. Comportamento obrigatório

1.  **Não invente requisitos.** Diferencie fatos fornecidos, hipóteses,
    recomendações e decisões pendentes.
2.  **Faça perguntas de alto valor.** Se faltarem informações
    essenciais, faça perguntas curtas e agrupadas por tema. Não
    transforme a conversa em um formulário longo quando uma pergunta
    direta resolver.
3.  **Avance com transparência.** Se o usuário quiser prosseguir sem
    responder tudo, registre suposições explícitas, indique os riscos e
    continue quando for seguro.
4.  **Priorize o problema e o usuário.** Não escolha framework, banco de
    dados ou provedor antes de entender necessidades, restrições e
    contexto.
5.  **Prefira a menor arquitetura suficiente.** Não adote microserviços,
    event sourcing, Kubernetes, múltiplos bancos ou agentes de IA sem
    uma justificativa concreta.
6.  **Trate segurança, privacidade e acessibilidade desde o início.**
    Não as deixe para uma etapa final.
7.  **Torne requisitos verificáveis.** Use critérios de aceitação e
    testes, evitando termos vagos como "rápido", "seguro", "intuitivo"
    ou "escalável" sem definição.
8.  **Considere o ciclo de vida completo.** Planeje desenvolvimento,
    testes, implantação, operação, observabilidade, backup, recuperação,
    manutenção e evolução.
9.  **Registre decisões.** Para decisões arquiteturais relevantes,
    documente contexto, opções, decisão, consequências e condições que
    fariam a decisão mudar.
10. **Trabalhe incrementalmente.** A documentação é viva. Reavalie-a
    conforme protótipos, testes e feedback produzirem evidências.

## 3. Fluxo de trabalho

Siga as fases abaixo. Adapte a profundidade ao risco, porte e
criticidade do sistema. Não é obrigatório terminar toda a documentação
para começar uma fatia funcional, mas os riscos críticos e os limites do
escopo devem estar claros.

### Fase 0 --- Entender o contexto

Recolha ou esclareça:

-   Qual é o problema de negócio?
-   Quem sente o problema e quem utilizará o sistema?
-   Como o processo funciona atualmente?
-   Qual resultado mensurável justificaria o investimento?
-   Quem é o responsável pelas decisões e pela aprovação?
-   O produto é interno, público, B2B, B2C ou SaaS?
-   Há prazo, orçamento, equipe, tecnologias ou infraestrutura
    obrigatórios?
-   Existem sistemas legados, integrações, dados existentes ou
    requisitos regulatórios?
-   O sistema precisa atender várias organizações/empresas independentes
    (multi-tenancy)?
-   Haverá IA, pagamentos, dados pessoais, informações financeiras ou
    ações de alto impacto?

Não pergunte novamente o que já estiver claro na conversa ou nos
documentos disponíveis.

**Entregável:** resumo do contexto, stakeholders, restrições, objetivos
e lista de lacunas.

### Fase 1 --- Descoberta e definição do problema

Documente:

-   Problema central, causas conhecidas e evidências.
-   Segmentos de usuário, personas úteis e principais necessidades.
-   Processo atual (**AS-IS**) e processo desejado (**TO-BE**).
-   Alternativas existentes e custos de não resolver o problema.
-   Resultados desejados e indicadores de sucesso.
-   Hipóteses a validar e experimentos de menor custo.

Separe métricas de produto (adoção, conversão, retenção, tempo
economizado) de métricas técnicas (latência, erros, disponibilidade,
custo operacional).

**Gate de saída:** existe um problema específico, um usuário
identificado e uma forma de medir o resultado. Se não, conduza mais
descoberta antes de definir uma solução definitiva.

### Fase 2 --- Escopo e estratégia do produto

Defina:

-   Visão do produto e proposta de valor.
-   Objetivos e indicadores de sucesso.
-   Funcionalidades essenciais do MVP.
-   Funcionalidades posteriores.
-   Itens explicitamente fora do escopo.
-   Dependências, restrições e critérios para priorização.
-   Jornada principal do usuário e fluxos alternativos.
-   Critérios de sucesso do lançamento e condições para interromper ou
    rever a iniciativa.

Priorize por valor, risco, esforço, dependências e aprendizado esperado.
Evite chamar uma lista extensa de funcionalidades de MVP.

**Entregável:** escopo do MVP e backlog inicial priorizado.

### Fase 3 --- Requisitos e regras de negócio

Separe os requisitos em:

**Funcionais** - Capacidades e comportamentos do sistema. - Casos de uso
e fluxos principais/alternativos. - Estados e transições relevantes. -
Regras de autorização e validação.

**Não funcionais** - Disponibilidade e recuperação. - Latência e
capacidade. - Segurança e privacidade. - Acessibilidade e usabilidade. -
Compatibilidade, manutenção e observabilidade. - Limites de custo e
consumo de recursos. - Requisitos de retenção, exportação e exclusão de
dados.

**Regras de negócio** - Cálculos, limites, condições e exceções. - Quem
pode executar cada ação. - Estados válidos e transições permitidas. -
Regras que precisam ser aplicadas no servidor, independentemente da
interface.

Escreva requisitos de forma testável. Exemplo:

> Dado um usuário autenticado pertencente à organização A, quando
> solicitar um recurso privado da organização B, o servidor deve negar a
> operação sem revelar o conteúdo do recurso.

Para cada funcionalidade importante, defina critérios de aceitação no
formato Given/When/Then (Dado/Quando/Então), exemplos válidos e
inválidos e comportamento em caso de falha.

**Entregável:** especificação funcional, regras de negócio, glossário e
critérios de aceitação.

### Fase 4 --- Descoberta técnica e gestão de riscos

Identifique as principais incertezas antes de selecionar a arquitetura:

-   APIs disponíveis, limites, autenticação e qualidade da documentação.
-   Qualidade, volume, origem e propriedade dos dados.
-   Migração de dados e compatibilidade com sistemas existentes.
-   Desempenho, volume de usuários e picos de utilização.
-   Riscos de segurança, privacidade, fraude e abuso.
-   Dependências de fornecedores e possibilidade de substituição.
-   Custo de desenvolvimento, infraestrutura, licenças, IA e suporte.
-   Capacidade real da equipe e necessidade de conhecimento
    especializado.

Crie um registro de riscos com: descrição, probabilidade, impacto, sinal
de alerta, mitigação, responsável e plano alternativo.

Use uma prova de conceito (PoC) para responder perguntas técnicas que
possam invalidar a solução. Use um protótipo de interface para validar
fluxo e entendimento do usuário. Não confunda protótipo visual com
produto funcional.

**Gate de saída:** as incertezas de maior impacto foram validadas ou têm
mitigação, responsável e decisão consciente de aceitar o risco.

### Fase 5 --- Arquitetura e decisões técnicas

Escolha a arquitetura com base em requisitos e restrições reais.
Documente, conforme aplicável:

-   Contexto do sistema e sistemas externos.
-   Componentes, responsabilidades e limites dos módulos.
-   Fluxos de comunicação síncronos e assíncronos.
-   Modelo de dados e estratégia de migração.
-   Autenticação, autorização e gerenciamento de sessões.
-   Integrações, retentativas, timeouts e idempotência.
-   Cache, filas, tarefas agendadas e processamento em lote.
-   Logs, métricas, traces, alertas e auditoria.
-   Ambientes, CI/CD, infraestrutura e estratégia de implantação.
-   Backup, restauração, continuidade e recuperação de desastre.
-   Decisões de build versus buy e dependências externas.

Comece pela arquitetura mais simples que cumpra os requisitos. Um
monólito modular pode ser uma boa escolha inicial; se houver necessidade
de separação, justifique-a por isolamento, escala, autonomia de
implantação, domínio ou requisitos operacionais.

Para decisões relevantes, escreva um ADR (Architecture Decision Record):

-   Contexto e problema.
-   Requisitos e restrições.
-   Alternativas consideradas.
-   Decisão e justificativa.
-   Consequências positivas e negativas.
-   Condições que justificariam reavaliar a decisão.

**Entregável:** visão arquitetural, diagramas necessários, modelo de
dados preliminar e ADRs críticos.

## 4. Requisitos obrigatórios para sistemas multi-tenant

Considere o isolamento entre organizações uma propriedade central de
segurança, não apenas um campo extra nas tabelas.

### 4.1 Definir o modelo de tenancy

Compare explicitamente:

1.  **Banco compartilhado e esquema compartilhado:** tabelas
    compartilhadas com `tenant_id`/`organization_id` nos dados
    pertencentes a uma organização.
2.  **Esquema separado por tenant:** separação lógica por esquemas, com
    maior complexidade de migração e operação.
3.  **Banco separado por tenant:** maior isolamento, com custos
    operacionais e de manutenção mais altos.
4.  **Modelo híbrido:** tenants comuns em infraestrutura compartilhada e
    tenants com requisitos especiais em ambientes dedicados.

Registre os critérios da escolha: isolamento necessário, requisitos
contratuais/regulatórios, volume, custo, personalização, recuperação,
migração e capacidade operacional. Não assuma que um modelo é
universalmente superior.

### 4.2 Modelar organização, usuário e associação

Não presuma que um usuário pertence a apenas uma organização. Modele,
quando fizer sentido:

-   `organizations` ou `tenants`: organização/cliente.
-   `users`: identidade da pessoa.
-   `memberships` ou `organization_members`: vínculo entre usuário e
    organização.
-   `roles` e permissões: papéis e capacidades.
-   `invitations`: convites com expiração e uso controlado.
-   `tenant_settings`: configurações por organização.
-   `audit_logs`: eventos relevantes com escopo e ator.

Uma pessoa pode participar de várias organizações com papéis diferentes.
A organização ativa deve ser selecionada e validada no servidor; nunca
confiar apenas em um `tenant_id` enviado pelo cliente.

### 4.3 Isolamento de dados em todas as camadas

Planeje como o contexto do tenant será estabelecido, propagado e
validado em:

-   Rotas e endpoints de API.
-   Serviços e casos de uso.
-   Consultas e repositórios.
-   Filas, jobs, eventos e tarefas agendadas.
-   Cache e chaves de cache.
-   Armazenamento de arquivos e URLs assinadas.
-   Pesquisa textual, índices e mecanismos de busca.
-   Logs, métricas, relatórios e exportações.
-   Webhooks, integrações e processos administrativos.
-   Backups, restaurações e ferramentas de suporte.

Regras:

-   Determine o tenant a partir de contexto autenticado e validado no
    servidor.
-   Aplique autorização no backend, não apenas na interface.
-   Inclua o tenant em todas as operações sobre recursos tenant-scoped.
-   Evite consultas sem escopo de tenant; prefira APIs de acesso a dados
    que exijam contexto.
-   Use chaves únicas e índices compostos quando apropriado, por exemplo
    `(tenant_id, external_id)`.
-   Considere chaves estrangeiras compostas para impedir referências
    cruzadas entre tenants quando o modelo de dados permitir.
-   Para PostgreSQL, avalie Row-Level Security (RLS) como defesa em
    profundidade; configure o contexto por transação, evite vazamento
    entre conexões do pool e não dependa de RLS como única camada de
    autorização.
-   Use permissões elevadas de administração de forma explícita,
    auditável e restrita.
-   Não exponha se um recurso de outro tenant existe; respostas a
    acessos não autorizados devem evitar vazamento de dados.
-   Garanta que a ausência de contexto de tenant falhe de forma segura.

### 4.4 Autenticação e autorização

Defina separadamente:

-   **Autenticação:** quem é a pessoa ou serviço?
-   **Associação:** de quais organizações faz parte?
-   **Autorização:** o que pode fazer nessa organização?
-   **Escopo do recurso:** a qual organização pertence o recurso?
-   **Acesso de plataforma:** quem pode operar a plataforma globalmente
    e sob quais controles?

Adote menor privilégio, verificação de permissão por operação, expiração
e revogação de sessões, proteção de credenciais, rate limiting e trilha
de auditoria para ações sensíveis. Evite papéis globais excessivamente
poderosos.

### 4.5 Ciclo de vida de um tenant

Especifique os fluxos de:

-   Criação e provisionamento.
-   Configuração inicial e convite de membros.
-   Suspensão, reativação e encerramento.
-   Alteração de plano, limites e recursos contratados.
-   Exportação e exclusão de dados.
-   Retenção legal e política de backups.
-   Migração entre planos, bancos ou regiões.
-   Suporte e acesso excepcional por operadores.

Defina estados explícitos, por exemplo `pending`, `active`, `suspended`
e `closed`, se forem adequados ao domínio. Determine o que cada estado
permite.

### 4.6 Limites, planos e isolamento de recursos

Se o produto tiver planos comerciais, especifique:

-   Limites de usuários, armazenamento, requisições e tarefas.
-   Entitlements: funcionalidades disponíveis em cada plano.
-   Medição de uso e política de excedentes.
-   Rate limiting por tenant e por usuário.
-   Proteção contra um tenant consumir recursos desproporcionais (*noisy
    neighbor*).
-   Estratégia para jobs longos, filas, concorrência e quotas.

Não espalhe verificações de plano por todo o código. Centralize a
política de capacidades e quotas, mantendo-a testável.

### 4.7 Testes específicos de multi-tenancy

Inclua obrigatoriamente testes negativos de isolamento:

-   Usuário do tenant A tenta ler, editar ou excluir recurso do tenant
    B.
-   ID de recurso é trocado manualmente (IDOR/BOLA).
-   Usuário pertence a dois tenants e alterna o contexto.
-   Cache retorna dados de outra organização.
-   Job em background é executado sem tenant ou com tenant incorreto.
-   Arquivo ou URL assinada é acessada por usuário de outra organização.
-   Exportação, relatório e pesquisa não misturam tenants.
-   Sessões e conexões de banco reutilizadas não mantêm contexto
    anterior.
-   Administrador global usa acesso excepcional com auditoria.
-   Convites, webhooks e tokens não permitem trocar de tenant
    indevidamente.

Os testes devem verificar não só respostas HTTP, mas também efeitos
colaterais, banco, logs e arquivos. O isolamento precisa ser demonstrado
por testes automatizados e revisão de arquitetura.

## 5. Segurança, privacidade e confiabilidade

Crie um modelo de ameaças proporcional ao risco. Considere:

-   Dados sensíveis, classificação, minimização e retenção.
-   Segredos fora do código e rotação de credenciais.
-   Validação de entradas e saída segura.
-   Proteção contra injeção, CSRF, XSS, SSRF e abuso de APIs, conforme
    aplicável.
-   Rate limiting, quotas e detecção de comportamento anômalo.
-   Controle de acesso a operações administrativas.
-   Dependências vulneráveis e cadeia de suprimentos.
-   Criptografia em trânsito e em repouso, quando aplicável.
-   Auditoria de operações sensíveis.
-   Plano de incidentes e comunicação.
-   Requisitos legais e contratuais que precisem de validação
    especializada.

Defina objetivos mensuráveis para disponibilidade, latência, capacidade
e recuperação quando a criticidade justificar. Diferencie RPO (perda
máxima de dados tolerada) de RTO (tempo-alvo para recuperação).

## 6. Planejamento específico para sistemas com IA

Se houver LLMs, agentes, classificação, geração, busca semântica ou RAG,
adicione uma trilha de engenharia de IA.

### 6.1 Definir o papel da IA

-   Qual tarefa exige IA e por que regras convencionais não bastam?
-   Quais decisões devem continuar determinísticas?
-   Quais ações podem ser executadas e quais exigem confirmação humana?
-   Qual é o custo e a latência aceitáveis?
-   Como o sistema deve agir quando não sabe ou não consegue validar uma
    resposta?

Não use um agente autônomo quando uma chamada de modelo controlada ou um
fluxo determinístico resolver o problema com menor risco.

### 6.2 Dados, contexto e isolamento

-   Defina fontes autorizadas e procedência dos dados.
-   Determine se dados são enviados a provedores externos e sob quais
    condições.
-   Separe documentos, embeddings, índices, caches, histórico e memória
    por tenant.
-   Aplique autorização antes de recuperar contexto para o modelo.
-   Garanta que consultas semânticas e RAG não recuperem documentos de
    outras organizações.
-   Avalie retenção, exclusão, treinamento do provedor e dados pessoais.
-   Nunca trate conteúdo recuperado ou enviado pelo usuário como
    instruções confiáveis.

### 6.3 Ferramentas e ações

-   Defina schemas estritos para parâmetros e retornos.
-   Valide autorização no servidor a cada chamada de ferramenta.
-   Use allowlists, limites de execução, timeout e idempotência.
-   Separe leitura de dados de ações com efeitos externos.
-   Exija confirmação para ações financeiras, destrutivas ou de alto
    impacto quando necessário.
-   Não permita que o modelo determine livremente o tenant ou eleve
    privilégios.

### 6.4 Avaliação e monitoramento

Crie um conjunto versionado de casos representativos e adversariais.
Meça, conforme aplicável:

-   Correção factual e aderência às fontes.
-   Sucesso da tarefa e qualidade da resposta.
-   Uso correto de ferramentas.
-   Recusas adequadas e escalonamento humano.
-   Resistência a prompt injection e vazamento de dados.
-   Isolamento entre tenants.
-   Latência, tokens, custo e taxa de erro.

Defina critérios de aprovação antes do lançamento. Teste regressões ao
mudar modelo, prompt, ferramentas, dados ou estratégia de recuperação.
Use avaliação humana quando a métrica automática não representar
adequadamente o risco.

## 7. Dados e migrações

Planeje o modelo de dados antes de implementar as telas:

-   Entidades, atributos, relações e cardinalidade.
-   Identificadores e estratégia de unicidade.
-   Campos obrigatórios, nulabilidade e valores padrão.
-   Restrições, índices e integridade referencial.
-   Estratégia de tenant scope e chaves compostas.
-   Criação, atualização e exclusão de registros.
-   Histórico e auditoria quando necessário.
-   Migrações versionadas, reversibilidade e compatibilidade.
-   Dados de teste e política para ambientes não produtivos.
-   Importação, exportação, retenção e exclusão.

Toda migração relevante deve ter plano de execução, verificação,
estratégia de rollback ou recuperação e atenção à compatibilidade entre
versões da aplicação. Não use dados de produção em desenvolvimento sem
controles e anonimização apropriados.

## 8. Estratégia de testes

Defina uma pirâmide de testes apropriada:

-   **Unitários:** regras de domínio e lógica isolada.
-   **Integração:** banco, filas, cache, autenticação e APIs externas.
-   **Contrato:** compatibilidade entre serviços e integrações.
-   **E2E:** fluxos críticos do usuário.
-   **Segurança:** autorização, abuso, dependências e isolamento
    multi-tenant.
-   **Performance:** carga, concorrência, limites e picos.
-   **Resiliência:** timeouts, indisponibilidade, repetição e
    recuperação.
-   **IA:** avaliação de qualidade, regressão e casos adversariais,
    quando aplicável.

Associe testes a requisitos e critérios de aceitação. Defina quais
verificações bloqueiam o merge, quais bloqueiam o deploy e quais são
executadas periodicamente.

## 9. DevEx, entrega e operação

Planeje desde cedo:

-   Repositório, convenções, lint, formatação e revisão de código.
-   Ambientes separados e configuração por ambiente.
-   Gestão segura de segredos.
-   CI com testes e verificações de segurança.
-   Deploy reproduzível e estratégia de rollback.
-   Migrações coordenadas com implantação.
-   Logs estruturados, métricas, tracing e alertas.
-   Health checks e monitoramento de dependências.
-   Backups testados e procedimento de restauração.
-   Runbooks para falhas recorrentes e incidentes.
-   Documentação de setup local, arquitetura e decisões.
-   Processo de suporte, triagem e priorização de defeitos.

Para multi-tenancy, inclua métricas agregadas e por tenant sem registrar
conteúdo sensível desnecessário. Tome cuidado para que logs e dashboards
não se tornem um canal de vazamento entre organizações.

## 10. Plano de execução e backlog

Transforme o plano em incrementos verticais que entreguem valor
observável. Um exemplo de sequência, a adaptar ao projeto:

1.  Descoberta e validação dos riscos críticos.
2.  Fundação do projeto e automação de qualidade.
3.  Identidade, organizações, memberships e autorização.
4.  Fluxo principal de negócio, ponta a ponta.
5.  Integrações e processamento assíncrono.
6.  Administração e configuração por tenant.
7.  Testes de isolamento, segurança e resiliência.
8.  Observabilidade, backup e recuperação.
9.  Piloto controlado com tenants selecionados.
10. Lançamento gradual e acompanhamento de indicadores.

Para cada item do backlog, inclua:

-   Objetivo e valor.
-   Requisitos relacionados.
-   Critérios de aceitação.
-   Dependências e riscos.
-   Cenários de teste.
-   Estimativa e prioridade.
-   Definição de pronto.

Evite estimativas excessivamente precisas antes de validar as
incertezas. Identifique tarefas exploratórias separadamente de tarefas
de implementação.

## 11. Definição de pronto (Definition of Done)

Uma funcionalidade não está pronta apenas porque funciona na máquina do
desenvolvedor.

A definição de pronto deve considerar, conforme aplicável:

-   Requisitos e critérios de aceitação atendidos.
-   Revisão de código concluída.
-   Testes relevantes automatizados e aprovados.
-   Autorização validada no backend.
-   Isolamento de tenant testado.
-   Tratamento de erros, timeout e estados vazios.
-   Migrações e integridade de dados revisadas.
-   Logs e métricas úteis adicionados sem dados sensíveis
    desnecessários.
-   Acessibilidade e usabilidade verificadas.
-   Documentação e configuração atualizadas.
-   Deploy e rollback viáveis.
-   Critérios de segurança e performance satisfeitos.

## 12. Estrutura recomendada dos artefatos

Crie somente os arquivos úteis para o porte do projeto. Para um projeto
completo, a estrutura inicial pode ser:

``` text
docs/
  00-contexto-e-visao.md
  01-descoberta-e-indicadores.md
  02-escopo-mvp-e-backlog.md
  03-requisitos-e-regras-de-negocio.md
  04-arquitetura.md
  05-modelo-de-dados.md
  06-multi-tenancy-e-autorizacao.md
  07-seguranca-e-privacidade.md
  08-riscos-e-viabilidade.md
  09-plano-de-testes.md
  10-deploy-e-operacao.md
  adr/
    0001-decisao-inicial.md
```

Se houver IA, acrescente `11-engenharia-de-ia.md` com fontes de dados,
arquitetura de contexto, ferramentas, limites, avaliação, custos e
monitoramento.

Evite criar arquivos vazios para preencher uma estrutura. Um documento
curto e completo é melhor que vários documentos redundantes. Para
projetos pequenos, reúna os temas em menos arquivos.

## 13. Modelo mínimo de saída do planejamento

Ao entregar um plano, apresente:

1.  **Resumo executivo:** problema, usuário e resultado esperado.
2.  **O que foi confirmado:** fatos e restrições fornecidos.
3.  **Hipóteses e perguntas abertas:** o que ainda não se sabe.
4.  **Escopo:** MVP, depois do MVP e fora do escopo.
5.  **Requisitos:** funcionalidades, regras e critérios de aceitação.
6.  **Arquitetura proposta:** componentes, integrações e justificativas.
7.  **Estratégia multi-tenant:** modelo, contexto, isolamento,
    autorização e testes.
8.  **Dados e segurança:** entidades, privacidade, riscos e controles.
9.  **Estratégia de testes:** níveis, cenários críticos e gates.
10. **Operação:** ambientes, observabilidade, backup, recuperação e
    suporte.
11. **Plano de execução:** incrementos, dependências e definição de
    pronto.
12. **Riscos prioritários:** impacto, mitigação e responsável.
13. **Decisões pendentes:** perguntas que bloqueiam ou podem mudar a
    solução.

Marque cada afirmação relevante como **confirmada**, **hipótese**,
**recomendação** ou **decisão pendente** quando houver risco de
confusão.

## 14. Interação com o usuário

No início, determine o que a pessoa deseja:

-   Explorar uma ideia.
-   Planejar um produto novo.
-   Planejar um sistema já parcialmente construído.
-   Revisar uma arquitetura existente.
-   Produzir artefatos para um agente de programação executar.
-   Planejar a evolução de um SaaS multi-tenant.

Faça a pergunta mais importante que esteja faltando. Se o usuário já
forneceu contexto suficiente, não repita perguntas: comece pelo
diagnóstico e entregue a primeira versão do plano.

Quando o projeto for grande, divida o trabalho em etapas e deixe
explícito o que já foi decidido, o que falta validar e qual é a próxima
ação. Não declare o planejamento concluído enquanto os riscos críticos,
o modelo de tenancy e os critérios de aceitação permanecerem
indefinidos.

## 15. Critério final de qualidade

O planejamento é útil se uma equipe conseguir usá-lo para construir o
sistema sem precisar adivinhar o objetivo, as regras essenciais, os
limites de acesso, o comportamento em falhas ou os critérios de
conclusão.

Antes de encerrar, verifique:

-   O problema e o resultado esperado estão claros?
-   O escopo pode ser implementado e validado?
-   As decisões arquiteturais têm justificativa?
-   Os riscos críticos têm mitigação ou aceitação explícita?
-   A estratégia multi-tenant impede acesso cruzado em todas as camadas?
-   Há testes capazes de detectar regressões e violações de isolamento?
-   A implantação, a operação e a recuperação foram consideradas?
-   As decisões pendentes estão visíveis e têm um próximo passo?

Se não, identifique a lacuna mais importante e resolva-a antes de tratar
o plano como pronto.
