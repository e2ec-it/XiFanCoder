# @xifan-coder/plugin-oi

Open Interpreter plugin for XiFanCoder.

## Tool

- `oi_execute`
  - Input: `{ language, code, sandbox, confirm, model?, baseUrl?, apiKey? }`
  - `confirm` is mandatory and must be `true` for every execution.

## Safety

- Enforces explicit per-call confirmation (`confirm=true`), cannot be skipped.
- Supports sandbox mode:
  - `local`
  - `docker` (sets `OI_DOCKER_SANDBOX=1`)

## Availability detection

Before execution, plugin runs `python3 -c "import interpreter; print('ok')"`.
If missing, returns install guidance:
- Python >= 3.11
- `pip install open-interpreter`

## Default disabled recommendation

Set plugin as disabled by default and enable explicitly only when needed:

```json
{
  "plugins": [
    {
      "name": "open-interpreter",
      "version": "0.1.0",
      "description": "Open Interpreter plugin",
      "type": "stdio",
      "command": "node",
      "args": ["./node_modules/@xifan-coder/plugin-oi/dist/main.js"],
      "enabled": false,
      "requireConfirmation": true,
      "permissionLevel": 3,
      "timeout": 90000
    }
  ]
}
```
