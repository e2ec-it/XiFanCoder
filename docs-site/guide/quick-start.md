# 快速开始

## 1. 环境要求

1. Node.js >= 18
2. pnpm >= 9

## 2. 安装依赖

```bash
pnpm install
```

## 3. 本地质量检查

```bash
pnpm docs:check
pnpm version:check
pnpm -r run typecheck
pnpm -r run test
```

## 4. 启动文档站

```bash
pnpm docs:site:dev
```

## 5. 构建文档站

```bash
pnpm docs:site:build
pnpm docs:site:preview
```

