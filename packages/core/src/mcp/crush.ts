import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import type { MCPClientStdioOptions } from './client.js';
import type { ToolDefinition } from '../tools/dispatcher.js';

export interface CrushAvailability {
  readonly available: boolean;
  readonly command: string;
  readonly reason?: string;
}

export interface CrushToolDescriptor {
  readonly name: 'crush_file_read' | 'crush_search' | 'crush_shell' | 'crush_fetch';
  readonly description: string;
  readonly permissionLevel: 'L1' | 'L2';
}

export const CRUSH_TOOL_DESCRIPTORS: readonly CrushToolDescriptor[] = [
  {
    name: 'crush_file_read',
    description: 'Read files with semantic context from Crush MCP',
    permissionLevel: 'L1',
  },
  {
    name: 'crush_search',
    description: 'Search code using Crush MCP',
    permissionLevel: 'L1',
  },
  {
    name: 'crush_shell',
    description: 'Execute shell command through Crush MCP',
    permissionLevel: 'L2',
  },
  {
    name: 'crush_fetch',
    description: 'Fetch and summarize web content via Crush MCP',
    permissionLevel: 'L2',
  },
] as const;

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: {
    stdio: 'ignore';
    timeout: number;
  },
) => SpawnSyncReturns<Buffer>;

export function detectCrushAvailability(
  command = 'crush',
  spawnImpl: SpawnLike = spawnSync,
): CrushAvailability {
  try {
    const result = spawnImpl(command, ['--version'], {
      stdio: 'ignore',
      timeout: 3_000,
    });
    if (result.error) {
      return {
        available: false,
        command,
        reason: result.error.message,
      };
    }
    return {
      available: result.status === 0,
      command,
      reason: result.status === 0 ? undefined : `exit=${result.status ?? -1}`,
    };
  } catch (error) {
    return {
      available: false,
      command,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createCrushStdioClientOptions(command = 'crush'): MCPClientStdioOptions {
  return {
    transport: 'stdio',
    command,
    args: ['--mcp-server'],
  };
}

export function createCrushToolDefinitions(input: {
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}): readonly ToolDefinition[] {
  return CRUSH_TOOL_DESCRIPTORS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    source: 'mcp',
    permissionLevel: tool.permissionLevel,
    inputSchema: {
      type: 'object',
      additionalProperties: true,
    },
    execute: async (args: unknown): Promise<unknown> => {
      const payload =
        typeof args === 'object' && args !== null && !Array.isArray(args)
          ? (args as Record<string, unknown>)
          : {};
      return await input.callTool(tool.name, payload);
    },
  }));
}

