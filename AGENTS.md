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

## 打包扩展（Windows）

本仓库的 `pnpm -C packages/danmaku-anywhere package` 依赖 `zip` 命令；在 Windows 上可能不存在。

优先用系统自带 `tar.exe` 直接生成 zip（不依赖额外安装）：

```powershell
cd "d:\_Code\Html Css Javascript\danmaku-anywhere\danmaku-anywhere\packages\danmaku-anywhere"
$version = (Get-Content .\package.json -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Force .\package | Out-Null
tar.exe -a -c -f (".\\package\\danmaku-anywhere-$version-chrome.zip") -C .\build .
```

