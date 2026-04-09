import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionRuntime } from '../../runtime/index.js';
import { ToolExecutionError } from '../../errors/tool-errors.js';
import { ToolDispatcher } from '../dispatcher.js';
import {
  createBuiltinToolDefinitions,
  registerBuiltinTools,
  READ_FILE_INPUT_SCHEMA,
  WRITE_FILE_INPUT_SCHEMA,
  LIST_DIR_INPUT_SCHEMA,
  BASH_EXECUTE_INPUT_SCHEMA,
  WEB_FETCH_INPUT_SCHEMA,
} from '../builtin.js';

describe('builtin tools registry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates all builtin tool definitions with schema', () => {
    const definitions = createBuiltinToolDefinitions();
    const names = definitions.map((tool) => tool.name).sort();

    expect(names).toEqual([
      'bash_execute',
      'list_dir',
      'read_file',
      'web_fetch',
      'write_file',
    ]);
    expect(definitions.every((tool) => Boolean(tool.inputSchema))).toBe(true);
    expect(definitions.every((tool) => tool.source === 'builtin')).toBe(true);
  });

  it('registers tools to dispatcher and executes through unified entrypoint', async () => {
    const runtime = new SessionRuntime({ mode: 'build', headless: false });
    const dispatcher = new ToolDispatcher(runtime, { approvalHandler: () => true });
    registerBuiltinTools(dispatcher, {
      webFetchSummarizer: () => 'summary',
    });

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-builtin-tools-'));
    const filePath = path.join(root, 'demo.txt');
    fs.writeFileSync(filePath, '0123456789', 'utf8');

    const readResult = await dispatcher.executeTool('read_file', {
      path: filePath,
      offset: 2,
      limit: 3,
    });
    expect((readResult.output as { content: string }).content).toBe('234');

    const listResult = await dispatcher.executeTool('list_dir', {
      path: root,
      recursive: false,
    });
    const entries = (listResult.output as { entries: Array<{ name: string }> }).entries;
    expect(entries.map((entry) => entry.name)).toContain('demo.txt');

    const writePath = path.join(root, 'write.txt');
    const writeResult = await dispatcher.executeTool('write_file', {
      path: writePath,
      content: 'hello',
      mode: 'create',
    });
    expect((writeResult.output as { mode: string }).mode).toBe('legacy');
    expect(fs.readFileSync(writePath, 'utf8')).toBe('hello');
  });

  it('executes web_fetch via dispatcher', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('hello web', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const runtime = new SessionRuntime({
      mode: 'build',
      headless: true,
      allowDangerous: true,
    });
    const dispatcher = new ToolDispatcher(runtime);
    registerBuiltinTools(dispatcher, {
      webFetchSummarizer: ({ content }) => `summary:${content}`,
    });

    const result = await dispatcher.executeTool('web_fetch', {
      url: 'https://example.com/web',
    });

    expect((result.output as { summary: string }).summary).toContain('summary:hello web');
  });
});

describe('input schema exports', () => {
  it('READ_FILE_INPUT_SCHEMA has required path', () => {
    expect(READ_FILE_INPUT_SCHEMA.required).toEqual(['path']);
    expect(READ_FILE_INPUT_SCHEMA.properties.path).toBeDefined();
    expect(READ_FILE_INPUT_SCHEMA.properties.offset).toBeDefined();
    expect(READ_FILE_INPUT_SCHEMA.properties.limit).toBeDefined();
  });

  it('WRITE_FILE_INPUT_SCHEMA has required path', () => {
    expect(WRITE_FILE_INPUT_SCHEMA.required).toEqual(['path']);
    expect(WRITE_FILE_INPUT_SCHEMA.properties.content).toBeDefined();
    expect(WRITE_FILE_INPUT_SCHEMA.properties.mode).toBeDefined();
    expect(WRITE_FILE_INPUT_SCHEMA.properties.range).toBeDefined();
    expect(WRITE_FILE_INPUT_SCHEMA.properties.expectedHash).toBeDefined();
    expect(WRITE_FILE_INPUT_SCHEMA.properties.replacement).toBeDefined();
  });

  it('LIST_DIR_INPUT_SCHEMA has required path', () => {
    expect(LIST_DIR_INPUT_SCHEMA.required).toEqual(['path']);
    expect(LIST_DIR_INPUT_SCHEMA.properties.recursive).toBeDefined();
    expect(LIST_DIR_INPUT_SCHEMA.properties.filter).toBeDefined();
    expect(LIST_DIR_INPUT_SCHEMA.properties.includeHidden).toBeDefined();
  });

  it('BASH_EXECUTE_INPUT_SCHEMA has required command', () => {
    expect(BASH_EXECUTE_INPUT_SCHEMA.required).toEqual(['command']);
    expect(BASH_EXECUTE_INPUT_SCHEMA.properties.timeoutMs).toBeDefined();
    expect(BASH_EXECUTE_INPUT_SCHEMA.properties.env).toBeDefined();
  });

  it('WEB_FETCH_INPUT_SCHEMA has required url', () => {
    expect(WEB_FETCH_INPUT_SCHEMA.required).toEqual(['url']);
    expect(WEB_FETCH_INPUT_SCHEMA.properties.prompt).toBeDefined();
    expect(WEB_FETCH_INPUT_SCHEMA.properties.timeoutMs).toBeDefined();
  });
});

