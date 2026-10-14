# Multi-tenancy e autorização

> Origem: Seção 8 do plano.

## 8. Estratégia multi-tenant

**Recomendação:** banco compartilhado e esquema compartilhado, com `tenant_id` em toda tabela de dados de escritório e Row-Level Security do Postgres como segunda barreira. O tenant é o escritório de contabilidade, e as empresas-clientes ficam dentro dele.

### Por que esse modelo

| Modelo | Isolamento | Custo e operação | Veredito |
| --- | --- | --- | --- |
| Banco e esquema compartilhados + RLS | Bom, com duas camadas (aplicação e banco) | Uma migração, um backup, barato | **Escolhido** para escritórios pequenos e médios |
| Esquema por tenant | Melhor | Migração × N esquemas, pool complexo | Não compensa para um dev solo |
| Banco por tenant | Máximo | Custo e operação multiplicados | Só se um contrato exigir |
| Híbrido | Flexível | Exige automação madura | Reavaliar com mais de 50 tenants ou um cliente grande |

### Atores e escopo

- **Operador da plataforma (Pedro):** sem acesso aos dados por padrão. Acesso excepcional é temporário, justificado e auditado ("modo suporte").
- **Membro do escritório:** usuário global com `membership` em um ou mais escritórios, com papel por escritório (RN10).
- **Usuário do portal:** pessoa vinculada a empresas-clientes de um tenant por `client_access`. Pode estar em empresas de escritórios diferentes; cada portal é separado pelo domínio.
- **Contato do CRM:** registro do tenant, sem login. Pode ou não ter acesso ao portal.

### Como o tenant é determinado

1. **Painel do escritório (`app.<domínio>`):** sessão autenticada com organização ativa. O servidor confere a membership a cada requisição e nunca aceita `tenant_id` vindo do navegador. Quem participa de dois escritórios troca a organização ativa sem trocar de endereço.
2. **Portal e links seguros (`<slug>.<domínio>`):** o subdomínio resolve o tenant no servidor, e a sessão do portal fica presa a esse tenant.
3. **Webhooks (`app.<domínio>/api/webhooks/...`):** o tenant vem do identificador do número ou domínio cadastrado, nunca do conteúdo da mensagem.

### Domínios e cookies

- **Domínio-base único**, lido de `APP_BASE_DOMAIN`. Trocar o domínio quando a marca sair (P7) é só configuração.
- **Slugs reservados:** `app`, `api`, `www`, `admin`, `status`, `mail`, `suporte`, `staging`, `docs`.
- **Cookies presos ao host** (sem `Domain=.<domínio>`), com `__Host-`, `Secure` e `SameSite=Lax`. A sessão de um subdomínio nunca vale em outro. O painel e o portal usam cookies com nomes diferentes.
- **Desenvolvimento:** `app.localhost:3000` e `<slug>.localhost:3000`, sem configurar DNS.
- **Staging:** domínio provisório comprado agora, até a marca definitiva.
- **Domínio próprio do escritório** (por exemplo, `portal.escritorio.com.br`): depois do MVP.
- **A verificar:** até onde se sabe, o certificado coringa (`*.<domínio>`) da Vercel exige que o DNS daquele domínio esteja nos nameservers da Vercel. Se for isso, só o domínio do produto vai para a Vercel, e os sites dos clientes continuam na Cloudflare.

### Logs de auditoria e de segurança

| Tabela | Escopo | O que guarda | Quem lê |
| --- | --- | --- | --- |
| `audit_logs` | tenant, com RLS | Ações de negócio: papéis, publicações, credenciais, configurações | Dono e admin do escritório |
| `security_events` | global, sem RLS | Acesso negado, busca por ID sem resultado, login falho, MFA falho, webhook com assinatura inválida, uso do modo suporte | Só o operador, por um papel de leitura separado |

- O papel `app` só tem `INSERT` em `security_events`. Não tem `SELECT`, `UPDATE` nem `DELETE`.
- O modo suporte grava nas duas tabelas: em `security_events` para o operador e em `audit_logs` do tenant, para o escritório ver quem acessou, quando e por quê.
- Só identificadores entram no log, nunca o conteúdo da requisição. A retenção é de 1 ano.
4. **Jobs:** todo job carrega `tenant_id` no payload. O worker abre a transação com o contexto do tenant, e um job sem tenant falha antes de executar.

### Isolamento por camada

| Camada | Controle |
| --- | --- |
| API e casos de uso | Middleware estabelece o `TenantContext`; repositórios só funcionam com ele; consulta sem tenant não compila nem roda |
| Banco | RLS em todas as tabelas de tenant, com `SET LOCAL app.tenant_id` por transação (seguro com pool); chaves compostas `(tenant_id, id)` e estrangeiras compostas |
| Arquivos | Bucket privado, caminho `tenants/{tenant_id}/...`; URL assinada de 5 min gerada só depois da checagem de permissão |
| Cache e tempo real | Chaves e canais prefixados com o tenant; o canal do socket é autorizado no servidor |
| Filas e jobs | `tenant_id` obrigatório; limite de concorrência por tenant |
| Busca | Toda busca filtra por tenant no índice; sem índice global |
| Logs e métricas | `tenant_id` como campo, sem conteúdo de mensagens nem documentos; o painel do operador mostra agregados |
| Integrações | Credenciais (Serpro, WhatsApp, e-mail) guardadas por tenant e criptografadas |

### Ciclo de vida do tenant

- **Estados:** `trial` → `active` → `past_due` → `suspended` → `closed`.
  - Em `past_due`, tudo funciona e um aviso aparece.
  - Em `suspended`, o portal fica só leitura e disparos e automações param.
  - Em `closed`, a exportação fica disponível por 30 dias e depois os dados são excluídos.
- **Provisionamento:**
  1. Criar organização e convite do dono.
  2. Configurar subdomínio.
  3. Conectar WhatsApp e e-mail.
  4. Enviar certificado.
  5. Importar empresas por CSV.
- **Planos:** a política de limites fica centralizada (`entitlements`): empresas-clientes, usuários, números de WhatsApp, campanhas por mês e módulos fiscais. O uso de Serpro e de mensagens é medido por tenant.
