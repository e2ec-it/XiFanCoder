# XiFanCoder

[![npm version](https://img.shields.io/npm/v/@xifan-coder/cli)](https://www.npmjs.com/package/@xifan-coder/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Unit Tests](https://img.shields.io/badge/unit_tests-100%25_coverage-brightgreen)](./packages)
[![Integration Tests](https://img.shields.io/badge/integration_tests-117_cases-brightgreen)](./packages)
[![Release Gate](https://img.shields.io/badge/release_gate-passing-brightgreen)](./packages)

**Languages:** [简体中文](README.md) | [繁體中文](README_zh-HK.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [한국어](README_ko-KR.md)

**XiFanCoder** 是一個可擴展的 AI Agent 編碼工具 CLI，提供統一的 AI 編碼體驗入口，底層模型可自由切換，工具生態透過外掛橫向擴展。

## 核心能力

- **Agent Loop** — 上下文建構 → 請求構造 → 工具呼叫 → 結果回填的完整 Agent 迴圈
- **多模型支援** — Anthropic、OpenAI、Ollama、LiteLLM Proxy（100+ 模型路由）
- **外掛系統** — Aider（Git 深度整合）、Open Interpreter（程式碼執行）、smol-dev（專案鷹架）
- **MCP 工具匯流排** — 標準化工具與 IDE 整合（stdio / WebSocket），支援 Client 和 Server 雙角色
- **跨會話記憶** — xifan-mem 自動擷取觀察、三步漸進式檢索、會話摘要生成
- **會話持久化** — SQLite 儲存，支援建立 / 恢復 / 壓縮
- **Token 費用追蹤** — 即時統計、會話級匯總、預算限制
- **XIFAN.md 注入** — 專案級 AI 工作指令（相容 .cursorrules）
- **安全設計** — 工具權限 4 級分級（L0-L3）、Headless 模式預設拒絕高權限、密鑰不落碟

## 能力分級

| 級別 | 依賴 | 包含功能 |
|------|------|---------|
| **L1 核心層** | Node.js ≥ 18 | Agent Loop、內建工具、Slash Commands、SQLite 會話、MCP、直連 LLM |
| **L2 增強層** | Python ≥ 3.11 | LiteLLM Proxy（100+ 模型）、Aider 外掛、Open Interpreter、向量記憶檢索 |

L1 核心層可獨立運作，無需 Python 環境。

## 安裝

```bash
# npm
npm install -g @xifan-coder/cli

# pnpm
pnpm add -g @xifan-coder/cli
```

## 快速開始

```bash
# 互動式 REPL
xifan-coder

# 單次任務
xifan-coder "幫我重構 src/auth.ts"

# 指定模型啟動
xifan-coder --model qwen2.5-coder

# 恢復上次會話
xifan-coder --session resume

# CI/指令碼模式（預設拒絕高權限工具）
xifan-coder --headless "執行測試並修復失敗用例"
```

## Slash Commands

| 指令 | 說明 |
|------|------|
| `/init` | 生成/更新 XIFAN.md 專案配置 |
| `/model <name>` | 切換 LLM 後端 |
| `/style <style>` | 切換輸出風格（concise / verbose / chinese / code-only） |
| `/tools` | 列出可用工具 |
| `/plugin <name> <args>` | 呼叫指定外掛 |
| `/session list\|resume` | 會話管理 |
| `/memory search <query>` | 跨會話記憶搜尋 |
| `/cost` | 顯示當前會話費用 |
| `/undo` | 撤銷上一次檔案修改 |
| `/compact` | 壓縮歷史訊息節省 token |
| `/context` | 顯示當前上下文注入狀態 |
| `/mode build\|plan` | 切換操作模式 |
| `/help` | 顯示說明 |

## CLI 指令

```bash
# 會話管理
xifan-coder session list
xifan-coder session create --model <name> --provider <name>
xifan-coder session resume --id <id>
xifan-coder cost [--session <id> | --today | --model <name>]

# 記憶
xifan-coder memory search --query <text> [--project <path>]
xifan-coder memory open [--port <n>]

# MCP Server
xifan-coder mcp serve [--port <n>] [--tls-key <path> --tls-cert <path>]

# 外掛
xifan-coder plugin list
xifan-coder plugin <name> [<args>]

# 技能 & 任務
xifan-coder skill list
xifan-coder skill use <name>
xifan-coder todo list | add | start | done

# 配置
xifan-coder init --config
xifan-coder mode set <build|plan>
xifan-coder resolve-llm-driver
xifan-coder setup [--server <host>]
```

## 配置

配置優先順序（從高到低）：

```
命令列參數 > 環境變數 > 專案級 .xifan/config.yaml > 全域 ~/.xifan/config.yaml > 預設值
```

**全域配置** `~/.xifan/config.yaml`：

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

**專案配置** `XIFAN.md`：

```bash
xifan-coder init --config  # 自動生成
```

## 套件結構

| 套件 | 說明 | npm |
|------|------|-----|
| [@xifan-coder/cli](./packages/cli) | 命令列介面 | [![npm](https://img.shields.io/npm/v/@xifan-coder/cli)](https://www.npmjs.com/package/@xifan-coder/cli) |
| [@xifan-coder/core](./packages/core) | Agent Loop、LLM 驅動、工具、MCP | [![npm](https://img.shields.io/npm/v/@xifan-coder/core)](https://www.npmjs.com/package/@xifan-coder/core) |
| [@xifan-coder/plugin-bus](./packages/plugin-bus) | 外掛發現、註冊、生命週期 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-bus)](https://www.npmjs.com/package/@xifan-coder/plugin-bus) |
| [@xifan-coder/plugin-sdk](./packages/plugin-sdk) | 外掛介面與型別 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-sdk)](https://www.npmjs.com/package/@xifan-coder/plugin-sdk) |
| [@xifan-coder/mem](./packages/xifan-mem) | 跨會話記憶持久化 | [![npm](https://img.shields.io/npm/v/@xifan-coder/mem)](https://www.npmjs.com/package/@xifan-coder/mem) |
| [@xifan-coder/agents](./packages/xifan-agents) | Agent 觀察與記憶系統 | [![npm](https://img.shields.io/npm/v/@xifan-coder/agents)](https://www.npmjs.com/package/@xifan-coder/agents) |
| [@xifan-coder/plugin-aider](./packages/plugin-aider) | Aider 外掛（多檔案編輯） | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-aider)](https://www.npmjs.com/package/@xifan-coder/plugin-aider) |
| [@xifan-coder/plugin-oi](./packages/plugin-oi) | Open Interpreter 外掛 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-oi)](https://www.npmjs.com/package/@xifan-coder/plugin-oi) |
| [@xifan-coder/plugin-smoldev](./packages/plugin-smoldev) | smol-dev 專案鷹架外掛 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-smoldev)](https://www.npmjs.com/package/@xifan-coder/plugin-smoldev) |

## 安全

- **工具權限分級**：L0 唯讀（自動）→ L1 寫入操作（需確認）→ L2 Shell（需確認）→ L3 危險（需顯式啟用）
- **Headless 模式**：`--headless` 預設拒絕 L1+ 權限，需 `--allow-write` / `--allow-shell` 顯式放行
- **密鑰安全**：API Key 僅從環境變數讀取，會話不儲存明文
- **MCP 安全**：WebSocket 通道強制 token 驗證 + Origin 校驗，僅繫結 127.0.0.1

詳見 [SECURITY.md](./SECURITY.md)。

## 開發

```bash
git clone https://github.com/e2ec-it/XiFanCoder.git
cd XiFanCoder
pnpm install
pnpm run build
pnpm run test
```

## 授權條款

[MIT](./LICENSE)
