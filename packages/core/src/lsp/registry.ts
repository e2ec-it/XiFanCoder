import type {
  LSPClient,
  LSPDiagnostic,
  LSPReference,
  LSPRenameEdit,
  LSPResult,
  LSPSymbol,
} from './types.js';

export class LSPRegistry {
  private readonly clients = new Map<string, LSPClient>();

  register(client: LSPClient): void {
    this.clients.set(client.language, client);
  }

  unregister(language: string): void {
    this.clients.delete(language);
  }

  has(language: string): boolean {
    return this.clients.has(language);
  }

  async diagnostics(
    language: string,
    filePath: string,
    content: string,
  ): Promise<LSPResult<readonly LSPDiagnostic[]>> {
    const client = this.clients.get(language);
    if (!client) {
      return { available: false, reason: `No LSP client registered for language: ${language}` };
    }

    return {
      available: true,
      data: await client.diagnostics(filePath, content),
    };
  }

  async workspaceSymbols(language: string, query: string): Promise<LSPResult<readonly LSPSymbol[]>> {
    const client = this.clients.get(language);
    if (!client) {
      return { available: false, reason: `No LSP client registered for language: ${language}` };
    }

    return {
      available: true,
      data: await client.workspaceSymbols(query),
    };
  }

  async references(
    language: string,
    filePath: string,
    position: { line: number; character: number },
  ): Promise<LSPResult<readonly LSPReference[]>> {
    const client = this.clients.get(language);
    if (!client) {
      return { available: false, reason: `No LSP client registered for language: ${language}` };
    }

    return {
      available: true,
      data: await client.references(filePath, position),
    };
  }

  async renamePreview(
    language: string,
    filePath: string,
    position: { line: number; character: number },
    newName: string,
  ): Promise<LSPResult<readonly LSPRenameEdit[]>> {
    const client = this.clients.get(language);
    if (!client) {
      return { available: false, reason: `No LSP client registered for language: ${language}` };
    }

    return {
      available: true,
      data: await client.renamePreview(filePath, position, newName),
    };
  }
}
