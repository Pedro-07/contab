# Segurança e privacidade (LGPD)

> Origem: Seção 11 do plano.

## 11. Segurança e LGPD

O ativo mais sensível é o certificado digital. A regra é: **o certificado do escritório e os dos clientes ficam no computador do escritório**. O único certificado no servidor é o do contratante Serpro (Pedro), cifrado no KMS e usado só pelo worker.

| Certificado | Onde fica | Uso |
| --- | --- | --- |
| e-CNPJ do Pedro (contratante Serpro) | Servidor, cifrado com KMS | Conexão mTLS com a Serpro |
| e-CNPJ do escritório | Computador do escritório (A1 instalado ou A3) | Assinar localmente o termo de autorização e a declaração de faturamento |
| Certificados dos clientes | Computador do escritório | Gerar, uma vez, a procuração eletrônica no e-CAC para o CNPJ do escritório |
| e-CNPJ do escritório no modo próprio | Servidor, cifrado com KMS | Exceção, só para quem tem contrato Serpro próprio |

### Ameaças principais e controles

| Ameaça | Controle |
| --- | --- |
| Vazamento do certificado do contratante (ou do escritório no modo próprio) | Criptografia em envelope: chave mestra no KMS ou cofre, chave de dados por tenant. Certificado decifrado só em memória, no worker fiscal. Nunca em log, interface ou backup sem cifra. Troca e uso auditados |
| Acesso cruzado entre escritórios (IDOR/BOLA) | Contexto de tenant obrigatório, RLS e respostas 404 sem detalhe (seção 8); testes negativos no CI |
| Tomada de conta | Painel sem senha (link mágico de uso único e curta duração), TOTP obrigatório para dono e admin, limite de tentativas, sessões no banco e revogáveis, alerta de novo dispositivo, eventos em `security_events` |
| Login do portal por CNPJ | CNPJ é público; então exige senha forte ou código de uso único no WhatsApp, limite de tentativas por CNPJ e por IP, sem revelar se o CNPJ existe |
| Webhook forjado | Validação da assinatura da Meta e do provedor de e-mail; rejeitar sem assinatura |
| Abuso de campanhas (spam) | Opt-in obrigatório, limite por tenant, bloqueio automático se a qualidade do número cair na Meta |
| Injeção, XSS, CSRF | ORM com parâmetros, validação com schema em toda entrada, escape no front, cookies `SameSite` e token CSRF, CSP restritiva |
| SSRF em anexos e links | Download de mídia só de domínios da Meta e do provedor; sem buscar URLs livres enviadas por usuários |
| PDF malicioso | Limite de tamanho (10 MB), checagem de tipo pelo conteúdo, leitura em processo isolado, sem execução de scripts |
| Dependência vulnerável | Dependabot ou Renovate, auditoria no CI, lockfile versionado |

### LGPD

- **Papéis:** o escritório é o **controlador** dos dados dos clientes dele. A plataforma do Pedro é a **operadora**. Assinar um contrato de tratamento de dados (DPA) com cada escritório.
- **Dados tratados:** CNPJ, CPF de sócios, telefone, e-mail, documentos societários, declarações de IR e valores de impostos. Todos são dados pessoais e financeiros sensíveis ao negócio.
- **Minimização:** não guardar mais do que o necessário; mensagens e documentos só no tenant.
- **Consentimento:** opt-in de WhatsApp e e-mail registrado com data e origem; opt-out imediato.
- **Direitos do titular:** exportação e exclusão por contato e por tenant; atendimento em até 15 dias.
- **Retenção:** documentos fiscais pelo prazo que o escritório definir (padrão de 5 anos); logs de auditoria por 1 ano; backups por 30 dias.
- **Suboperadores:** listar publicamente (provedor de nuvem, Meta, provedor de e-mail, Serpro) e informar mudanças.
- **Incidentes:** plano de resposta com comunicação ao escritório em até 24 h. A comunicação à ANPD fica a cargo do controlador.

**Validação especializada:** os termos de uso, o DPA e a política de privacidade devem ser revisados por um advogado antes de vender a outros escritórios.
