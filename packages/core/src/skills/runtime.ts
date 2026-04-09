import fs from 'node:fs';
import path from 'node:path';

export interface SkillDescriptor {
  readonly name: string;
  readonly rootPath: string;
  readonly skillFilePath: string;
}

export interface SkillDocument {
  readonly descriptor: SkillDescriptor;
  readonly title: string;
  readonly content: string;
}

export interface DiscoverSkillsOptions {
  readonly roots: readonly string[];
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function parseSkillTitle(content: string, fallbackName: string): string {
  const firstHeading = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith('# '));

  if (!firstHeading) {
    return fallbackName;
  }

  return firstHeading.replace(/^#\s+/, '').trim() || fallbackName;
}

export function discoverSkills(options: DiscoverSkillsOptions): readonly SkillDescriptor[] {
  const result: SkillDescriptor[] = [];
  const seen = new Set<string>();

  for (const root of options.roots) {
    if (!isDirectory(root)) {
      continue;
    }

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillRoot = path.join(root, entry.name);
      const skillFilePath = path.join(skillRoot, 'SKILL.md');
      if (!fs.existsSync(skillFilePath)) {
        continue;
      }

      const key = `${entry.name}:${skillFilePath}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      result.push({
        name: entry.name,
        rootPath: skillRoot,
        skillFilePath,
      });
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function readSkill(descriptor: SkillDescriptor): SkillDocument {
  const content = fs.readFileSync(descriptor.skillFilePath, 'utf8');
  return {
    descriptor,
    title: parseSkillTitle(content, descriptor.name),
    content,
  };
}

export function findSkillByName(
  name: string,
  options: DiscoverSkillsOptions,
): SkillDescriptor | undefined {
  const skills = discoverSkills(options);
  return skills.find((skill) => skill.name === name);
}
