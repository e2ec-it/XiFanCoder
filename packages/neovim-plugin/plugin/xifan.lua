if vim.fn.has("nvim-0.10") == 0 then
  vim.notify("xifan.nvim requires Neovim >= 0.10 (vim.system is required).", vim.log.levels.WARN)
  return
end

local ok, xifan = pcall(require, "xifan")
if not ok then
  vim.notify("xifan.nvim failed to load module: " .. tostring(xifan), vim.log.levels.ERROR)
  return
end

xifan.setup()

