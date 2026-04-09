# 插件开发指南

## 1. 目录与命名

官方插件包命名约定：

1. `@xifan/plugin-<name>`
2. 示例：`@xifan/plugin-smoldev`

参考规范文档：

1. `01_docs/internal/plugin-publish-governance.md`

## 2. 生命周期概览

一个插件在运行期通常经历：

1. 发现（Discovery）
2. 注册（Register）
3. 调用（Invoke）
4. 退出（Dispose）

## 3. 最小 package.json 结构

```json
{
  "name": "@xifan/plugin-example",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

## 4. 开发与调试

推荐命令：

```bash
pnpm run plugin:check
pnpm --filter @xifan/plugin-smoldev run build
pnpm --filter @xifan/plugin-smoldev test
```

发布前演练：

```bash
npm_config_cache=/tmp/.npm-cache pnpm --filter @xifan/plugin-smoldev publish --dry-run --no-git-checks
```

## 5. 常见问题

1. `Typecheck` 报 `Could not find a declaration file for module 'ws'`
2. 处理：在插件包 `devDependencies` 中显式添加 `@types/ws`

