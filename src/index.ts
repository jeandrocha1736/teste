#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const N8N_BASE_URL = (process.env.N8N_BASE_URL ?? "http://localhost:5678").replace(/\/+$/, "");
const N8N_API_KEY = process.env.N8N_API_KEY;
const REQUEST_TIMEOUT_MS = Number(process.env.N8N_TIMEOUT_MS ?? 30_000);

// Logs vão para stderr: stdout é reservado para o protocolo MCP (stdio).
const log = (...args: unknown[]) => console.error("[n8n-mcp]", ...args);

type Query = Record<string, string | number | boolean | undefined>;

async function request(
  method: string,
  path: string,
  opts: { query?: Query; body?: unknown; headers?: Record<string, string> } = {},
): Promise<unknown> {
  const url = new URL(N8N_BASE_URL + path);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...opts.headers,
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // resposta não-JSON: devolve o texto cru
  }

  if (!res.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`n8n respondeu ${res.status} ${res.statusText} em ${method} ${url.pathname}: ${detail}`);
  }
  return data;
}

function apiRequest(method: string, path: string, opts: { query?: Query; body?: unknown } = {}) {
  if (!N8N_API_KEY) {
    throw new Error(
      "N8N_API_KEY não definida. Crie uma API key em n8n → Settings → n8n API e configure a variável de ambiente.",
    );
  }
  return request(method, `/api/v1${path}`, { ...opts, headers: { "X-N8N-API-KEY": N8N_API_KEY } });
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function fail(err: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: err instanceof Error ? err.message : String(err) }],
  };
}

async function run(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

const server = new McpServer({ name: "n8n-mcp-server", version: "0.1.0" });

server.registerTool(
  "n8n_list_workflows",
  {
    title: "Listar workflows",
    description: "Lista os workflows da instância n8n (id, nome, se está ativo, tags).",
    inputSchema: {
      active: z.boolean().optional().describe("Filtrar apenas ativos (true) ou inativos (false)"),
      name: z.string().optional().describe("Filtrar pelo nome do workflow"),
      tags: z.string().optional().describe("Tags separadas por vírgula"),
      limit: z.number().int().min(1).max(250).optional().describe("Máximo de itens (padrão 100)"),
      cursor: z.string().optional().describe("Cursor de paginação retornado em nextCursor"),
    },
    annotations: { readOnlyHint: true },
  },
  ({ active, name, tags, limit, cursor }) =>
    run(async () => {
      const res = (await apiRequest("GET", "/workflows", {
        query: { active, name, tags, limit: limit ?? 100, cursor, excludePinnedData: true },
      })) as { data: Array<Record<string, any>>; nextCursor?: string | null };
      return {
        workflows: res.data.map((w) => ({
          id: w.id,
          name: w.name,
          active: w.active,
          tags: (w.tags ?? []).map((t: { name: string }) => t.name),
          updatedAt: w.updatedAt,
        })),
        nextCursor: res.nextCursor ?? null,
      };
    }),
);

server.registerTool(
  "n8n_get_workflow",
  {
    title: "Detalhar workflow",
    description:
      "Retorna um workflow completo (nós, conexões, configurações). Útil para descobrir o path de um nó Webhook.",
    inputSchema: { id: z.string().describe("ID do workflow") },
    annotations: { readOnlyHint: true },
  },
  ({ id }) => run(() => apiRequest("GET", `/workflows/${encodeURIComponent(id)}`)),
);

server.registerTool(
  "n8n_set_workflow_active",
  {
    title: "Ativar/desativar workflow",
    description: "Ativa ou desativa um workflow.",
    inputSchema: {
      id: z.string().describe("ID do workflow"),
      active: z.boolean().describe("true para ativar, false para desativar"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  },
  ({ id, active }) =>
    run(() => apiRequest("POST", `/workflows/${encodeURIComponent(id)}/${active ? "activate" : "deactivate"}`)),
);

server.registerTool(
  "n8n_list_executions",
  {
    title: "Listar execuções",
    description: "Lista execuções recentes, opcionalmente filtradas por workflow e status.",
    inputSchema: {
      workflowId: z.string().optional().describe("ID do workflow"),
      status: z.enum(["success", "error", "waiting", "canceled"]).optional(),
      limit: z.number().int().min(1).max(250).optional().describe("Máximo de itens (padrão 20)"),
      cursor: z.string().optional().describe("Cursor de paginação retornado em nextCursor"),
    },
    annotations: { readOnlyHint: true },
  },
  ({ workflowId, status, limit, cursor }) =>
    run(() => apiRequest("GET", "/executions", { query: { workflowId, status, limit: limit ?? 20, cursor } })),
);

server.registerTool(
  "n8n_get_execution",
  {
    title: "Detalhar execução",
    description: "Retorna uma execução, opcionalmente com os dados de cada nó.",
    inputSchema: {
      id: z.string().describe("ID da execução"),
      includeData: z.boolean().optional().describe("Incluir os dados de entrada/saída dos nós (padrão true)"),
    },
    annotations: { readOnlyHint: true },
  },
  ({ id, includeData }) =>
    run(() =>
      apiRequest("GET", `/executions/${encodeURIComponent(id)}`, { query: { includeData: includeData ?? true } }),
    ),
);

server.registerTool(
  "n8n_trigger_webhook",
  {
    title: "Disparar workflow via webhook",
    description:
      "Executa um workflow chamando seu nó Webhook. O workflow precisa estar ativo (ou use test=true com o editor aberto em 'Listen for test event'). Retorna a resposta do webhook.",
    inputSchema: {
      path: z.string().describe("Path do nó Webhook (ex.: 'meu-fluxo' ou o UUID gerado pelo n8n)"),
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional().describe("Método HTTP (padrão POST)"),
      payload: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Corpo JSON (POST/PUT/PATCH) ou query string (GET/DELETE)"),
      test: z.boolean().optional().describe("Usar a URL de teste (/webhook-test) em vez da de produção"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  ({ path, method, payload, test }) =>
    run(() => {
      const m = method ?? "POST";
      const hasBody = !["GET", "DELETE"].includes(m);
      const route = `/${test ? "webhook-test" : "webhook"}/${path.replace(/^\/+/, "")}`;
      return request(m, route, {
        body: hasBody ? (payload ?? {}) : undefined,
        query: hasBody ? undefined : (payload as Query | undefined),
      });
    }),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`conectado via stdio → ${N8N_BASE_URL}${N8N_API_KEY ? "" : " (sem N8N_API_KEY: só webhooks funcionarão)"}`);
}

main().catch((err) => {
  log("erro fatal:", err);
  process.exit(1);
});
