<div align="center">
  <img width="128" height="128" src="./assets/logo.png">
  <h1>
    弹幕任何地方
  </h1>
  <p><em>Danmaku Anywhere · 增强版</em></p>
  <p align="center">
    <a href="https://github.com/2832599985/danmaku-anywhere-perf/releases">
      <img alt="GitHub Release" src="https://img.shields.io/github/v/release/2832599985/danmaku-anywhere-perf?include_prereleases&style=flat-square&logo=github">
    </a>
    <a href="https://github.com/Mr-Quin/danmaku-anywhere">
      <img alt="Upstream" src="https://img.shields.io/badge/%E4%B8%8A%E6%B8%B8-Mr--Quin%2Fdanmaku--anywhere-blue?style=flat-square&logo=github">
    </a>
    <img alt="License" src="https://img.shields.io/badge/License-AGPL--3.0-green?style=flat-square">
  </p>
</div>

> 没有弹幕怎么看番？
> **弹幕任何地方**是一个开源项目，旨在为你喜爱的几乎任何视频网站添加弹幕。

本仓库是 [Mr-Quin/danmaku-anywhere](https://github.com/Mr-Quin/danmaku-anywhere) 的增强 fork。在上游 v1.5.0 的基础上，它重制了整套界面，加入了 Anime4K 超分辨率、自动跳过片头、高能时刻等大量新功能，并做了系统的性能优化。上游更新会持续合并进来。

## 目录

- [增强版特性](#fork-features)
- [下载安装](#installation)
- [快速开始](#quick-start)
- [基础功能](#extension)
- [Web 应用](#app)
- [参与开发](#contributing)
- [致谢](#credits)
- [许可证](#license)

<a id="fork-features"></a>

## ✨ 增强版特性

以下功能均为本 fork 新增，上游没有。

### 🎨 液态玻璃界面

- 以 iOS 26 风格的液态玻璃质感重制扩展全部界面
- 四套配色主题：**霓虹紫、琥珀焰、深海蓝、樱花黑**，卡片式预览选择，切换时有圆形展开过渡动画
- 深浅色模式跟随系统，也可手动切换

### 🖼️ Anime4K 视频超分辨率

- 基于 WebGPU 的实时超分，低清片源也能有高清观感，弹幕始终显示在超分画面之上
- 六种模式（A / B / C / A+A / B+B / C+A）搭配四档性能（快速 / 均衡 / 画质 / 极致），按设备性能自由取舍
- 悬浮面板一键开关，参数修改立即应用到当前视频
- 需要浏览器支持 WebGPU；跨域视频可启用可选的「跨域修复」规则

### ⏭️ 播放辅助

- **自动跳过片头（OP）**：分析弹幕时间轴，自动识别并跳过 OP
- **固定时间跳过按钮**：一键跳过指定秒数（默认 90 秒，可自定义）
- 快捷键增强：调节播放速度、弹幕偏移、切换密度条，调整时实时提示当前值
- 快捷键速查表：按住 `?` 即可弹出，按功能分组展示

### 📊 弹幕体验

- **高能时刻**：根据弹幕密度峰值自动定位剧集高能点，点击跳转，支持复制分享
- **交互式密度热力图**：悬停查看弹幕量、点击跳转、标注 OP/ED 区域，附播放进度指示线
- **自动偏移校准**：检测弹幕与视频的时间错位并自动修正，手动微调仍然保留
- **多源弹幕合并**：合并所有已启用弹幕源的弹幕并智能去重
- 文字描边 / 阴影样式，五种预设（默认 / 细描边 / 粗描边 / 发光 / 3D 阴影），实时预览
- 样式方案一键切换：极简 / 均衡 / 沉浸 / 护眼
- 弹幕源标签着色、按来源筛选、自适应密度限流、颜色黑名单过滤

### 📈 统计面板

- 弹幕库总览：类型分布饼图、密度时间线、Top 10 关键词

### 📥 下载与管理

- 番剧详情页**批量选择下载**整季弹幕
- 新增 **ASS 格式导出**（原有 XML 之外）
- 下一集弹幕自动预加载，换集零等待
- 挂载配置支持 JSON 导入导出，内置 14 个常见站点模板

### 🔌 弹幕源增强

- **MacCMS 完整支持**：标题映射持久化，配合 AI / XPath 实现自动匹配
- 弹弹play 弹幕智能去重，消除合并来源产生的重复弹幕
- **按站点路由弹幕源**：为不同网站指定优先使用的弹幕源

### ⚡ 性能与细节

- 弹幕装填与解析大幅提速（附基准测试套件）
- 下载、导入、挂载全程不再卡顿 UI
- 悬浮球状态可视化：加载呼吸光晕、弹幕计数角标、匹配成功动画、连接异常提示
- 悬浮面板可拖拽调整大小，导航标签按功能分组

### 🚧 开发中

以下功能后端与服务层已就绪，前端仍在接线，当前版本暂不可用：

- 社区弹幕（共享弹幕池）
- 一起看（同步观影房间）
- 弹幕翻译（英 / 日 / 中 / 韩）
- 媒体服务器深度集成（Jellyfin / Emby / Plex 元数据自动识别）

<a id="installation"></a>

## 📥 下载安装

增强版不上架应用商店，请从 [GitHub Releases](https://github.com/2832599985/danmaku-anywhere-perf/releases) 下载最新版本：

1. 下载 Release 附件中的 `danmaku-anywhere.zip` 并解压
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`），开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择解压后的文件夹

Android 端可在 Kiwi / Lemur 等支持扩展的浏览器中直接加载 zip。

> 只想要官方商店版（无增强功能）？请安装上游的 [Chrome 商店版](https://chromewebstore.google.com/detail/danmaku-anywhere/jnflbkkmffognjjhibkjnomjedogmdpo?hl=zh) 或 [Firefox 版](https://addons.mozilla.org/zh-CN/firefox/addon/danmaku-anywhere/)。

<a id="quick-start"></a>

## ⚡ 快速开始

1. 安装扩展（见上文）。
2. 打开视频网站（如 Plex）。
3. 右键网站空白处，选择「为当前网站添加配置」。
4. 点击网站左下角的扩展图标，让它自动匹配或搜索弹幕。

更多用法请参阅上游的 [说明文档](https://docs.danmaku.weeblify.app/getting-started/)。

<a id="extension"></a>

## 🚀 基础功能

以下为与上游一致的核心能力：

- **在几乎任何网站观看弹幕**：
  - 自托管的媒体服务器（如 Plex、Emby、Jellyfin、飞牛影视）
  - 流媒体平台（如 YouTube、Crunchyroll）
  - 其他视频网站
- **纯浏览器体验**：无需任何桌面客户端
- **从多个弹幕源获取弹幕**，目前支持：
  - 弹弹play
  - B 站
  - 腾讯
  - MacCMS (Vod)
  - 兼容弹弹play API 的服务，如 [danmu-api](https://github.com/huangxd-/danmu_api)
- **手动导入**：支持手动导入本地弹幕文件（`.xml` 格式）
- **自动匹配**：可自定义匹配规则，或使用 AI 匹配功能
- **弹幕导出**：将看过的弹幕导出为 `.xml` 或 `.ass` 文件

### 效果截图

<video src="https://github.com/user-attachments/assets/c5df8221-4381-4d58-9f88-3ca73a1431bb"></video>

<details>
<summary>点击展开截图</summary>

**Plex**

![Plex](./assets/screenshot_plex.png)

**Jellyfin**

![Jellyfin](./assets/screenshot_jellyfin.png)

**YouTube**

![YouTube](./assets/screenshot_youtube.png)

</details>

<a id="app"></a>

## 🧩 Web 应用

> [https://danmaku.weeblify.app/](https://danmaku.weeblify.app/)

这是一个**实验性项目**，旨在在浏览器中提供类似 Kazumi 的功能。**需要安装*弹幕任何地方*扩展后才可使用**。

- 基于 Kazumi 规则，在一个网站上观看来自不同网站的视频
- 播放本地视频
- 支持 PWA

<a id="contributing"></a>

## 🧑‍💻 参与开发

欢迎任何形式的贡献！包括但不限于代码、美术资源、文档。

开发环境与项目结构请查阅上游的 [开发文档](https://docs.danmaku.weeblify.app/development/structure/)。

<a id="credits"></a>

## ❤️ 致谢

- [Mr-Quin/danmaku-anywhere](https://github.com/Mr-Quin/danmaku-anywhere) —— 本项目的上游，所有基础能力都来自它
- [Anime4K](https://github.com/bloc97/Anime4K) —— 超分辨率算法
- 美术资源：吳都行、猫与白月（[B 站](https://space.bilibili.com/220694183)）

<a id="license"></a>

## 📝 许可证

本项目的每个包都有自己的许可证。基本上，除了 **danmaku-anywhere** 扩展为 AGPL，其他包都是 MIT 许可证。

详情请查看 [许可证](LICENSE)。
