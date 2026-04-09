#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { installProcessCrashReporter, parseCrashReporterEnv } from '@xifan-coder/core';

import { executeCommand, executeCommandDetailed } from './commands.js';
import { parseCliArgs } from './parse.js';
import { runSingleTask, startRepl } from './repl.js';
import { checkForUpdates, formatUpdateMessage } from './update-checker.js';
import { resolveCliVersion } from './version.js';

function parseGlobalOutput(argv: readonly string[]): {
  readonly cleanedArgv: readonly string[];
  readonly outputMode: 'text' | 'json';
} {
  const cleaned = [...argv];

  const jsonIndex = cleaned.indexOf('--json');
  if (jsonIndex >= 0) {
    cleaned.splice(jsonIndex, 1);
    return {
      cleanedArgv: cleaned,
      outputMode: 'json',
    };
  }

  const outputIndex = cleaned.indexOf('--output');
  if (outputIndex >= 0) {
    const rawMode = cleaned[outputIndex + 1];
    if (rawMode !== 'text' && rawMode !== 'json') {
      throw new Error(`Invalid --output: ${rawMode ?? '<empty>'}`);
    }
    cleaned.splice(outputIndex, 2);
    return {
      cleanedArgv: cleaned,
      outputMode: rawMode,
    };
  }

  return {
    cleanedArgv: cleaned,
    outputMode: 'text',
  };
}

export interface RunCliDeps {
  readonly executeTextCommand?: typeof executeCommand;
  readonly executeStructuredCommand?: typeof executeCommandDetailed;
  readonly startReplFn?: typeof startRepl;
  readonly runSingleTaskFn?: typeof runSingleTask;
  readonly printStdout?: (line: string) => void;
  readonly printStderr?: (line: string) => void;
  readonly updateCrashContext?: (context: unknown) => void;
}

function isUnknownTopLevelCommandError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('Unknown command:');
}

export async function runCli(argv: readonly string[], deps: RunCliDeps = {}): Promise<number> {
  const { cleanedArgv, outputMode } = parseGlobalOutput(argv);
  const executeTextCommand = deps.executeTextCommand ?? executeCommand;
  const executeStructuredCommand = deps.executeStructuredCommand ?? executeCommandDetailed;
  const startReplFn = deps.startReplFn ?? startRepl;
  const runSingleTaskFn = deps.runSingleTaskFn ?? runSingleTask;
  const printStdout = deps.printStdout ?? ((line: string): void => console.log(line));
  const printStderr = deps.printStderr ?? ((line: string): void => console.error(line));
  const updateCrashContext = deps.updateCrashContext ?? (() => undefined);

  try {
    updateCrashContext({
      phase: 'cli.start',
      argv: cleanedArgv,
      outputMode,
    });

    if (cleanedArgv.length === 0) {
      if (outputMode === 'json') {
        throw new Error('REPL 模式不支持 --json 输出');
      }
      updateCrashContext({
        phase: 'cli.repl',
      });
      await startReplFn();
      return 0;
    }

    let command;
    try {
      command = parseCliArgs(cleanedArgv);
    } catch (error) {
      if (!isUnknownTopLevelCommandError(error)) {
        throw error;
      }
      const message = cleanedArgv.join(' ').trim();
      updateCrashContext({
        phase: 'cli.single-task',
        message,
      });
      const result = await runSingleTaskFn({ message });
      if (outputMode === 'json') {
        printStdout(
          JSON.stringify(
            {
              type: 'single-task',
              assistantText: result.assistantText,
            },
            null,
            2,
          ),
        );
      } else {
        printStdout(result.assistantText);
      }
      return 0;
    }
    updateCrashContext({
      phase: 'cli.command',
      commandType: command.type,
    });

    if (outputMode === 'json') {
      const output = await executeStructuredCommand(command);
      printStdout(JSON.stringify(output, null, 2));
    } else {
      const output = await executeTextCommand(command);
      printStdout(output);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateCrashContext({
      phase: 'cli.error',
      message,
    });
    if (outputMode === 'json') {
      printStderr(
        JSON.stringify(
          {
            ok: false,
            error: message,
          },
          null,
          2,
        ),
      );
    } else {
      printStderr(message);
    }
    return 1;
  }
}

/* v8 ignore start -- process-level entry point, not unit-testable */
function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

async function main(): Promise<void> {
  const crashReporter = installProcessCrashReporter({
    appName: 'xifancoder-cli',
    appVersion: resolveCliVersion(),
    ...parseCrashReporterEnv(process.env),
  });
  crashReporter.setRecentContext({
    phase: 'cli.bootstrap',
    argv: process.argv.slice(2),
  });

  const currentVersion = resolveCliVersion();
  const updateCheckPromise = checkForUpdates(currentVersion);

  const exitCode = await runCli(process.argv.slice(2), {
    updateCrashContext: (context): void => {
      crashReporter.setRecentContext(context);
    },
  });

  const latestVersion = await updateCheckPromise;
  if (latestVersion) {
    console.error(formatUpdateMessage(currentVersion, latestVersion));
  }

  process.exitCode = exitCode;
  crashReporter.dispose();
}

if (isEntrypoint()) {
  void main();
}
/* v8 ignore stop */

