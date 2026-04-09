# XiFanCoder

[![npm version](https://img.shields.io/npm/v/@xifan-coder/cli)](https://www.npmjs.com/package/@xifan-coder/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Unit Tests](https://img.shields.io/badge/unit_tests-100%25_coverage-brightgreen)](./packages)
[![Integration Tests](https://img.shields.io/badge/integration_tests-117_cases-brightgreen)](./packages)
[![Release Gate](https://img.shields.io/badge/release_gate-passing-brightgreen)](./packages)

**Languages:** [简体中文](README.md) | [繁體中文](README_zh-HK.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [한국어](README_ko-KR.md)

**XiFanCoder** is an extensible AI Agent CLI coding tool that provides a unified AI coding experience with freely switchable LLM backends and a horizontally scalable plugin ecosystem.

## Core Features

- **Agent Loop** — Complete agent cycle: context building → request construction → tool invocation → result backfill
- **Multi-model Support** — Anthropic, OpenAI, Ollama, LiteLLM Proxy (100+ model routing)
- **Plugin System** — Aider (deep Git integration), Open Interpreter (code execution), smol-dev (project scaffolding)
- **MCP Tool Bus** — Standardized tool and IDE integration (stdio / WebSocket), supporting both Client and Server roles
- **Cross-session Memory** — xifan-mem auto-captures observations, three-step progressive retrieval, session summary generation
- **Session Persistence** — SQLite storage with create / resume / compress support
- **Token Cost Tracking** — Real-time statistics, session-level aggregation, budget limits
- **XIFAN.md Injection** — Project-level AI work instructions (compatible with .cursorrules)
- **Security Design** — 4-tier tool permissions (L0-L3), Headless mode denies high privileges by default, secrets never stored on disk

## Capability Tiers

| Tier | Dependencies | Features |
|------|-------------|----------|
| **L1 Core** | Node.js ≥ 18 | Agent Loop, built-in tools, Slash Commands, SQLite sessions, MCP, direct LLM connection |
| **L2 Enhanced** | Python ≥ 3.11 | LiteLLM Proxy (100+ models), Aider plugin, Open Interpreter, vector memory retrieval |

The L1 Core tier works independently without Python.

## Installation

```bash
# npm
npm install -g @xifan-coder/cli

# pnpm
pnpm add -g @xifan-coder/cli
```

## Quick Start

```bash
# Interactive REPL
xifan-coder

# Single task
xifan-coder "Refactor src/auth.ts"

# Start with a specific model
xifan-coder --model qwen2.5-coder

# Resume last session
xifan-coder --session resume

# CI/script mode (denies high-privilege tools by default)
xifan-coder --headless "Run tests and fix failing cases"
```

## Slash Commands

| Command | Description |
|---------|-------------|
| `/init` | Generate/update XIFAN.md project configuration |
| `/model <name>` | Switch LLM backend |
| `/style <style>` | Switch output style (concise / verbose / chinese / code-only) |
| `/tools` | List available tools |
| `/plugin <name> <args>` | Invoke a specific plugin |
| `/session list\|resume` | Session management |
| `/memory search <query>` | Cross-session memory search |
| `/cost` | Show current session cost |
| `/undo` | Undo last file modification |
| `/compact` | Compress message history to save tokens |
| `/context` | Show current context injection state |
| `/mode build\|plan` | Switch operation mode |
| `/help` | Show help |

## CLI Commands

```bash
# Session management
xifan-coder session list
xifan-coder session create --model <name> --provider <name>
xifan-coder session resume --id <id>
xifan-coder cost [--session <id> | --today | --model <name>]

# Memory
xifan-coder memory search --query <text> [--project <path>]
xifan-coder memory open [--port <n>]

# MCP Server
xifan-coder mcp serve [--port <n>] [--tls-key <path> --tls-cert <path>]

# Plugins
xifan-coder plugin list
xifan-coder plugin <name> [<args>]

# Skills & Tasks
xifan-coder skill list
xifan-coder skill use <name>
xifan-coder todo list | add | start | done

# Configuration
xifan-coder init --config
xifan-coder mode set <build|plan>
xifan-coder resolve-llm-driver
xifan-coder setup [--server <host>]
```

## Configuration

Configuration priority (highest to lowest):

```
CLI arguments > Environment variables > Project .xifan/config.yaml > Global ~/.xifan/config.yaml > Defaults
```

**Global configuration** `~/.xifan/config.yaml`:

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

**Project configuration** `XIFAN.md`:

```bash
xifan-coder init --config  # Auto-generate
```

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [@xifan-coder/cli](./packages/cli) | Command-line interface | [![npm](https://img.shields.io/npm/v/@xifan-coder/cli)](https://www.npmjs.com/package/@xifan-coder/cli) |
| [@xifan-coder/core](./packages/core) | Agent Loop, LLM drivers, tools, MCP | [![npm](https://img.shields.io/npm/v/@xifan-coder/core)](https://www.npmjs.com/package/@xifan-coder/core) |
| [@xifan-coder/plugin-bus](./packages/plugin-bus) | Plugin discovery, registry, lifecycle | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-bus)](https://www.npmjs.com/package/@xifan-coder/plugin-bus) |
| [@xifan-coder/plugin-sdk](./packages/plugin-sdk) | Plugin interfaces and types | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-sdk)](https://www.npmjs.com/package/@xifan-coder/plugin-sdk) |
| [@xifan-coder/mem](./packages/xifan-mem) | Cross-session memory persistence | [![npm](https://img.shields.io/npm/v/@xifan-coder/mem)](https://www.npmjs.com/package/@xifan-coder/mem) |
| [@xifan-coder/agents](./packages/xifan-agents) | Agent observation and memory system | [![npm](https://img.shields.io/npm/v/@xifan-coder/agents)](https://www.npmjs.com/package/@xifan-coder/agents) |
| [@xifan-coder/plugin-aider](./packages/plugin-aider) | Aider plugin (multi-file editing) | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-aider)](https://www.npmjs.com/package/@xifan-coder/plugin-aider) |
| [@xifan-coder/plugin-oi](./packages/plugin-oi) | Open Interpreter plugin | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-oi)](https://www.npmjs.com/package/@xifan-coder/plugin-oi) |
| [@xifan-coder/plugin-smoldev](./packages/plugin-smoldev) | smol-dev project scaffolding plugin | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-smoldev)](https://www.npmjs.com/package/@xifan-coder/plugin-smoldev) |

## Security

- **Tool Permission Tiers**: L0 read-only (auto) → L1 write (requires confirmation) → L2 Shell (requires confirmation) → L3 dangerous (requires explicit enablement)
- **Headless Mode**: `--headless` denies L1+ permissions by default; use `--allow-write` / `--allow-shell` to explicitly allow
- **Secret Security**: API keys read from environment variables only; sessions never store plaintext keys
- **MCP Security**: WebSocket channel enforces token authentication + Origin validation, binds to 127.0.0.1 only

See [SECURITY.md](./SECURITY.md) for details.

## Development

```bash
git clone https://github.com/e2ec-it/XiFanCoder.git
cd XiFanCoder
pnpm install
pnpm run build
pnpm run test
```

## License

[MIT](./LICENSE)
