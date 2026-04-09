# @xifan-coder/plugin-smoldev

`smoldev_generate` plugin for XiFanCoder.

## Tool

- `smoldev_generate`
  - Input: `{ spec: string, outputDir: string, stack?: string }`
  - Behavior: three-phase scaffold generation (plan -> file specs -> parallel writes)
  - Safety: `outputDir` must be empty or non-existent

## Example plugin config

```json
{
  "plugins": [
    {
      "name": "smol-dev",
      "version": "0.1.0",
      "description": "smol-dev project bootstrap plugin",
      "type": "stdio",
      "command": "node",
      "args": ["./node_modules/@xifan-coder/plugin-smoldev/dist/main.js"],
      "enabled": true,
      "requireConfirmation": false,
      "permissionLevel": 1,
      "timeout": 30000
    }
  ]
}
```