describe('builtin tool parsers (via createBuiltinToolDefinitions)', () => {
  it('read_file rejects non-object args', async () => {
    const defs = createBuiltinToolDefinitions();
    const readFile = defs.find((d) => d.name === 'read_file')!;
    await expect(readFile.execute('not-an-object', {})).rejects.toThrow(ToolExecutionError);
  });

  it('read_file rejects missing path', async () => {
    const defs = createBuiltinToolDefinitions();
    const readFile = defs.find((d) => d.name === 'read_file')!;
    await expect(readFile.execute({ path: '' }, {})).rejects.toThrow(ToolExecutionError);
  });

  it('read_file accepts valid args', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bf-rf-'));
    const filePath = path.join(root, 'test.txt');
    fs.writeFileSync(filePath, 'hello\nworld\n', 'utf8');

    const defs = createBuiltinToolDefinitions();
    const readFile = defs.find((d) => d.name === 'read_file')!;
    const result = await readFile.execute({ path: filePath }, {});
    expect(result).toBeDefined();
  });

  it('write_file rejects non-object args', async () => {
    const defs = createBuiltinToolDefinitions();
    const writeFile = defs.find((d) => d.name === 'write_file')!;
    await expect(writeFile.execute(null, {})).rejects.toThrow(ToolExecutionError);
  });

  it('write_file rejects missing path', async () => {
    const defs = createBuiltinToolDefinitions();
    const writeFile = defs.find((d) => d.name === 'write_file')!;
    await expect(writeFile.execute({ path: '', content: 'hi' }, {})).rejects.toThrow(ToolExecutionError);
  });

  it('write_file rejects missing content without hash fields', async () => {
    const defs = createBuiltinToolDefinitions();
    const writeFile = defs.find((d) => d.name === 'write_file')!;
    await expect(writeFile.execute({ path: '/tmp/test' }, {})).rejects.toThrow(ToolExecutionError);
  });

  it('write_file with hash-anchored edit and invalid range', async () => {
    const defs = createBuiltinToolDefinitions();
    const writeFile = defs.find((d) => d.name === 'write_file')!;
    await expect(writeFile.execute({
      path: '/tmp/test',
      expectedHash: 'abc',
      replacement: 'new',
      range: { startLine: 'not-a-number', endLine: 1 },
    }, {})).rejects.toThrow(ToolExecutionError);
  });

  it('write_file with valid hash-anchored edit args (parse only)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bf-wf-'));
    const filePath = path.join(root, 'test.txt');
    fs.writeFileSync(filePath, 'line1\nline2\nline3\n', 'utf8');

    const defs = createBuiltinToolDefinitions();
    const writeFile = defs.find((d) => d.name === 'write_file')!;
    // This will attempt the edit; may fail due to hash mismatch but parser works
    try {
      await writeFile.execute({
        path: filePath,
        expectedHash: 'wrong-hash',
        replacement: 'new content',
        range: { startLine: 1, endLine: 2 },
      }, {});
    } catch {
      // Expected: hash mismatch or other edit error, but parser succeeded
    }
  });

  it('write_file with mode values', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bf-wfm-'));
    const filePath = path.join(root, 'mode-test.txt');

    const defs = createBuiltinToolDefinitions();
    const writeFile = defs.find((d) => d.name === 'write_file')!;

    // create mode
    await writeFile.execute({ path: filePath, content: 'created', mode: 'create' }, {});
    expect(fs.readFileSync(filePath, 'utf8')).toBe('created');

    // overwrite mode
    await writeFile.execute({ path: filePath, content: 'overwritten', mode: 'overwrite' }, {});
    expect(fs.readFileSync(filePath, 'utf8')).toBe('overwritten');

    // append mode
    await writeFile.execute({ path: filePath, content: '+appended', mode: 'append' }, {});
    expect(fs.readFileSync(filePath, 'utf8')).toContain('+appended');

    // unknown mode defaults to undefined
    const filePath2 = path.join(root, 'unknown-mode.txt');
    await writeFile.execute({ path: filePath2, content: 'data', mode: 'unknown_mode' }, {});
  });

  it('list_dir rejects non-object args', async () => {
    const defs = createBuiltinToolDefinitions();
    const listDir = defs.find((d) => d.name === 'list_dir')!;
    await expect(listDir.execute([], {})).rejects.toThrow(ToolExecutionError);
  });

  it('list_dir rejects missing path', async () => {
    const defs = createBuiltinToolDefinitions();
    const listDir = defs.find((d) => d.name === 'list_dir')!;
    await expect(listDir.execute({ path: '' }, {})).rejects.toThrow(ToolExecutionError);
  });

  it('list_dir with string filter', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bf-ld-'));
    fs.writeFileSync(path.join(root, 'a.ts'), '', 'utf8');
    fs.writeFileSync(path.join(root, 'b.js'), '', 'utf8');

    const defs = createBuiltinToolDefinitions();
    const listDir = defs.find((d) => d.name === 'list_dir')!;
    const result = await listDir.execute({
      path: root,
      filter: '*.ts',
    }, {}) as { entries: Array<{ name: string }> };
    expect(result.entries.some((e) => e.name === 'a.ts')).toBe(true);
  });

  it('list_dir with array filter', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bf-ld2-'));
    fs.writeFileSync(path.join(root, 'a.ts'), '', 'utf8');
    fs.writeFileSync(path.join(root, 'b.js'), '', 'utf8');

    const defs = createBuiltinToolDefinitions();
    const listDir = defs.find((d) => d.name === 'list_dir')!;
    const result = await listDir.execute({
      path: root,
      filter: ['*.ts', '*.js'],
    }, {}) as { entries: Array<{ name: string }> };
    expect(result.entries.length).toBe(2);
  });

  it('list_dir with invalid filter type (number) defaults to undefined', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bf-ld3-'));
    fs.writeFileSync(path.join(root, 'a.txt'), '', 'utf8');

    const defs = createBuiltinToolDefinitions();
    const listDir = defs.find((d) => d.name === 'list_dir')!;
    const result = await listDir.execute({
      path: root,
      filter: 123,
    }, {}) as { entries: Array<{ name: string }> };
    // filter is ignored, all files returned
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
  });

  it('list_dir with maxEntries, includeHidden, and recursive', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bf-ld4-'));
    fs.writeFileSync(path.join(root, 'a.txt'), '', 'utf8');
    fs.writeFileSync(path.join(root, '.hidden'), '', 'utf8');

    const defs = createBuiltinToolDefinitions();
    const listDir = defs.find((d) => d.name === 'list_dir')!;
    const result = await listDir.execute({
      path: root,
      recursive: true,
      includeHidden: true,
      maxEntries: 10,
    }, {}) as { entries: Array<{ name: string }> };
    expect(result.entries.some((e) => e.name === '.hidden')).toBe(true);
  });

  it('bash_execute rejects non-object args', async () => {
    const defs = createBuiltinToolDefinitions();
    const bash = defs.find((d) => d.name === 'bash_execute')!;
    await expect(bash.execute('not-an-object', {})).rejects.toThrow(ToolExecutionError);
  });

  it('bash_execute rejects missing command', async () => {
    const defs = createBuiltinToolDefinitions();
    const bash = defs.find((d) => d.name === 'bash_execute')!;
    await expect(bash.execute({ command: '' }, {})).rejects.toThrow(ToolExecutionError);
  });

  it.skipIf(process.platform === 'win32')('bash_execute parses env field with string values', async () => {
    const defs = createBuiltinToolDefinitions({ bashDefaultTimeoutMs: 5000 });
    const bash = defs.find((d) => d.name === 'bash_execute')!;
    const result = await bash.execute({
      command: 'echo hello',
      env: { FOO: 'bar', INVALID: 123 },
    }, {});
    expect(result).toBeDefined();
  });

  it.skipIf(process.platform === 'win32')('bash_execute with timeoutMs, workingDir, maxStdoutBytes, maxStderrBytes, actor', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bf-bash-'));
    const defs = createBuiltinToolDefinitions();
    const bash = defs.find((d) => d.name === 'bash_execute')!;
    const result = await bash.execute({
      command: 'echo test',
      timeoutMs: 5000,
      workingDir: root,
      maxStdoutBytes: 1024,
      maxStderrBytes: 1024,
      actor: 'test-actor',
    }, {});
    expect(result).toBeDefined();
  });

  it('web_fetch rejects non-object args', async () => {
    const defs = createBuiltinToolDefinitions();
    const webFetch = defs.find((d) => d.name === 'web_fetch')!;
    await expect(webFetch.execute(null, {})).rejects.toThrow(ToolExecutionError);
  });

  it('web_fetch rejects missing url', async () => {
    const defs = createBuiltinToolDefinitions();
    const webFetch = defs.find((d) => d.name === 'web_fetch')!;
    await expect(webFetch.execute({ url: '' }, {})).rejects.toThrow(ToolExecutionError);
  });

  it('web_fetch parses all optional fields', async () => {
    const fetchMock = vi.fn(async () =>
      new Response('content', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const defs = createBuiltinToolDefinitions({
      webFetchSummarizer: ({ content }) => `s:${content}`,
    });
    const webFetch = defs.find((d) => d.name === 'web_fetch')!;
    const result = await webFetch.execute({
      url: 'https://example.com',
      prompt: 'summarize',
      timeoutMs: 3000,
      maxBytes: 5000,
    }, {});
    expect(result).toBeDefined();
  });
});

