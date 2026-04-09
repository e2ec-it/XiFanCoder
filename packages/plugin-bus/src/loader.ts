import os from 'node:os';
import path from 'node:path';

import type {
  PluginConfig,
  PluginInitResult,
  PluginProcessFactory,
  PluginToolExecuteResult,
} from './types.js';
import { PluginRegistry } from './registry.js';

export class PluginLoader {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly processFactory: PluginProcessFactory,
    private readonly now: () => number = Date.now,
  ) {}

  async load(name: string): Promise<PluginInitResult | undefined> {
    const entry = this.registry.get(name);
    if (!entry) {
      throw new Error(`plugin not found: ${name}`);
    }

    if (!entry.manifest.enabled) {
      this.registry.update(name, {
        status: 'disabled',
      });
      return undefined;
    }

    this.registry.update(name, {
      status: 'loading',
      error: undefined,
    });

    try {
      const process = await this.processFactory.create(entry.manifest);
      const initResult = await process.init(this.buildPluginConfig(entry.manifest.name, entry.manifest.env ?? {}));

      this.registry.update(name, {
        status: 'ready',
        loadedAt: this.now(),
        pid: process.pid,
      });

      return initResult;
    } catch (error) {
      this.registry.update(name, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async unload(name: string): Promise<void> {
    const entry = this.registry.get(name);
    if (!entry) {
      return;
    }

    try {
      const process = this.processFactory.get(name);
      if (process) {
        await process.destroy();
      }
    } finally {
      this.registry.update(name, {
        status: 'unloaded',
        pid: undefined,
        loadedAt: undefined,
        error: undefined,
      });
    }
  }

  async executeTool(
    pluginName: string,
    toolName: string,
    args: unknown,
  ): Promise<PluginToolExecuteResult> {
    const entry = this.registry.get(pluginName);
    if (!entry) {
      throw new Error(`plugin not found: ${pluginName}`);
    }
    if (entry.status !== 'ready') {
      throw new Error(`plugin is not ready: ${pluginName} status=${entry.status}`);
    }

    const process = this.processFactory.get(pluginName);
    if (!process) {
      throw new Error(`plugin process not found: ${pluginName}`);
    }

    try {
      return await this.executeWithLifecycle(pluginName, process, toolName, args);
    } catch (error) {
      if (this.shouldRetryAfterCrash(error)) {
        const reloaded = await this.load(pluginName);
        if (!reloaded) {
          throw error;
        }
        const restartedProcess = this.processFactory.get(pluginName);
        if (!restartedProcess) {
          throw error;
        }
        return await this.executeWithLifecycle(pluginName, restartedProcess, toolName, args);
      }

      this.registry.update(pluginName, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private buildPluginConfig(name: string, env: Readonly<Record<string, string>>): PluginConfig {
    return {
      name,
      projectPath: process.cwd(),
      xifanConfigDir: path.join(os.homedir(), '.xifan', 'coder'),
      env,
      options: {},
    };
  }

  private async executeWithLifecycle(
    pluginName: string,
    process: { executeTool(toolName: string, args: unknown): Promise<PluginToolExecuteResult> },
    toolName: string,
    args: unknown,
  ): Promise<PluginToolExecuteResult> {
    this.registry.update(pluginName, {
      status: 'executing',
      error: undefined,
    });

    try {
      const result = await process.executeTool(toolName, args);
      this.registry.update(pluginName, {
        status: 'ready',
      });
      return result;
    } catch (error) {
      this.registry.update(pluginName, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private shouldRetryAfterCrash(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('plugin process exited') ||
      message.includes('plugin process not found')
    );
  }
}
