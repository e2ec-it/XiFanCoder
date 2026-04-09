import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  discoverXifanSources,
  loadXifanContext,
  mergeXifanContent,
  renderXifanVariables,
  toXifanContextBlock,
  type XifanInjectorFs,
} from '../xifan-injector.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-injector-'));
  tempDirs.push(dir);
  return dir;
}

describe('discoverXifanSources', () => {
  it('discovers cascading sources from home to current directory', () => {
    const root = makeTempDir();
    const home = path.join(root, 'home');
    const project = path.join(root, 'project');
    const cwd = path.join(project, 'apps', 'web');
    fs.mkdirSync(path.join(home, '.xifan'), { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });

    const globalFile = path.join(home, '.xifan', 'XIFAN.md');
    const projectFile = path.join(project, 'XIFAN.md');
    const cwdFile = path.join(cwd, 'XIFAN.md');
    fs.writeFileSync(globalFile, 'global', 'utf8');
    fs.writeFileSync(projectFile, 'project', 'utf8');
    fs.writeFileSync(cwdFile, 'cwd', 'utf8');

    const discovered = discoverXifanSources({
      cwd,
      homeDir: home,
    });

    expect(discovered).toContain(globalFile);
    expect(discovered).toContain(projectFile);
    expect(discovered).toContain(cwdFile);
    expect(discovered.indexOf(globalFile)).toBeLessThan(discovered.indexOf(projectFile));
    expect(discovered.indexOf(projectFile)).toBeLessThan(discovered.indexOf(cwdFile));
  });

  it('deduplicates resolved sources that map to the same path', () => {
    const root = makeTempDir();
    const cwd = path.join(root, 'project');
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.xifan'), { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });

    // XIFAN.md in cwd appears via ancestor traversal
    const xifanFile = path.join(cwd, 'XIFAN.md');
    fs.writeFileSync(xifanFile, 'content', 'utf8');

    const discovered = discoverXifanSources({ cwd, homeDir: home });
    // Should not have duplicates
    const resolved = discovered.map((p) => path.resolve(p));
    expect(new Set(resolved).size).toBe(resolved.length);
  });

  it('skips unreadable files', () => {
    const readable = '/tmp/readable/XIFAN.md';
    const blocked = '/tmp/blocked/XIFAN.md';

    const mockFs: XifanInjectorFs = {
      existsSync: (targetPath: string): boolean => targetPath === readable || targetPath === blocked,
      accessSync: (targetPath: string): void => {
        if (targetPath === blocked) {
          throw new Error('EACCES');
        }
      },
      readFileSync: () => '',
    };

    const discovered = discoverXifanSources({
      cwd: '/tmp/blocked',
      homeDir: '/tmp',
      fileSystem: mockFs,
    });

    expect(discovered).not.toContain(blocked);
  });
});

describe('xifan content merge and rendering', () => {
  it('overrides same section with higher-priority fragment', () => {
    const merged = mergeXifanContent([
      '## Build\nnpm test\n\n## Style\n2 spaces',
      '## Build\npnpm test',
    ]);

    expect(merged).toContain('## Build\npnpm test');
    expect(merged).toContain('## Style\n2 spaces');
  });

  it('renders template variables', () => {
    const rendered = renderXifanVariables('Project={{PROJECT_NAME}} cwd={{CWD}}', {
      PROJECT_NAME: 'demo',
      CWD: '/tmp/demo',
    });
    expect(rendered).toBe('Project=demo cwd=/tmp/demo');
  });

  it('loads and injects xifan context block', () => {
    const root = makeTempDir();
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'project');
    fs.mkdirSync(path.join(home, '.xifan'), { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(home, '.xifan', 'XIFAN.md'), '## Rules\nglobal', 'utf8');
    fs.writeFileSync(path.join(cwd, '.cursorrules'), 'Use pnpm', 'utf8');

    const loaded = loadXifanContext({
      cwd,
      homeDir: home,
      variables: { PROJECT_NAME: 'proj' },
    });

    expect(loaded.content).toContain('## Rules');
    expect(loaded.content).toContain('Imported Cursor Rules');
    expect(toXifanContextBlock(loaded.content)).toContain('<xifan-context>');
    expect(loaded.secretFindings).toEqual([]);
  });

  it('returns empty content when no source files exist', () => {
    const root = makeTempDir();
    const loaded = loadXifanContext({
      cwd: root,
      homeDir: path.join(root, 'home'),
    });

    expect(loaded.content).toBe('');
    expect(loaded.sources).toEqual([]);
    expect(loaded.secretFindings).toEqual([]);
  });

  it('skips empty source files during merge', () => {
    const root = makeTempDir();
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'project');
    fs.mkdirSync(path.join(home, '.xifan'), { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    // Create an empty file (after trim becomes empty)
    fs.writeFileSync(path.join(cwd, 'XIFAN.md'), '   \n  \n', 'utf8');
    fs.writeFileSync(path.join(home, '.xifan', 'XIFAN.md'), '## Rules\nglobal rule', 'utf8');

    const loaded = loadXifanContext({ cwd, homeDir: home });
    // Empty file should be skipped, global should still be present
    expect(loaded.content).toContain('global rule');
  });

  it('handles ## without space as non-heading (no section split)', () => {
    const merged = mergeXifanContent([
      '##NoSpaceAfterHash\nBody content\n\n## Valid\nValid body',
    ]);
    // The ##NoSpaceAfterHash line should be treated as preamble, not heading
    expect(merged).toContain('##NoSpaceAfterHash');
    expect(merged).toContain('## Valid');
  });

  it('reports secret leak patterns in loaded context', () => {
    const root = makeTempDir();
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'project');
    fs.mkdirSync(path.join(home, '.xifan'), { recursive: true });
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(
      path.join(cwd, 'XIFAN.md'),
      [
        'apiKey=sk-abcdefghijklmnopqrstuvwxyz123456',
        'Authorization: Bearer abcdefghijklmnopqrstuvwx123456',
        'ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwxyz1234',
      ].join('\n'),
      'utf8',
    );

    const loaded = loadXifanContext({
      cwd,
      homeDir: home,
    });

    expect(loaded.secretFindings.length).toBeGreaterThan(0);
    const patternIds = loaded.secretFindings.map((item) => item.patternId);
    expect(patternIds).toContain('openai_key');
    expect(patternIds).toContain('bearer_token');
    expect(patternIds).toContain('anthropic_key');
  });
});
