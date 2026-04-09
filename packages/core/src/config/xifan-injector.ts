import fs from 'node:fs';
import path from 'node:path';

import { detectPlaintextSecrets, type SecretLeakFinding } from './secrets.js';

export interface XifanInjectorFs {
  existsSync(targetPath: string): boolean;
  accessSync(targetPath: string, mode?: number): void;
  readFileSync(targetPath: string, encoding: BufferEncoding): string;
}

export interface DiscoverXifanSourcesOptions {
  readonly cwd: string;
  readonly homeDir?: string;
  readonly fileSystem?: XifanInjectorFs;
}

export interface LoadXifanContextOptions extends DiscoverXifanSourcesOptions {
  readonly variables?: Record<string, string>;
}

export interface XifanContextLoadResult {
  readonly content: string;
  readonly sources: readonly string[];
  readonly secretFindings: readonly SecretLeakFinding[];
}

const DEFAULT_FS: XifanInjectorFs = {
  existsSync: (targetPath: string): boolean => fs.existsSync(targetPath),
  accessSync: (targetPath: string, mode?: number): void => fs.accessSync(targetPath, mode),
  readFileSync: (targetPath: string, encoding: BufferEncoding): string =>
    fs.readFileSync(targetPath, encoding),
};

export function discoverXifanSources(
  options: DiscoverXifanSourcesOptions,
): readonly string[] {
  const fileSystem = options.fileSystem ?? DEFAULT_FS;
  const cwd = path.resolve(options.cwd);
  const homeDir = path.resolve(options.homeDir ?? process.env.HOME ?? '~');
  const candidates: string[] = [];

  candidates.push(path.join(homeDir, '.xifan', 'XIFAN.md'));
  for (const dir of listAncestorsFromRoot(cwd)) {
    candidates.push(path.join(dir, 'XIFAN.md'));
    candidates.push(path.join(dir, '.cursorrules'));
    candidates.push(path.join(dir, '.cursor', 'rules'));
  }

  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    /* v8 ignore next 3 -- defensive dedup: candidates may only collide via symlinks */
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    if (!fileSystem.existsSync(resolved)) {
      continue;
    }
    if (!isReadable(resolved, fileSystem)) {
      continue;
    }
    deduped.push(resolved);
  }

  return deduped;
}

export function loadXifanContext(
  options: LoadXifanContextOptions,
): XifanContextLoadResult {
  const fileSystem = options.fileSystem ?? DEFAULT_FS;
  const sources = discoverXifanSources(options);
  if (sources.length === 0) {
    return {
      content: '',
      sources: [],
      secretFindings: [],
    };
  }

  const fragments: string[] = [];
  for (const source of sources) {
    const raw = fileSystem.readFileSync(source, 'utf8').trim();
    if (!raw) {
      continue;
    }
    fragments.push(normalizeSourceContent(source, raw));
  }

  const merged = mergeXifanContent(fragments);
  const rendered = renderXifanVariables(merged, {
    PROJECT_NAME: path.basename(path.resolve(options.cwd)),
    CWD: path.resolve(options.cwd),
    ...options.variables,
  });

  return {
    content: rendered.trim(),
    sources,
    secretFindings: detectPlaintextSecrets(rendered),
  };
}

export function mergeXifanContent(fragments: readonly string[]): string {
  const preambles: string[] = [];
  const sectionOrder: string[] = [];
  const sectionMap = new Map<string, string>();

  for (const fragment of fragments) {
    const parsed = parseMarkdownSections(fragment);
    if (parsed.preamble.trim()) {
      preambles.push(parsed.preamble.trim());
    }

    for (const section of parsed.sections) {
      if (!sectionMap.has(section.title)) {
        sectionOrder.push(section.title);
      }
      sectionMap.set(section.title, section.body.trim());
    }
  }

  const chunks: string[] = [];
  if (preambles.length > 0) {
    chunks.push(preambles.join('\n\n'));
  }

  for (const title of sectionOrder) {
    chunks.push(`## ${title}\n${sectionMap.get(title) ?? ''}`.trimEnd());
  }

  return chunks.join('\n\n').trim();
}

export function renderXifanVariables(
  content: string,
  variables: Record<string, string>,
): string {
  return content.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_full, key: string) => {
    return variables[key] ?? `{{${key}}}`;
  });
}

export function toXifanContextBlock(content: string): string {
  if (!content.trim()) {
    return '';
  }
  return `<xifan-context>\n${content.trim()}\n</xifan-context>`;
}

function normalizeSourceContent(sourcePath: string, raw: string): string {
  if (sourcePath.endsWith('.cursorrules') || sourcePath.endsWith(`${path.sep}rules`)) {
    return `## Imported Cursor Rules\n${raw}`;
  }
  return raw;
}

function listAncestorsFromRoot(target: string): readonly string[] {
  const upward: string[] = [];
  let current = target;
  while (true) {
    upward.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return upward.reverse();
}

function isReadable(targetPath: string, fileSystem: XifanInjectorFs): boolean {
  try {
    fileSystem.accessSync(targetPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function parseMarkdownSections(content: string): {
  preamble: string;
  sections: Array<{ title: string; body: string }>;
} {
  const lines = content.split(/\r?\n/);
  const sections: Array<{ title: string; body: string }> = [];
  const preambleLines: string[] = [];

  let activeTitle: string | undefined;
  let activeBody: string[] = [];

  for (const line of lines) {
    const heading = parseLevel2Heading(line);
    if (heading) {
      if (activeTitle) {
        sections.push({
          title: activeTitle,
          body: activeBody.join('\n').trim(),
        });
      }
      activeTitle = heading;
      activeBody = [];
      continue;
    }

    if (activeTitle) {
      activeBody.push(line);
    } else {
      preambleLines.push(line);
    }
  }

  if (activeTitle) {
    sections.push({
      title: activeTitle,
      body: activeBody.join('\n').trim(),
    });
  }

  return {
    preamble: preambleLines.join('\n').trim(),
    sections,
  };
}

function parseLevel2Heading(line: string): string | undefined {
  if (!line.startsWith('##')) {
    return undefined;
  }

  let index = 2;
  let sawWhitespace = false;
  while (index < line.length) {
    const char = line.charCodeAt(index);
    if (char === 0x20 || char === 0x09) {
      sawWhitespace = true;
      index += 1;
      continue;
    }
    break;
  }
  if (!sawWhitespace) {
    return undefined;
  }

  const title = line.slice(index).trim();
  return title || undefined;
}
