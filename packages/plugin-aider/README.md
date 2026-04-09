# @xifan-coder/plugin-aider

Aider plugin for XiFanCoder (stdio JSON-RPC).

## Tools

- `aider_edit`: multi-file editing via Aider (`--no-auto-commits`, `--yes-always`)
- `aider_commit`: trigger Aider commit flow (`/commit`)
- `aider_undo`: rollback last AI change (`/undo`)

## Availability detection

The plugin checks `aider --version` before executing tools.
If unavailable, it returns an actionable message:
- install Python >= 3.11
- run `pip install aider-chat`

## Model/Base URL/API key pass-through

Supported from init options and tool args:
- `model` -> `--model`
- `baseUrl` -> `AIDER_API_BASE` / `OPENAI_API_BASE` / `OPENAI_BASE_URL`
- `apiKey` -> `AIDER_API_KEY` / `OPENAI_API_KEY`

## Plugin config example

```json
{
  "plugins": [
    {
      "name": "aider",
      "version": "0.1.0",
      "description": "aider integration plugin",
      "type": "stdio",
      "command": "node",
      "args": ["./node_modules/@xifan-coder/plugin-aider/dist/main.js"],
      "enabled": true,
      "requireConfirmation": true,
      "permissionLevel": 2,
      "timeout": 120000
    }
  ]
}
```
