# XiFanCoder

[![npm version](https://img.shields.io/npm/v/@xifan-coder/cli)](https://www.npmjs.com/package/@xifan-coder/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Unit Tests](https://img.shields.io/badge/unit_tests-100%25_coverage-brightgreen)](./packages)
[![Integration Tests](https://img.shields.io/badge/integration_tests-117_cases-brightgreen)](./packages)
[![Release Gate](https://img.shields.io/badge/release_gate-passing-brightgreen)](./packages)

**Languages:** [简体中文](README.md) | [繁體中文](README_zh-HK.md) | [English](README_en-US.md) | [日本語](README_ja-JP.md) | [한국어](README_ko-KR.md)

**XiFanCoder**는 확장 가능한 AI Agent CLI 코딩 도구로, 통합된 AI 코딩 경험을 제공합니다. 백엔드 LLM을 자유롭게 전환할 수 있으며, 플러그인 생태계를 통해 수평적으로 확장됩니다.

## 핵심 기능

- **Agent Loop** — 컨텍스트 구축 → 요청 생성 → 도구 호출 → 결과 반영의 완전한 Agent 사이클
- **멀티 모델 지원** — Anthropic, OpenAI, Ollama, LiteLLM Proxy (100개 이상의 모델 라우팅)
- **플러그인 시스템** — Aider (Git 심층 통합), Open Interpreter (코드 실행), smol-dev (프로젝트 스캐폴딩)
- **MCP 도구 버스** — 표준화된 도구와 IDE 통합 (stdio / WebSocket), Client 및 Server 이중 역할 지원
- **크로스 세션 메모리** — xifan-mem 자동 관찰 캡처, 3단계 점진적 검색, 세션 요약 생성
- **세션 영속화** — SQLite 저장소, 생성 / 복원 / 압축 지원
- **토큰 비용 추적** — 실시간 통계, 세션 수준 집계, 예산 제한
- **XIFAN.md 주입** — 프로젝트 수준 AI 작업 지시 (.cursorrules 호환)
- **보안 설계** — 도구 권한 4단계 분류 (L0-L3), Headless 모드 기본적으로 높은 권한 거부, 비밀키 디스크에 저장하지 않음

## 기능 티어

| 티어 | 의존성 | 포함 기능 |
|------|--------|----------|
| **L1 코어** | Node.js ≥ 18 | Agent Loop, 내장 도구, Slash Commands, SQLite 세션, MCP, LLM 직접 연결 |
| **L2 확장** | Python ≥ 3.11 | LiteLLM Proxy (100개 이상 모델), Aider 플러그인, Open Interpreter, 벡터 메모리 검색 |

L1 코어 티어는 Python 없이 독립적으로 작동합니다.

## 설치

```bash
# npm
npm install -g @xifan-coder/cli

# pnpm
pnpm add -g @xifan-coder/cli
```

## 빠른 시작

```bash
# 대화형 REPL
xifan-coder

# 단일 작업
xifan-coder "src/auth.ts 리팩토링 해주세요"

# 특정 모델로 시작
xifan-coder --model qwen2.5-coder

# 이전 세션 복원
xifan-coder --session resume

# CI/스크립트 모드 (기본적으로 높은 권한 도구 거부)
xifan-coder --headless "테스트를 실행하고 실패한 케이스를 수정"
```

## Slash Commands

| 명령 | 설명 |
|------|------|
| `/init` | XIFAN.md 프로젝트 설정 생성/업데이트 |
| `/model <name>` | LLM 백엔드 전환 |
| `/style <style>` | 출력 스타일 전환 (concise / verbose / chinese / code-only) |
| `/tools` | 사용 가능한 도구 목록 표시 |
| `/plugin <name> <args>` | 지정 플러그인 호출 |
| `/session list\|resume` | 세션 관리 |
| `/memory search <query>` | 크로스 세션 메모리 검색 |
| `/cost` | 현재 세션 비용 표시 |
| `/undo` | 마지막 파일 수정 취소 |
| `/compact` | 메시지 기록 압축으로 토큰 절약 |
| `/context` | 현재 컨텍스트 주입 상태 표시 |
| `/mode build\|plan` | 작업 모드 전환 |
| `/help` | 도움말 표시 |

## CLI 명령

```bash
# 세션 관리
xifan-coder session list
xifan-coder session create --model <name> --provider <name>
xifan-coder session resume --id <id>
xifan-coder cost [--session <id> | --today | --model <name>]

# 메모리
xifan-coder memory search --query <text> [--project <path>]
xifan-coder memory open [--port <n>]

# MCP Server
xifan-coder mcp serve [--port <n>] [--tls-key <path> --tls-cert <path>]

# 플러그인
xifan-coder plugin list
xifan-coder plugin <name> [<args>]

# 스킬 & 작업
xifan-coder skill list
xifan-coder skill use <name>
xifan-coder todo list | add | start | done

# 설정
xifan-coder init --config
xifan-coder mode set <build|plan>
xifan-coder resolve-llm-driver
xifan-coder setup [--server <host>]
```

## 설정

설정 우선순위 (높은 순서):

```
CLI 인수 > 환경 변수 > 프로젝트 .xifan/config.yaml > 글로벌 ~/.xifan/config.yaml > 기본값
```

**글로벌 설정** `~/.xifan/config.yaml`:

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

**프로젝트 설정** `XIFAN.md`:

```bash
xifan-coder init --config  # 자동 생성
```

## 패키지

| 패키지 | 설명 | npm |
|--------|------|-----|
| [@xifan-coder/cli](./packages/cli) | 커맨드라인 인터페이스 | [![npm](https://img.shields.io/npm/v/@xifan-coder/cli)](https://www.npmjs.com/package/@xifan-coder/cli) |
| [@xifan-coder/core](./packages/core) | Agent Loop, LLM 드라이버, 도구, MCP | [![npm](https://img.shields.io/npm/v/@xifan-coder/core)](https://www.npmjs.com/package/@xifan-coder/core) |
| [@xifan-coder/plugin-bus](./packages/plugin-bus) | 플러그인 검색, 레지스트리, 라이프사이클 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-bus)](https://www.npmjs.com/package/@xifan-coder/plugin-bus) |
| [@xifan-coder/plugin-sdk](./packages/plugin-sdk) | 플러그인 인터페이스 및 타입 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-sdk)](https://www.npmjs.com/package/@xifan-coder/plugin-sdk) |
| [@xifan-coder/mem](./packages/xifan-mem) | 크로스 세션 메모리 영속화 | [![npm](https://img.shields.io/npm/v/@xifan-coder/mem)](https://www.npmjs.com/package/@xifan-coder/mem) |
| [@xifan-coder/agents](./packages/xifan-agents) | Agent 관찰 및 메모리 시스템 | [![npm](https://img.shields.io/npm/v/@xifan-coder/agents)](https://www.npmjs.com/package/@xifan-coder/agents) |
| [@xifan-coder/plugin-aider](./packages/plugin-aider) | Aider 플러그인 (멀티 파일 편집) | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-aider)](https://www.npmjs.com/package/@xifan-coder/plugin-aider) |
| [@xifan-coder/plugin-oi](./packages/plugin-oi) | Open Interpreter 플러그인 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-oi)](https://www.npmjs.com/package/@xifan-coder/plugin-oi) |
| [@xifan-coder/plugin-smoldev](./packages/plugin-smoldev) | smol-dev 프로젝트 스캐폴딩 플러그인 | [![npm](https://img.shields.io/npm/v/@xifan-coder/plugin-smoldev)](https://www.npmjs.com/package/@xifan-coder/plugin-smoldev) |

## 보안

- **도구 권한 티어**: L0 읽기 전용 (자동) → L1 쓰기 (확인 필요) → L2 Shell (확인 필요) → L3 위험 (명시적 활성화 필요)
- **Headless 모드**: `--headless`는 기본적으로 L1+ 권한을 거부합니다. `--allow-write` / `--allow-shell`로 명시적 허용
- **비밀키 보안**: API 키는 환경 변수에서만 읽으며, 세션에 평문으로 저장하지 않음
- **MCP 보안**: WebSocket 채널은 토큰 인증 + Origin 검증을 강제하며, 127.0.0.1에만 바인딩

자세한 내용은 [SECURITY.md](./SECURITY.md)를 참조하세요.

## 개발

```bash
git clone https://github.com/e2ec-it/XiFanCoder.git
cd XiFanCoder
pnpm install
pnpm run build
pnpm run test
```

## 라이선스

[MIT](./LICENSE)
