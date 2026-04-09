# XiFanCoder

[![npm version](https://img.shields.io/npm/v/@xifan-coder/cli)](https://www.npmjs.com/package/@xifan-coder/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Unit Tests](https://img.shields.io/badge/unit_tests-100%25_coverage-brightgreen)](./packages)
[![Integration Tests](https://img.shields.io/badge/integration_tests-117_cases-brightgreen)](./packages)
[![Release Gate](https://img.shields.io/badge/release_gate-passing-brightgreen)](./packages)

**Languages:** [简体中文](README.md) | [繁體中文](README_zh-HK.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [한국어](README_ko-KR.md)

**XiFanCoder** 是一个可扩展的 AI Agent 编码工具 CLI，提供统一的 AI 编码体验入口，底层模型可自由切换，工具生态通过插件横向扩展。

**XiFanCoder** is an extensible AI Agent CLI coding tool that provides a unified AI coding experience with freely switchable LLM backends and a horizontally scalable plugin ecosystem.

## 核心能力 / Core Features

- **Agent Loop** — 上下文构建 → 请求构造 → 工具调用 → 结果回填的完整 Agent 循环
- **多模型支持** — Anthropic、OpenAI、Ollama、LiteLLM Proxy（100+ 模型路由）
- **插件系统** — Aider（Git 深度集成）、Open Interpreter（代码执行）、smol-dev（项目脚手架）
- **MCP 工具总线** — 标准化工具与 IDE 集成（stdio / WebSocket），支持 Client 和 Server 双角色
- **跨会话记忆** — xifan-mem 自动捕获观察、三步渐进式检索、会话摘要生成
- **会话持久化** — SQLite 存储，支持创建 / 恢复 / 压缩
- **Token 费用追踪** — 实时统计、会话级汇总、预算限制
- **XIFAN.md 注入** — 项目级 AI 工作指令（兼容 .cursorrules）
- **安全设计** — 工具权限 4 级分级（L0-L3）、Headless 模式默认拒绝高权限、秘钥不落盘

## 能力分级 / Capability Tiers

| 级别 | 依赖 | 包含功能 |
|------|------|---------|
| **L1 核心层** | Node.js ≥ 18 | Agent Loop、内置工具、Slash Commands、SQLite 会话、MCP、直连 LLM |
| **L2 增强层** | Python ≥ 3.11 | LiteLLM Proxy（100+ 模型）、Aider 插件、Open Interpreter、向量记忆检索 |

L1 核心层可独立工作，无需 Python 环境。

## 安装 / Installation

```bash
# npm
npm install -g @xifan-coder/cli

# pnpm
pnpm add -g @xifan-coder/cli
```

## 快速开始 / Quick Start

```bash
# 交互式 REPL
xifan-coder

# 单次任务
xifan-coder "帮我重构 src/auth.ts"

# 指定模型启动
xifan-coder --model qwen2.5-coder

# 恢复上次会话
xifan-coder --session resume

# CI/脚本模式（默认拒绝高权限工具）
xifan-coder --headless "运行测试并修复失败用例"
```

## Slash Commands

| 命令 | 说明 |
|------|------|
| `/init` | 生成/更新 XIFAN.md 项目配置 |
| `/model <name>` | 切换 LLM 后端 |
| `/style <style>` | 切换输出风格（concise / verbose / chinese / code-only） |
| `/tools` | 列出可用工具 |
| `/plugin <name> <args>` | 调用指定插件 |
| `/session list\|resume` | 会话管理 |
| `/memory search <query>` | 跨会话记忆搜索 |
| `/cost` | 显示当前会话费用 |
| `/undo` | 撤销上一次文件修改 |
| `/compact` | 压缩历史消息节省 token |
| `/context` | 显示当前上下文注入状态 |
| `/mode build\|plan` | 切换操作模式 |
| `/help` | 显示帮助 |

## CLI 命令 / CLI Commands

```bash
# 会话管理
xifan-coder session list
xifan-coder session create --model <name> --provider <name>
xifan-coder session resume --id <id>
xifan-coder cost [--session <id> | --today | --model <name>]

# 记忆
xifan-coder memory search --query <text> [--project <path>]
xifan-coder memory open [--port <n>]

# MCP Server
xifan-coder mcp serve [--port <n>] [--tls-key <path> --tls-cert <path>]

# 插件
xifan-coder plugin list
xifan-coder plugin <name> [<args>]

# 技能 & 任务
xifan-coder skill list
xifan-coder skill use <name>
xifan-coder todo list | add | start | done

# 配置
xifan-coder init --config
xifan-coder mode set <build|plan>
xifan-coder resolve-llm-driver
xifan-coder setup [--server <host>]
```

## 配置 / Configuration

配置优先级（从高到低）：

```
命令行参数 > 环境变量 > 项目级 .xifan/config.yaml > 全局 ~/.xifan/config.yaml > 默认值
```

**全局配置** `~/.xifan/config.yaml`：

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

**项目配置** `XIFAN.md`：

```bash
xifan-coder init --config  # 自动生成
```

## 包结构 / Packages

| 包 | 说明 | npm |
|---|------|-----|
| [@xifan-coder/cli](./packages/cli) | 命令行界面 | [![npm](https://img.shields.io/npm/v/@xifan-coder/cli)](https://www.npmjs.com/package/@xifan-coder/cli) |
| [@xifan-coder/core](./packages/core) | Agent Loop、LLM 驱动、工具、MCP | [![npm](https://img.shields.io/npm/v/@xifan-coder/core)](https://www.npmjs.com/package/@xifan-coder/core) |
| [@xifan-coder/plugin-bus](./packages/plugin-bus) | 插件发现、注册、生命周期 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-bus)](https://www.npmjs.com/package/@xifan-coder/plugin-bus) |
| [@xifan-coder/plugin-sdk](./packages/plugin-sdk) | 插件接口与类型 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-sdk)](https://www.npmjs.com/package/@xifan-coder/plugin-sdk) |
| [@xifan-coder/mem](./packages/xifan-mem) | 跨会话记忆持久化 | [![npm](https://img.shields.io/npm/v/@xifan-coder/mem)](https://www.npmjs.com/package/@xifan-coder/mem) |
| [@xifan-coder/agents](./packages/xifan-agents) | Agent 观察与记忆系统 | [![npm](https://img.shields.io/npm/v/@xifan-coder/agents)](https://www.npmjs.com/package/@xifan-coder/agents) |
| [@xifan-coder/plugin-aider](./packages/plugin-aider) | Aider 插件（多文件编辑） | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-aider)](https://www.npmjs.com/package/@xifan-coder/plugin-aider) |
| [@xifan-coder/plugin-oi](./packages/plugin-oi) | Open Interpreter 插件 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-oi)](https://www.npmjs.com/package/@xifan-coder/plugin-oi) |
| [@xifan-coder/plugin-smoldev](./packages/plugin-smoldev) | smol-dev 项目脚手架插件 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-smoldev)](https://www.npmjs.com/package/@xifan-coder/plugin-smoldev) |

## 安全 / Security

- **工具权限分级**：L0 只读（自动）→ L1 写操作（需确认）→ L2 Shell（需确认）→ L3 危险（需显式启用）
- **Headless 模式**：`--headless` 默认拒绝 L1+ 权限，需 `--allow-write` / `--allow-shell` 显式放行
- **秘钥安全**：API Key 仅从环境变量读取，会话不存储明文
- **MCP 安全**：WebSocket 通道强制 token 认证 + Origin 校验，仅绑定 127.0.0.1

详见 [SECURITY.md](./SECURITY.md)。

## 开发 / Development

```bash
git clone https://github.com/e2ec-it/XiFanCoder.git
cd XiFanCoder
pnpm install
pnpm run build
pnpm run test
```

常用 Make 命令：

```bash
make help                     # 查看所有可用命令
make build                    # 构建全部包
make test                     # 运行全部测试
make lint                     # ESLint 检查
make typecheck                # TypeScript 检查
make test-release-gate        # Release 门禁测试
make test-integration-prd     # PRD 功能集成测试
make npm-publish              # 发布到 npm
```

测试覆盖：

- **单元测试**：全部 9 包 100% 行覆盖率
- **集成测试**：23 个测试文件覆盖 PRD 全部功能章节（117 用例）
- **Release Gate**：whitebox + blackbox + blackbox-ui 三层门禁

## 多语言文档更新流程

1. 编辑 `README.md`（简体中文源文件）
2. 运行 `bash 02_scripts/sync-readme-i18n.sh --check` 检测过期翻译
3. 在 Claude Code 中执行 `/xifan-readme-i18n` 自动重新翻译
4. 运行 `make opensource-sync` 同步到公开仓库

## License

[MIT](./LICENSE)
