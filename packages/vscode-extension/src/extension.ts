import * as vscode from 'vscode';

import { XiFanWebSocketClient } from './websocket-client.js';

const DEFAULT_WS_URL = 'ws://127.0.0.1:8787/mcp';

let client: XiFanWebSocketClient | undefined;

function getConfiguredUrl(): string {
  const configured = vscode.workspace.getConfiguration('xifan').get<string>('websocketUrl');
  return configured && configured.trim().length > 0 ? configured.trim() : DEFAULT_WS_URL;
}

function attachClient(output: vscode.OutputChannel, url: string, token?: string): XiFanWebSocketClient {
  return new XiFanWebSocketClient({
    url,
    token,
    onStatus: (status) => {
      output.appendLine(`[status] ${status}`);
    },
    onMessage: (message) => {
      output.appendLine(`[recv] ${message.text}`);
    },
    onError: (error) => {
      output.appendLine(`[error] ${error.message}`);
    },
  });
}

async function runConnect(output: vscode.OutputChannel): Promise<void> {
  const wsUrlInput = await vscode.window.showInputBox({
    title: 'XiFan WebSocket URL',
    prompt: '输入 XiFanCoder MCP WebSocket 地址',
    value: getConfiguredUrl(),
    ignoreFocusOut: true,
  });
  if (!wsUrlInput || wsUrlInput.trim().length === 0) {
    return;
  }
  const wsUrl = wsUrlInput.trim();

  const tokenInput = await vscode.window.showInputBox({
    title: 'XiFan Auth Token (Optional)',
    prompt: '如启用了 token 认证，请输入 token（可留空）',
    password: true,
    ignoreFocusOut: true,
  });
  const token = tokenInput && tokenInput.trim().length > 0 ? tokenInput.trim() : undefined;

  if (client) {
    client.disconnect();
  }
  client = attachClient(output, wsUrl, token);
  await client.connect();
  vscode.window.showInformationMessage(`XiFan connected: ${wsUrl}`);
}

async function runSend(output: vscode.OutputChannel): Promise<void> {
  if (!client || !client.isConnected) {
    vscode.window.showWarningMessage('XiFan WebSocket 未连接，请先执行 “XiFan: Connect WebSocket”。');
    return;
  }

  const text = await vscode.window.showInputBox({
    title: 'Send Message To XiFan',
    prompt: '输入要发送给 XiFanCoder 的消息',
    ignoreFocusOut: true,
  });
  if (!text || text.trim().length === 0) {
    return;
  }

  client.send({
    type: 'user_message',
    content: text.trim(),
    source: 'vscode',
  });
  output.appendLine(`[send] ${text.trim()}`);
}

function runDisconnect(output: vscode.OutputChannel): void {
  if (!client) {
    return;
  }
  client.disconnect();
  output.appendLine('[status] disconnected by command');
  vscode.window.showInformationMessage('XiFan WebSocket disconnected');
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('XiFan VSCode');
  output.appendLine('XiFan extension activated');

  context.subscriptions.push(output);
  context.subscriptions.push(
    vscode.commands.registerCommand('xifan.connectWebSocket', async () => {
      try {
        await runConnect(output);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`[error] connect failed: ${message}`);
        vscode.window.showErrorMessage(`XiFan connect failed: ${message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('xifan.sendMessage', async () => {
      try {
        await runSend(output);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        output.appendLine(`[error] send failed: ${message}`);
        vscode.window.showErrorMessage(`XiFan send failed: ${message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('xifan.disconnectWebSocket', () => {
      runDisconnect(output);
    }),
  );
}

export function deactivate(): void {
  if (!client) {
    return;
  }
  client.disconnect();
  client = undefined;
}

