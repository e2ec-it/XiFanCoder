import fs from 'node:fs';
import path from 'node:path';

import micromatch from 'micromatch';

import { ToolExecutionError } from '../errors/tool-errors.js';

export interface ListDirRequest {
  readonly path: string;
  readonly recursive?: boolean;
  readonly filter?: string | readonly string[];
  readonly includeHidden?: boolean;
  readonly maxEntries?: number;
}

export interface ListDirEntry {
  readonly name: string;
  readonly path: string;
  readonly relativePath: string;
  readonly type: 'file' | 'directory';
  readonly children?: readonly ListDirEntry[];
}

export interface ListDirResult {
  readonly root: string;
  readonly recursive: boolean;
  readonly filter: readonly string[];
  readonly totalEntries: number;
  readonly truncated: boolean;
  readonly entries: readonly ListDirEntry[];
}

const DEFAULT_MAX_ENTRIES = 2_000;

interface TraverseState {
  count: number;
  truncated: boolean;
}

function normalizeFilter(filter: ListDirRequest['filter']): readonly string[] {
  if (!filter) return [];
  if (typeof filter === 'string') {
    return [filter];
  }
  return [...filter];
}

function normalizeMaxEntries(maxEntries: number | undefined): number {
  const value = maxEntries ?? DEFAULT_MAX_ENTRIES;
  if (!Number.isInteger(value) || value <= 0) {
    throw new ToolExecutionError('list_dir', `invalid maxEntries: ${value}`);
  }
  return value;
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

function matchesFilter(relativePath: string, filter: readonly string[]): boolean {
  if (filter.length === 0) return true;
  return micromatch.isMatch(toPosixPath(relativePath), filter, { dot: true });
}

function createEntry(
  absolutePath: string,
  rootPath: string,
  type: ListDirEntry['type'],
  children?: readonly ListDirEntry[],
): ListDirEntry {
  const relativePath = path.relative(rootPath, absolutePath) || '.';
  return {
    name: path.basename(absolutePath),
    path: absolutePath,
    relativePath: toPosixPath(relativePath),
    type,
    children,
  };
}

function walkDirectory(
  dirPath: string,
  rootPath: string,
  recursive: boolean,
  filter: readonly string[],
  includeHidden: boolean,
  maxEntries: number,
  state: TraverseState,
): readonly ListDirEntry[] {
  /* v8 ignore next 3 -- defensive guard: parent loop breaks before re-entering */
  if (state.truncated) {
    return [];
  }

  let dirents: readonly fs.Dirent[];
  try {
    dirents = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error) {
    throw new ToolExecutionError('list_dir', `failed to read directory: ${dirPath}`, error);
  }

  const sorted = [...dirents].sort((a, b) => a.name.localeCompare(b.name));
  const entries: ListDirEntry[] = [];

  for (const dirent of sorted) {
    if (!includeHidden && isHiddenName(dirent.name)) {
      continue;
    }

    if (state.count >= maxEntries) {
      state.truncated = true;
      break;
    }

    const absolutePath = path.join(dirPath, dirent.name);
    const relativePath = toPosixPath(path.relative(rootPath, absolutePath));

    if (dirent.isDirectory()) {
      const childEntries = recursive
        ? walkDirectory(
          absolutePath,
          rootPath,
          true,
          filter,
          includeHidden,
          maxEntries,
          state,
        )
        : [];

      const includeDirectory =
        filter.length === 0 ||
        matchesFilter(relativePath, filter) ||
        childEntries.length > 0;

      if (includeDirectory) {
        entries.push(
          createEntry(
            absolutePath,
            rootPath,
            'directory',
            recursive ? childEntries : undefined,
          ),
        );
        state.count += 1;
      }
      continue;
    }

    if (!dirent.isFile()) {
      continue;
    }

    if (!matchesFilter(relativePath, filter)) {
      continue;
    }

    entries.push(createEntry(absolutePath, rootPath, 'file'));
    state.count += 1;
  }

  return entries;
}

export function listDirectory(request: ListDirRequest): ListDirResult {
  const recursive = request.recursive ?? false;
  const filter = normalizeFilter(request.filter);
  const includeHidden = request.includeHidden ?? true;
  const maxEntries = normalizeMaxEntries(request.maxEntries);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(request.path);
  } catch (error) {
    throw new ToolExecutionError('list_dir', `stat failed: ${request.path}`, error);
  }

  if (!stat.isDirectory()) {
    throw new ToolExecutionError('list_dir', `path is not a directory: ${request.path}`);
  }

  const state: TraverseState = { count: 0, truncated: false };
  const entries = walkDirectory(
    request.path,
    request.path,
    recursive,
    filter,
    includeHidden,
    maxEntries,
    state,
  );

  return {
    root: request.path,
    recursive,
    filter,
    totalEntries: state.count,
    truncated: state.truncated,
    entries,
  };
}