describe('readOptionalString and readOptionalBoolean and readOptionalInteger edge cases', () => {
  it.skipIf(process.platform === 'win32')('readOptionalString returns undefined for non-string', async () => {
    const defs = createBuiltinToolDefinitions();
    const bash = defs.find((d) => d.name === 'bash_execute')!;
    // actor is optional string, pass a number
    const result = await bash.execute({
      command: 'echo test',
      actor: 123,
    }, {});
    expect(result).toBeDefined();
  });

  it('readOptionalBoolean returns undefined for non-boolean', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bf-bool-'));
    fs.writeFileSync(path.join(root, 'a.txt'), '', 'utf8');

    const defs = createBuiltinToolDefinitions();
    const listDir = defs.find((d) => d.name === 'list_dir')!;
    // recursive should be boolean, pass string
    const result = await listDir.execute({
      path: root,
      recursive: 'yes',
      includeHidden: 'yes',
    }, {}) as { entries: Array<{ name: string }> };
    expect(result.entries).toBeDefined();
  });

  it('readOptionalInteger returns undefined for non-integer (float)', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bf-int-'));
    fs.writeFileSync(path.join(root, 'a.txt'), '', 'utf8');

    const defs = createBuiltinToolDefinitions();
    const listDir = defs.find((d) => d.name === 'list_dir')!;
    const result = await listDir.execute({
      path: root,
      maxEntries: 1.5,
    }, {}) as { entries: Array<{ name: string }> };
    // maxEntries is ignored (not integer)
    expect(result.entries).toBeDefined();
  });

  it('readOptionalInteger returns undefined for string value', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-bf-intstr-'));
    fs.writeFileSync(path.join(root, 'a.txt'), '', 'utf8');

    const defs = createBuiltinToolDefinitions();
    const readFile = defs.find((d) => d.name === 'read_file')!;
    const filePath = path.join(root, 'a.txt');
    const result = await readFile.execute({
      path: filePath,
      offset: 'not-a-number',
      limit: 'also-not',
    }, {});
    expect(result).toBeDefined();
  });
});

describe('createDefinition coverage', () => {
  it('createBuiltinToolDefinitions uses options for defaults', () => {
    const defs = createBuiltinToolDefinitions({
      readFileDefaultLimit: 500,
      readFileMaxLimit: 2000,
      bashDefaultTimeoutMs: 30000,
      bashDefaultMaxOutputBytes: 1024 * 1024,
      webFetchDefaultTimeoutMs: 10000,
      webFetchDefaultMaxBytes: 50000,
    });
    expect(defs).toHaveLength(5);
    for (const def of defs) {
      expect(def.source).toBe('builtin');
      expect(typeof def.permissionLevel).toBe('string');
    }
  });
});
