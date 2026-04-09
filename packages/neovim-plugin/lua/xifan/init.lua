local M = {}

M.opts = {
  cmd = "xifan",
  args = { "--print" },
  open_style = "split",
  split_command = "botright 12new",
}

M.last_output = nil
M._commands_registered = false

local function merge_opts(opts)
  if not opts then
    return
  end
  M.opts = vim.tbl_deep_extend("force", M.opts, opts)
end

local function create_scratch_buffer(lines, title)
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_set_option_value("bufhidden", "wipe", { buf = buf })
  vim.api.nvim_set_option_value("filetype", "markdown", { buf = buf })
  vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
  if title and title ~= "" then
    vim.api.nvim_buf_set_name(buf, title)
  end
  return buf
end

local function show_output(content)
  local lines = vim.split(content, "\n", { plain = true })
  if #lines == 0 then
    lines = { "(empty response)" }
  end
  if M.opts.open_style == "float" then
    local buf = create_scratch_buffer(lines, "XiFan Output")
    local width = math.max(60, math.floor(vim.o.columns * 0.7))
    local height = math.max(12, math.floor(vim.o.lines * 0.6))
    vim.api.nvim_open_win(buf, true, {
      relative = "editor",
      width = width,
      height = height,
      row = math.floor((vim.o.lines - height) / 2),
      col = math.floor((vim.o.columns - width) / 2),
      style = "minimal",
      border = "rounded",
      title = " XiFan ",
      title_pos = "center",
    })
    return
  end

  vim.cmd(M.opts.split_command)
  local buf = create_scratch_buffer(lines, "XiFan Output")
  vim.api.nvim_win_set_buf(0, buf)
end

function M.ask(prompt)
  local message = prompt
  if not message or message == "" then
    message = vim.fn.input("XiFan> ")
  end
  if not message or message == "" then
    return
  end

  local cmd = { M.opts.cmd }
  for _, arg in ipairs(M.opts.args) do
    table.insert(cmd, arg)
  end
  table.insert(cmd, message)

  vim.notify("XiFan request running...", vim.log.levels.INFO)

  vim.system(cmd, { text = true }, function(result)
    vim.schedule(function()
      if result.code ~= 0 then
        local err = (result.stderr and result.stderr ~= "") and result.stderr or ("exit code " .. tostring(result.code))
        vim.notify("XiFan request failed: " .. err, vim.log.levels.ERROR)
        return
      end

      local output = (result.stdout and result.stdout ~= "") and result.stdout or "(empty response)"
      M.last_output = output
      show_output(output)
    end)
  end)
end

function M.show_last()
  if not M.last_output then
    vim.notify("No XiFan output yet. Run :XiFanAsk first.", vim.log.levels.WARN)
    return
  end
  show_output(M.last_output)
end

function M.register_commands()
  if M._commands_registered then
    return
  end

  vim.api.nvim_create_user_command("XiFanAsk", function(params)
    local input = params.args
    if input == "" then
      input = nil
    end
    M.ask(input)
  end, {
    nargs = "*",
    desc = "Ask XiFan CLI and show output inside Neovim",
  })

  vim.api.nvim_create_user_command("XiFanLast", function()
    M.show_last()
  end, {
    nargs = 0,
    desc = "Show last XiFan output",
  })

  M._commands_registered = true
end

function M.setup(opts)
  merge_opts(opts)
  M.register_commands()
end

return M

