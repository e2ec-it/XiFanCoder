import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { ObservationType, SearchFilters } from './types.js';
import { MemoryManager } from './manager/memory-manager.js';

export interface MemoryMcpServerOptions {
  readonly memoryManager?: Pick<
    MemoryManager,
    'search' | 'timeline' | 'getObservations' | 'save'
  >;
  readonly dbPath?: string;
}

interface MemoryMcpSearchArgs {
  readonly query: string;
  readonly filters?: SearchFilters;
}

interface MemoryMcpTimelineArgs {
  readonly anchorId: string;
  readonly depth?: number;
}

interface MemoryMcpGetObservationsArgs {
  readonly ids: readonly string[];
}

interface MemoryMcpSaveArgs {
  readonly text: string;
  readonly title: string;
  readonly project?: string;
  readonly type?: ObservationType;
  readonly filesRead?: readonly string[];
  readonly filesModified?: readonly string[];
}

export interface MemoryMcpServerStatus {
  readonly started: true;
  readonly transport: 'stdio';
  readonly toolCount: number;
}

export type MemoryMcpToolName =
  | 'search'
  | 'timeline'
  | 'get_observations'
  | 'save';

export interface MemoryMcpToolDefinition {
  readonly name: MemoryMcpToolName;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

const MEMORY_MCP_TOOLS: readonly MemoryMcpToolDefinition[] = [
  {
    name: 'search',
    description: 'Search memory observations with optional filters.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        filters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            project: { type: 'string' },
            type: {
              type: 'string',
              enum: ['decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change'],
            },
            filePath: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100 },
          },
        },
      },
    },
  },
  {
    name: 'timeline',
    description: 'Load timeline context around one anchor observation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['anchorId'],
      properties: {
        anchorId: { type: 'string', minLength: 1 },
        depth: { type: 'integer', minimum: 0, maximum: 50 },
      },
    },
  },
  {
    name: 'get_observations',
    description: 'Fetch full observation records by ids.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['ids'],
      properties: {
        ids: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
      },
    },
  },
  {
    name: 'save',
    description: 'Persist one manual memory observation.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['text', 'title'],
      properties: {
        text: { type: 'string', minLength: 1 },
        title: { type: 'string', minLength: 1 },
        project: { type: 'string' },
        type: {
          type: 'string',
          enum: ['decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change'],
        },
        filesRead: {
          type: 'array',
          items: { type: 'string' },
        },
        filesModified: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export class XifanMemoryMcpServer {
  private readonly manager: Pick<
    MemoryManager,
    'search' | 'timeline' | 'getObservations' | 'save'
  >;
  private readonly ownedManager?: MemoryManager;
  private readonly server: Server;
  private transport?: StdioServerTransport;

  constructor(options: MemoryMcpServerOptions = {}) {
    if (options.memoryManager) {
      this.manager = options.memoryManager;
      /* v8 ignore start -- creates real MemoryManager with default homedir DB */
    } else {
      const manager = new MemoryManager({ dbPath: options.dbPath });
      this.manager = manager;
      this.ownedManager = manager;
    }
    /* v8 ignore stop */

    this.server = new Server(
      {
        name: 'xifan-mem-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );
    this.registerHandlers();
  }

  listTools(): readonly MemoryMcpToolDefinition[] {
    return MEMORY_MCP_TOOLS;
  }

  async callTool(name: MemoryMcpToolName, args: unknown): Promise<unknown> {
    const record = asRecord(args);
    if (name === 'search') {
      const query = typeof record.query === 'string' ? record.query : '';
      if (!query.trim()) {
        throw new Error('search.query must be a non-empty string');
      }
      const filters = asRecord(record.filters);
      return this.manager.search(query, {
        project: typeof filters.project === 'string' ? filters.project : undefined,
        type: typeof filters.type === 'string' ? (filters.type as ObservationType) : undefined,
        filePath: typeof filters.filePath === 'string' ? filters.filePath : undefined,
        limit: typeof filters.limit === 'number' ? filters.limit : undefined,
      });
    }

    if (name === 'timeline') {
      const anchorId = typeof record.anchorId === 'string' ? record.anchorId : '';
      if (!anchorId.trim()) {
        throw new Error('timeline.anchorId must be a non-empty string');
      }
      const depth = typeof record.depth === 'number' ? record.depth : 2;
      return this.manager.timeline(anchorId, depth);
    }

    if (name === 'get_observations') {
      const ids = asStringArray(record.ids);
      if (ids.length === 0) {
        throw new Error('get_observations.ids must be a non-empty string array');
      }
      return this.manager.getObservations(ids);
    }

    if (name === 'save') {
      const text = typeof record.text === 'string' ? record.text : '';
      const title = typeof record.title === 'string' ? record.title : '';
      if (!text.trim() || !title.trim()) {
        throw new Error('save.text and save.title must be non-empty strings');
      }
      return this.manager.save(text, title, {
        project: typeof record.project === 'string' ? record.project : undefined,
        type: typeof record.type === 'string' ? (record.type as ObservationType) : undefined,
        filesRead: asStringArray(record.filesRead),
        filesModified: asStringArray(record.filesModified),
      });
    }

    throw new Error(`unknown_tool_${name}`);
  }

  async start(): Promise<MemoryMcpServerStatus> {
    if (!this.transport) {
      this.transport = new StdioServerTransport();
      await this.server.connect(this.transport);
    }

    return {
      started: true,
      transport: 'stdio',
      toolCount: MEMORY_MCP_TOOLS.length,
    };
  }

  async stop(): Promise<void> {
    await this.server.close();
    this.transport = undefined;
    this.ownedManager?.close();
  }

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: MEMORY_MCP_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name as MemoryMcpToolName;
      const result = await this.callTool(toolName, request.params.arguments ?? {});
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    });
  }
}

export type {
  MemoryMcpGetObservationsArgs,
  MemoryMcpSaveArgs,
  MemoryMcpSearchArgs,
  MemoryMcpTimelineArgs,
};
