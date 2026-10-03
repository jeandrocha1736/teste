# n8n MCP Server

Servidor [MCP](https://modelcontextprotocol.io) (TypeScript, transporte **stdio**) que conecta o Claude (Desktop / Claude Code) ou qualquer cliente MCP a uma instância **n8n**.

## Tools

| Tool | O que faz | Precisa de API key |
|---|---|---|
| `n8n_list_workflows` | Lista workflows (filtros: ativo, nome, tags) | ✅ |
| `n8n_get_workflow` | Detalha um workflow (nós, conexões) | ✅ |
| `n8n_set_workflow_active` | Ativa / desativa um workflow | ✅ |
| `n8n_list_executions` | Lista execuções (filtros: workflow, status) | ✅ |
| `n8n_get_execution` | Detalha uma execução, com dados dos nós | ✅ |
| `n8n_trigger_webhook` | Executa um workflow chamando seu nó **Webhook** | ❌ |

> A API pública do n8n não executa workflows diretamente — por isso a execução é feita via nó **Webhook**. Adicione um nó Webhook ao workflow, ative-o e passe o `path` do webhook para a tool. Para devolver dados ao Claude, use "Respond: When Last Node Finishes" ou um nó *Respond to Webhook*.

## Configuração

| Variável | Padrão | Descrição |
|---|---|---|
| `N8N_BASE_URL` | `http://localhost:5678` | URL da sua instância n8n |
| `N8N_API_KEY` | — | Criada em **n8n → Settings → n8n API** |
| `N8N_TIMEOUT_MS` | `30000` | Timeout das requisições |

## Instalação

```bash
npm install
npm run build
```

### Claude Code

```bash
claude mcp add n8n \
  -e N8N_BASE_URL=http://localhost:5678 \
  -e N8N_API_KEY=sua_api_key \
  -- node /caminho/absoluto/para/build/index.js
```

### Claude Desktop

Em `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "n8n": {
      "command": "node",
      "args": ["/caminho/absoluto/para/build/index.js"],
      "env": {
        "N8N_BASE_URL": "http://localhost:5678",
        "N8N_API_KEY": "sua_api_key"
      }
    }
  }
}
```

### Testar com o MCP Inspector

```bash
N8N_BASE_URL=http://localhost:5678 N8N_API_KEY=sua_api_key npm run inspect
```
