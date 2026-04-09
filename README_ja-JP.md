# XiFanCoder

[![npm version](https://img.shields.io/npm/v/@xifan-coder/cli)](https://www.npmjs.com/package/@xifan-coder/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Unit Tests](https://img.shields.io/badge/unit_tests-100%25_coverage-brightgreen)](./packages)
[![Integration Tests](https://img.shields.io/badge/integration_tests-117_cases-brightgreen)](./packages)
[![Release Gate](https://img.shields.io/badge/release_gate-passing-brightgreen)](./packages)

**Languages:** [简体中文](README.md) | [繁體中文](README_zh-HK.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [한국어](README_ko-KR.md)

**XiFanCoder** は拡張可能な AI Agent CLI コーディングツールです。統一された AI コーディング体験を提供し、バックエンドの LLM を自由に切り替え、プラグインエコシステムで水平に拡張できます。

## 主な機能

- **Agent Loop** — コンテキスト構築 → リクエスト生成 → ツール呼び出し → 結果反映の完全な Agent サイクル
- **マルチモデル対応** — Anthropic、OpenAI、Ollama、LiteLLM Proxy（100以上のモデルルーティング）
- **プラグインシステム** — Aider（Git 深度統合）、Open Interpreter（コード実行）、smol-dev（プロジェクトスキャフォールディング）
- **MCP ツールバス** — 標準化されたツールと IDE の統合（stdio / WebSocket）、Client と Server の両方をサポート
- **クロスセッションメモリ** — xifan-mem が自動的に観察を記録、三段階の漸進的検索、セッションサマリー生成
- **セッション永続化** — SQLite ストレージ、作成 / 復元 / 圧縮をサポート
- **トークンコスト追跡** — リアルタイム統計、セッションレベルの集計、予算制限
- **XIFAN.md インジェクション** — プロジェクトレベルの AI 作業指示（.cursorrules 互換）
- **セキュリティ設計** — ツール権限の4段階分類（L0-L3）、Headless モードはデフォルトで高権限を拒否、秘密鍵はディスクに保存しない

## 機能ティア

| ティア | 依存関係 | 含まれる機能 |
|--------|----------|-------------|
| **L1 コア** | Node.js ≥ 18 | Agent Loop、組み込みツール、Slash Commands、SQLite セッション、MCP、LLM 直接接続 |
| **L2 拡張** | Python ≥ 3.11 | LiteLLM Proxy（100以上のモデル）、Aider プラグイン、Open Interpreter、ベクトルメモリ検索 |

L1 コアティアは Python なしで独立して動作します。

## インストール

```bash
# npm
npm install -g @xifan-coder/cli

# pnpm
pnpm add -g @xifan-coder/cli
```

## クイックスタート

```bash
# インタラクティブ REPL
xifan-coder

# 単発タスク
xifan-coder "src/auth.ts をリファクタリングして"

# モデルを指定して起動
xifan-coder --model qwen2.5-coder

# 前回のセッションを復元
xifan-coder --session resume

# CI/スクリプトモード（デフォルトで高権限ツールを拒否）
xifan-coder --headless "テストを実行して失敗ケースを修正"
```

## Slash Commands

| コマンド | 説明 |
|---------|------|
| `/init` | XIFAN.md プロジェクト設定を生成/更新 |
| `/model <name>` | LLM バックエンドを切り替え |
| `/style <style>` | 出力スタイルを切り替え（concise / verbose / chinese / code-only） |
| `/tools` | 利用可能なツールを一覧表示 |
| `/plugin <name> <args>` | 指定プラグインを呼び出し |
| `/session list\|resume` | セッション管理 |
| `/memory search <query>` | クロスセッションメモリ検索 |
| `/cost` | 現在のセッションコストを表示 |
| `/undo` | 最後のファイル変更を取り消し |
| `/compact` | メッセージ履歴を圧縮してトークンを節約 |
| `/context` | 現在のコンテキストインジェクション状態を表示 |
| `/mode build\|plan` | 操作モードを切り替え |
| `/help` | ヘルプを表示 |

## CLI コマンド

```bash
# セッション管理
xifan-coder session list
xifan-coder session create --model <name> --provider <name>
xifan-coder session resume --id <id>
xifan-coder cost [--session <id> | --today | --model <name>]

# メモリ
xifan-coder memory search --query <text> [--project <path>]
xifan-coder memory open [--port <n>]

# MCP Server
xifan-coder mcp serve [--port <n>] [--tls-key <path> --tls-cert <path>]

# プラグイン
xifan-coder plugin list
xifan-coder plugin <name> [<args>]

# スキル & タスク
xifan-coder skill list
xifan-coder skill use <name>
xifan-coder todo list | add | start | done

# 設定
xifan-coder init --config
xifan-coder mode set <build|plan>
xifan-coder resolve-llm-driver
xifan-coder setup [--server <host>]
```

## 設定

設定の優先順位（高い順）：

```
CLI 引数 > 環境変数 > プロジェクト .xifan/config.yaml > グローバル ~/.xifan/config.yaml > デフォルト値
```

**グローバル設定** `~/.xifan/config.yaml`：

```yaml
llm:
  default: claude-sonnet-4-6
  driver: auto            # auto | builtin | litellm

plugins:
  aider:
    enabled: true
  smol-dev:
    enabled: true

session:
  auto_compact_threshold: 80

memory:
  enabled: true
  auto_capture: true
  auto_inject: true

budget:
  session_limit_usd: 0.50
  daily_limit_usd: 5.00
  action_on_exceed: warn  # warn | pause | stop
```

**プロジェクト設定** `XIFAN.md`：

```bash
xifan-coder init --config  # 自動生成
```

## パッケージ

| パッケージ | 説明 | npm |
|-----------|------|-----|
| [@xifan-coder/cli](./packages/cli) | コマンドラインインターフェース | [![npm](https://img.shields.io/npm/v/@xifan-coder/cli)](https://www.npmjs.com/package/@xifan-coder/cli) |
| [@xifan-coder/core](./packages/core) | Agent Loop、LLM ドライバー、ツール、MCP | [![npm](https://img.shields.io/npm/v/@xifan-coder/core)](https://www.npmjs.com/package/@xifan-coder/core) |
| [@xifan-coder/plugin-bus](./packages/plugin-bus) | プラグイン検出、レジストリ、ライフサイクル | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-bus)](https://www.npmjs.com/package/@xifan-coder/plugin-bus) |
| [@xifan-coder/plugin-sdk](./packages/plugin-sdk) | プラグインインターフェースと型定義 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-sdk)](https://www.npmjs.com/package/@xifan-coder/plugin-sdk) |
| [@xifan-coder/mem](./packages/xifan-mem) | クロスセッションメモリ永続化 | [![npm](https://img.shields.io/npm/v/@xifan-coder/mem)](https://www.npmjs.com/package/@xifan-coder/mem) |
| [@xifan-coder/agents](./packages/xifan-agents) | Agent 観察とメモリシステム | [![npm](https://img.shields.io/npm/v/@xifan-coder/agents)](https://www.npmjs.com/package/@xifan-coder/agents) |
| [@xifan-coder/plugin-aider](./packages/plugin-aider) | Aider プラグイン（マルチファイル編集） | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-aider)](https://www.npmjs.com/package/@xifan-coder/plugin-aider) |
| [@xifan-coder/plugin-oi](./packages/plugin-oi) | Open Interpreter プラグイン | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-oi)](https://www.npmjs.com/package/@xifan-coder/plugin-oi) |
| [@xifan-coder/plugin-smoldev](./packages/plugin-smoldev) | smol-dev プロジェクトスキャフォールディングプラグイン | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-smoldev)](https://www.npmjs.com/package/@xifan-coder/plugin-smoldev) |

## セキュリティ

- **ツール権限ティア**：L0 読み取り専用（自動）→ L1 書き込み（確認必要）→ L2 Shell（確認必要）→ L3 危険（明示的有効化が必要）
- **Headless モード**：`--headless` はデフォルトで L1+ 権限を拒否。`--allow-write` / `--allow-shell` で明示的に許可
- **秘密鍵セキュリティ**：API キーは環境変数からのみ読み取り、セッションに平文で保存しない
- **MCP セキュリティ**：WebSocket チャネルはトークン認証 + Origin 検証を強制、127.0.0.1 のみにバインド

詳細は [SECURITY.md](./SECURITY.md) をご覧ください。

## 開発

```bash
git clone https://github.com/e2ec-it/XiFanCoder.git
cd XiFanCoder
pnpm install
pnpm run build
pnpm run test
```

## ライセンス

[MIT](./LICENSE)
