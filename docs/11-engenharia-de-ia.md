# Engenharia de IA (planejada, não construída agora)

> Origem: Parte da seção 16 do plano. Nada desta trilha entra no MVP.

### Trilha de IA (planejada, não construída agora)

O atendente com IA pode entrar depois que o inbox estiver estável. As regras já ficam definidas:

- **O que a IA faz:** responde dúvidas frequentes com base nos documentos e orientações do próprio tenant.
- **O que não faz:** não gera guia, não altera dados e nunca escolhe o tenant. Ações só por ferramentas com schema estrito e autorização no servidor.
- **Isolamento:** índices e memória separados por tenant.
- **Segurança:** conteúdo do cliente é tratado como dado, nunca como instrução.
- **Escalonamento:** passa para humano quando não tiver confiança na resposta.
- **Avaliação:** conjunto versionado de perguntas reais antes de ligar.
