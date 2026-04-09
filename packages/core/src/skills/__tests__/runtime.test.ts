import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { discoverSkills, findSkillByName, readSkill } from '../runtime.js';

function makeSkill(root: string, name: string, content: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content, 'utf8');
  return dir;
}

describe('skills runtime', () => {
  it('discovers skills from multiple roots', () => {
    const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-a-'));
    const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-b-'));

    makeSkill(rootA, 'alpha', '# Alpha\n\nfirst');
    makeSkill(rootB, 'beta', '# Beta\n\nsecond');

    const discovered = discoverSkills({ roots: [rootA, rootB] });
    expect(discovered.map((x) => x.name)).toEqual(['alpha', 'beta']);
  });

  it('ignores folders without SKILL.md', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-c-'));
    fs.mkdirSync(path.join(root, 'invalid'), { recursive: true });

    const discovered = discoverSkills({ roots: [root] });
    expect(discovered).toHaveLength(0);
  });

  it('reads skill document and parses title from heading', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-d-'));
    makeSkill(root, 'alpha', '# Alpha Skill\n\nbody');

    const descriptor = discoverSkills({ roots: [root] })[0];
    expect(descriptor).toBeDefined();

    const doc = readSkill(descriptor!);
    expect(doc.title).toBe('Alpha Skill');
    expect(doc.content).toContain('body');
  });

  it('finds skill by name', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e-'));
    makeSkill(root, 'alpha', '# Alpha Skill');

    const found = findSkillByName('alpha', { roots: [root] });
    expect(found?.name).toBe('alpha');

    const missing = findSkillByName('beta', { roots: [root] });
    expect(missing).toBeUndefined();
  });

  it('skips non-existent roots', () => {
    const discovered = discoverSkills({ roots: ['/tmp/nonexistent-skill-root-' + Date.now()] });
    expect(discovered).toHaveLength(0);
  });

  it('uses fallback name when no heading found', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-f-'));
    makeSkill(root, 'no-heading', 'This skill has no heading line');

    const descriptor = discoverSkills({ roots: [root] })[0]!;
    const doc = readSkill(descriptor);
    expect(doc.title).toBe('no-heading');
  });

  it('skips non-directory entries in root', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-g-'));
    // Create a file (not a directory) inside root
    fs.writeFileSync(path.join(root, 'not-a-dir'), 'file', 'utf8');
    makeSkill(root, 'valid', '# Valid Skill');

    const discovered = discoverSkills({ roots: [root] });
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.name).toBe('valid');
  });

  it('deduplicates skills discovered from same root listed twice', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-h-'));
    makeSkill(root, 'alpha', '# Alpha');

    const discovered = discoverSkills({ roots: [root, root] });
    expect(discovered).toHaveLength(1);
  });
});
