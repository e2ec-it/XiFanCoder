# xifan.nvim (Prototype)

Minimal Neovim integration for XiFanCoder CLI.

## Features

1. `:XiFanAsk [prompt]` sends a prompt to `xifan --print` and renders output inside Neovim.
2. `:XiFanLast` reopens the previous XiFan output.
3. Supports split or floating window output.

## Install (lazy.nvim)

```lua
{
  dir = "/ABSOLUTE/PATH/TO/XiFanCoder/packages/neovim-plugin",
  config = function()
    require("xifan").setup({
      cmd = "xifan",
      args = { "--print" },
      open_style = "split",
      split_command = "botright 12new",
    })
  end,
}
```

## Commands

1. `:XiFanAsk` asks for input interactively.
2. `:XiFanAsk create a hello.ts file` sends direct prompt.
3. `:XiFanLast` shows previous output.

