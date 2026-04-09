import fs from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';

import type {
  LSPClient,
  LSPDiagnostic,
  LSPReference,
  LSPRenameEdit,
  LSPSymbol,
  TextRange,
} from './types.js';

const SYMBOL_REGEX =
  /\b(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.xifan']);

function isSupportedFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function toRange(content: string, start: number, end: number): TextRange {
  const source = ts.createSourceFile('tmp.ts', content, ts.ScriptTarget.Latest, true);
  const startPos = ts.getLineAndCharacterOfPosition(source, start);
  const endPos = ts.getLineAndCharacterOfPosition(source, end);
  return {
    startLine: startPos.line + 1,
    startCharacter: startPos.character + 1,
    endLine: endPos.line + 1,
    endCharacter: endPos.character + 1,
  };
}

function collectTypeScriptFiles(rootDir: string): readonly string[] {
  const files: string[] = [];

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) {
          continue;
        }
        walk(fullPath);
        continue;
      }
      if (entry.isFile() && isSupportedFile(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return files;
}

function getIdentifierAtPosition(content: string, line: number, character: number): string | undefined {
  const lines = content.split(/\r?\n/);
  const lineIndex = line - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return undefined;
  }
  const row = lines[lineIndex] ?? '';
  const charIndex = Math.max(0, character - 1);
  if (charIndex >= row.length) {
    return undefined;
  }

  const isWord = (ch: string): boolean => /[A-Za-z0-9_$]/.test(ch);
  if (!isWord(row[charIndex] ?? '')) {
    return undefined;
  }

  let start = charIndex;
  while (start > 0 && isWord(row[start - 1] ?? '')) {
    start -= 1;
  }
  let end = charIndex;
  while (end + 1 < row.length && isWord(row[end + 1] ?? '')) {
    end += 1;
  }

  return row.slice(start, end + 1);
}

function mapDiagnosticCategory(
  category: ts.DiagnosticCategory,
): LSPDiagnostic['severity'] {
  if (category === ts.DiagnosticCategory.Error) {
    return 'error';
  }
  /* v8 ignore next 5 -- TS transpileModule only emits Error diagnostics */
  if (category === ts.DiagnosticCategory.Warning) {
    return 'warning';
  }
  return 'info';
}

export class BasicTypeScriptLSPClient implements LSPClient {
  readonly language = 'typescript';
  private readonly rootDir: string;

  constructor(options: { rootDir?: string } = {}) {
    this.rootDir = options.rootDir ?? process.cwd();
  }

  async diagnostics(filePath: string, content: string): Promise<readonly LSPDiagnostic[]> {
    const source = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);
    const result = ts.transpileModule(content, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        strict: true,
      },
      reportDiagnostics: true,
      fileName: filePath,
    });

    const diagnostics = result.diagnostics ?? [];
    return diagnostics.map((diag) => {
      const start = diag.start ?? 0;
      const length = diag.length ?? 1;
      const startPos = ts.getLineAndCharacterOfPosition(source, start);
      const endPos = ts.getLineAndCharacterOfPosition(source, start + length);
      return {
        message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
        severity: mapDiagnosticCategory(diag.category),
        range: {
          startLine: startPos.line + 1,
          startCharacter: startPos.character + 1,
          endLine: endPos.line + 1,
          endCharacter: endPos.character + 1,
        },
      };
    });
  }

  async workspaceSymbols(query: string): Promise<readonly LSPSymbol[]> {
    const files = collectTypeScriptFiles(this.rootDir);
    const lowerQuery = query.toLowerCase();
    const out: LSPSymbol[] = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      SYMBOL_REGEX.lastIndex = 0;
      for (;;) {
        const match = SYMBOL_REGEX.exec(content);
        if (!match) {
          break;
        }
        const name = match[1] ?? '';
        if (!name.toLowerCase().includes(lowerQuery)) {
          continue;
        }
        const start = match.index + match[0].lastIndexOf(name);
        const end = start + name.length;
        out.push({
          name,
          kind: 'Symbol',
          filePath,
          range: toRange(content, start, end),
        });
      }
    }

    return out;
  }

  async references(
    filePath: string,
    position: { line: number; character: number },
  ): Promise<readonly LSPReference[]> {
    const baseContent = fs.readFileSync(filePath, 'utf8');
    const identifier = getIdentifierAtPosition(baseContent, position.line, position.character);
    if (!identifier) {
      return [];
    }

    const files = collectTypeScriptFiles(this.rootDir);
    const refs: LSPReference[] = [];
    const regex = new RegExp(`\\b${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');

    for (const candidate of files) {
      const content = fs.readFileSync(candidate, 'utf8');
      regex.lastIndex = 0;
      for (;;) {
        const match = regex.exec(content);
        if (!match) {
          break;
        }
        const start = match.index;
        const end = start + identifier.length;
        refs.push({
          filePath: candidate,
          range: toRange(content, start, end),
        });
      }
    }

    return refs;
  }

  async renamePreview(
    filePath: string,
    position: { line: number; character: number },
    newName: string,
  ): Promise<readonly LSPRenameEdit[]> {
    const refs = await this.references(filePath, position);
    return refs.map((ref) => ({
      filePath: ref.filePath,
      range: ref.range,
      newText: newName,
    }));
  }
}
