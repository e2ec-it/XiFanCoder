import { initHandlers, routeTool } from './router.js';
import { closePool } from '../db/pool.js';

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly method: string;
  readonly params?: unknown;
}

interface PluginInitParams {
  readonly name: string;
  readonly projectPath: string;
  readonly xifanConfigDir: string;
  readonly env: Record<string, string>;
  readonly options: Record<string, unknown>;
}

interface PluginExecuteParams {
  readonly toolName: string;
  readonly args: unknown;
}

let initialized = false;

async function handleRequest(req: JsonRpcRequest): Promise<unknown> {
  if (req.method === 'plugin/init') {
    if (!initialized) {
      const params = req.params as PluginInitParams;
      // Apply env overrides if provided
      for (const [k, v] of Object.entries(params.env ?? {})) {
        process.env[k] = v;
      }
      await initHandlers();
      initialized = true;
    }
    return {
      tools: [
        { name: 'agents_session_start', description: 'Start a new agent session' },
        { name: 'agents_record_event', description: 'Record a tool call event within a session' },
        { name: 'agents_session_end', description: 'End an agent session and flush events' },
        { name: 'agents_replay', description: 'Replay recorded events for a session' },
        { name: 'agents_retrieve_experiences', description: 'Retrieve relevant past experiences via hybrid search' },
        { name: 'agents_save_observation', description: 'Save a memory observation of any type' },
        { name: 'agents_get_skill', description: 'Retrieve procedural skill memories matching a query' },
        { name: 'agents_status', description: 'Get agent system status and metrics' },
        { name: 'agents_start_mcp_proxy', description: 'Start MCP Observer Proxy for transparent tool call recording' },
        { name: 'agents_save_episodic', description: 'Save episodic memory and trigger SAGE skill extraction' },
        { name: 'agents_evaluate', description: 'Evaluate code output against a Sprint Contract using independent Evaluator model' },
        { name: 'agents_negotiate_contract', description: 'Generate a Sprint Contract with acceptance criteria for a task' },
        { name: 'agents_run_sprint', description: 'Run a full Generator↔Evaluator Sprint Loop for a task' },
      ],
    };
  }

  if (req.method === 'plugin/executeTool') {
    const params = req.params as PluginExecuteParams;
    const content = await routeTool(params.toolName, params.args);
    return { content };
  }

  if (req.method === 'plugin/destroy') {
    await closePool();
    return {};
  }

  throw new Error(`Unknown method: ${req.method}`);
}

function writeResponse(id: string | number, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(msg + '\n');
}

function writeError(id: string | number, message: string): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message } });
  process.stdout.write(msg + '\n');
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    void (async () => {
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        return; // malformed, ignore
      }
      try {
        const result = await handleRequest(req);
        writeResponse(req.id, result);
      } catch (err) {
        writeError(req.id, err instanceof Error ? err.message : String(err));
      }
    })();
  }
});

process.stdin.on('end', () => {
  void closePool();
});
