import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { smoldevGenerate } from '../generator.js';

describe('smoldevGenerate', () => {
  it('generates scaffold with three-phase result payload', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-smoldev-'));
    const outputDir = path.join(root, 'todo-app');

    const result = await smoldevGenerate({
      spec: 'Build a todo app with REST API',
      outputDir,
      stack: 'node+typescript+express',
    });

    expect(result.plan.projectName.length).toBeGreaterThan(0);
    expect(result.plan.planYaml).toContain('files:');
    expect(result.filesCreated).toContain('README.md');
    expect(result.filesCreated).toContain('src/server.ts');
    expect(result.progress).toHaveLength(result.filesCreated.length);
    expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(true);
  });

  it('rejects non-empty outputDir to prevent overwrites', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-smoldev-unsafe-'));
    const outputDir = path.join(root, 'existing');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'keep.txt'), 'do-not-overwrite', 'utf8');

    await expect(
      smoldevGenerate({
        spec: 'Generate any project',
        outputDir,
        stack: 'node',
      }),
    ).rejects.toThrowError('outputDir must be empty');
  });

  it('supports chinese spec and marks language=zh', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-smoldev-zh-'));
    const outputDir = path.join(root, 'zh-app');

    const result = await smoldevGenerate({
      spec: '生成一个支持用户登录的博客系统',
      outputDir,
      stack: 'react+typescript',
    });

    expect(result.plan.language).toBe('zh');
    expect(result.filesCreated).toContain('src/App.tsx');
    expect(fs.readFileSync(path.join(outputDir, 'README.md'), 'utf8')).toContain('需求说明');
  });

  it('generates english node entry for non-react non-express stack', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-smoldev-en-'));
    const outputDir = path.join(root, 'en-app');

    const result = await smoldevGenerate({
      spec: 'Build a simple CLI utility',
      outputDir,
      stack: 'typescript',
    });

    expect(result.plan.language).toBe('en');
    expect(result.filesCreated).toContain('src/index.ts');
    const indexContent = fs.readFileSync(path.join(outputDir, 'src/index.ts'), 'utf8');
    expect(indexContent).toContain('smol-dev bootstrap');
  });

  it('generates chinese node entry for non-react non-express stack', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-smoldev-zh-node-'));
    const outputDir = path.join(root, 'zh-node-app');

    const result = await smoldevGenerate({
      spec: '搭建一个命令行工具',
      outputDir,
      stack: 'typescript',
    });

    expect(result.plan.language).toBe('zh');
    expect(result.filesCreated).toContain('src/index.ts');
    const indexContent = fs.readFileSync(path.join(outputDir, 'src/index.ts'), 'utf8');
    expect(indexContent).toContain('smol-dev 启动');
  });

  it('rejects when outputDir is a file instead of a directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xifan-smoldev-notdir-'));
    const filePath = path.join(root, 'not-a-dir');
    fs.writeFileSync(filePath, 'I am a file', 'utf8');

    await expect(
      smoldevGenerate({
        spec: 'Any project',
        outputDir: filePath,
      }),
    ).rejects.toThrowError('outputDir is not a directory');
  });
});
