# Agent Operating Rules

## Windows 控制台初始化（重要）

如当前系统为 Windows，请在进行其他操作前执行：

```powershell
[Console]::InputEncoding  = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
chcp 65001 > $null
```

## 代理（可选）

如网络环境需要代理，可在当前 PowerShell 会话设置：

```powershell
$env:HTTP_PROXY  = "http://127.0.0.1:10808"
$env:HTTPS_PROXY = "http://127.0.0.1:10808"
$env:ALL_PROXY   = "http://127.0.0.1:10808"
```

## 安装与构建（Windows）

仓库根目录：`d:\_Code\Html Css Javascript\danmaku-anywhere\danmaku-anywhere`

```powershell
corepack enable
corepack prepare pnpm@10.11.0 --activate
corepack pnpm -r --filter @mr-quin/danmaku-anywhere... install
corepack pnpm -r --filter @mr-quin/danmaku-anywhere... build
```

## 测试（packages/danmaku-anywhere）

```powershell
corepack pnpm -C packages/danmaku-anywhere test run
```

必须带 `run`：该包的 `test` 脚本是裸 `vitest`，省略会进入 watch 模式并挂住非交互会话。

## 打包扩展（Chrome/Edge）

构建后执行：

```powershell
corepack pnpm -C packages/danmaku-anywhere package
```

产物在：`packages/danmaku-anywhere/package/`

