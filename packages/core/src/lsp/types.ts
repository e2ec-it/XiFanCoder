export interface TextRange {
  readonly startLine: number;
  readonly startCharacter: number;
  readonly endLine: number;
  readonly endCharacter: number;
}

export interface LSPDiagnostic {
  readonly message: string;
  readonly severity: 'error' | 'warning' | 'info' | 'hint';
  readonly range: TextRange;
}

export interface LSPSymbol {
  readonly name: string;
  readonly kind: string;
  readonly filePath: string;
  readonly range: TextRange;
}

export interface LSPReference {
  readonly filePath: string;
  readonly range: TextRange;
}

export interface LSPRenameEdit {
  readonly filePath: string;
  readonly range: TextRange;
  readonly newText: string;
}

export interface LSPClient {
  readonly language: string;
  diagnostics(filePath: string, content: string): Promise<readonly LSPDiagnostic[]>;
  workspaceSymbols(query: string): Promise<readonly LSPSymbol[]>;
  references(filePath: string, position: { line: number; character: number }): Promise<readonly LSPReference[]>;
  renamePreview(
    filePath: string,
    position: { line: number; character: number },
    newName: string,
  ): Promise<readonly LSPRenameEdit[]>;
}

export interface LSPUnavailableResult {
  readonly available: false;
  readonly reason: string;
}

export interface LSPAvailableResult<T> {
  readonly available: true;
  readonly data: T;
}

export type LSPResult<T> = LSPUnavailableResult | LSPAvailableResult<T>;
