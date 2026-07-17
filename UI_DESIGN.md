# Danmaku Anywhere UI 设计语言 v2 —「放映厅」

> 状态：设计契约（CONTRACT）。**P1/P2/P3 已实施完成（2026-07-18）**，见文末实施记录。
> 适用范围：`packages/danmaku-anywhere`（扩展全部 UI 表面）。

---

## 0. 一句话论点

**UI 是放映厅里的玻璃和灯光，光永远来自正在播放的内容。**

能放玻璃的地方（页面内），玻璃是真的——`backdrop-filter` 模糊的是正在播放的视频本身，这是 iOS 液态玻璃做不到的。不能放玻璃的地方（弹窗窗口），我们不模拟透明，而是**画光**：把"放映机的光洒在操作台上"画出来，让玻璃卡片去模糊我们自己画的场景。

---

## 1. 技术边界（先说清楚什么能做、什么不能做）

| 表面 | 圆角 | 真实玻璃（blur 底下内容） | 结论 |
|------|------|--------------------------|------|
| 页面内悬浮面板 / FAB / 菜单 | ✅ 任意 | ✅ **模糊的是正在播放的视频** | 主战场，玻璃拉满 |
| 播放器 OSD（跳过按钮/密度条） | ✅ 任意 | ✅ 同上 | 玻璃拉满，但恒为暗玻璃 |
| Popup 窗口本体 | ❌ 系统仅 ~8px | ❌ 无法透出桌面/网页 | Chrome 平台限制，无解 |
| Popup 内部元素 | ✅ 任意 | ✅ 模糊我们自己画的背景 | 所以"画光"，玻璃照常成立 |
| Dashboard 标签页 | 同 Popup | 同 Popup | 同 Popup |

由此得出**材质三级**：

- **T1 真玻璃（Live Glass）**：物理上盖在视频上的表面。全量玻璃配方。
- **T2 画光（Painted Light）**：不透明窗口。先画放映光场景（`canvas` token），玻璃元素照常 blur。
- **T3 实体降级（Solid Fallback）**：低性能 / `prefers-reduced-transparency`。纯色填充，但保留光边与高光——**identity 靠边缘，不靠模糊**。

---

## 2. 设计原则（5 条法则）

1. **光来自内容**：所有光晕、光边、密度条颜色从当前主题（即用户为内容选的氛围）派生，禁止无来源的颜色。
2. **玻璃必有边**：每个玻璃表面必须有 rim（渐变光边或 1px 亮边）。无边玻璃 = 脏玻璃，禁止。
3. **视频上方恒为暗厅**：盖在视频上的表面（OSD、FAB、面板）永远用暗玻璃，**不随 colorMode 翻转**——放映厅里开灯是事故。colorMode 只影响 Popup/Dashboard。
4. **正文只放在 surface 级以上**：chrome 级（高透）玻璃上只允许短粗文字 + `GLASS_TEXT_SHADOW`；成段文字必须在 surface/overlay 级。
5. **每个效果必有降级**：定义 T1/T2 效果时必须同时定义 T3 等价物，缺降级不合并。

---

## 3. Token 契约

### 3.1 GlassPalette v2（`themes.ts`，在现有 9 个 token 上扩 3 个）

```ts
export interface GlassPalette {
  base: string           // 现有：chrome 透明填充（按钮/FAB/pill）
  hover: string          // 现有：chrome hover
  scrim: string          // 现有：surface 填充（面板/菜单）
  blur: string           // 现有：backdrop-filter 值
  border: string         // 现有：1px 亮边回退
  borderGradient: string // 现有：渐变光边（::before mask）
  specular: string       // 现有：inset 高光组
  depth: string          // 现有：外投影组
  tint: string           // 现有：主题色渐变叠层
  // ---- v2 新增 ----
  overlay: string        // 最重填充（0.78+ 不透明度），Dialog/确认框在视频上必须可读
  glow: string           // 内容光晕（单条 box-shadow 项，主题主色 bloom），FAB 挂载态/高能提示用
  solid: string          // T3 降级填充（全不透明、带主题倾向的实色）
}
```

### 3.2 ThemePalette v2 新增字段

```ts
export interface ThemePalette {
  // ...现有字段不动...
  /** T2 画光场景：popup/dashboard 的画布背景（多层渐变，暗/亮各一套） */
  canvas: { backdrop: string }
  /** 语义状态色（随主题微调色温），杀掉 #4caf50 这类硬编码 */
  status: { success: string; warning: string; error: string; info: string }
}
```

`density` 与 `regions` 保留字段但**换算法**：见 §5.3。

示例（neon-violet 暗色 canvas）：

```
radial-gradient(120% 90% at 18% -10%, rgba(139,92,246,.26), transparent 55%),
radial-gradient(90% 70% at 100% 110%, rgba(217,70,239,.14), transparent 60%),
linear-gradient(180deg, #141b32 0%, #0f172a 55%, #0d1228 100%)
```

外加全局 3% 噪点叠层（SVG feTurbulence data-uri，`mix-blend-mode: overlay`），消除渐变色带。

### 3.3 圆角——只许 4 档

```ts
radius: { s: 10, m: 16, l: 22, pill: 999 }
```

| 档 | 用途 |
|----|------|
| `pill` | FAB、跳过按钮、chip 化按钮、开关 |
| `l` | 面板、卡片、Dialog、popup 悬浮卡 |
| `m` | 列表项、输入框、菜单（= 现 `shape.borderRadius` 16，保持兼容） |
| `s` | chip、badge、小标签 |

现存的 20px（liquidGlass 默认）、999px 散写、8px 散写全部收编到这 4 档。

### 3.4 动效 token

```ts
motion: {
  easeSwift: 'cubic-bezier(0.32, 0.72, 0.16, 1)',  // 主 easing，iOS 手感
  durFast: 120,   // hover/按压反馈
  durBase: 200,   // 展开/收起、菜单
  durSlow: 320,   // 面板开合、场景级
}
```

`prefers-reduced-motion` 下全部退化为 80ms 纯 opacity。

### 3.5 数据字体

- **决策（实施时定稿）**：不捆绑 webfont。内容脚本注入每一个匹配页面，在任意宿主页 base64 内联字体 + `FontFace` 注册代价高、侵入性强，收益有限。改用**精选等宽字体栈** `DATA_FONT`（`ui-monospace, "SF Mono", "Cascadia Code", "JetBrains Mono", Consolas, monospace`）+ `font-variant-numeric: tabular-nums`，零字节、零风险，同样给出对齐的"数据感"。
- 用于**时间戳、计数、badge、集数、provider 标签**等数据位；成段中文正文用系统栈 `UI_FONT`。
- 实现：`tokens.ts` 导出 `DATA_FONT` / `UI_FONT` / `dataFigures`（sx 助手）；`themeVars.ts` 镜像 `--da-font-data` 供播放器层。

### 3.6 CSS 变量（`themeVars.ts` 同步扩展）

新增：`--da-glass-{overlay,glow,solid}`、`--da-canvas-backdrop`、`--da-radius-{s,m,l,pill}`、`--da-status-{success,warning,error,info}`、`--da-motion-{swift,fast,base,slow}`、`--da-font-data`。播放器层（无 React）只消费 CSS 变量。

### 3.7 MUI 映射（`Theme.tsx` 扩展）

现状只覆盖 `MuiPaper`/`MuiButton`。补齐：

| 组件 | 处理 |
|------|------|
| `palette.{success,warning,error,info}` | 接 `status` token |
| `MuiDialog` | overlay 级玻璃 + 渐变 rim + radius.l |
| `MuiMenu` / `MuiTooltip` | surface 级玻璃 + radius.m / radius.s |
| `MuiChip` | radius.s，选中态用主题渐变描边 |
| `MuiTabs` | 指示器改为主题渐变条（竖排 rail 场景为竖条） |
| `MuiSwitch` | 选中 track 用主题渐变 |
| `MuiLinearProgress` | 主题渐变填充 + 轨道玻璃化 |
| `MuiButton` | 增加 `durFast` 按压反馈（scale 0.97） |

---

## 4. 分表面规范

### 4.1 悬浮球 FAB（T1）

- chrome 玻璃 + `pill`，计数用 `DATA_FONT`。
- 状态语言：**空闲** = 素玻璃；**已挂载** = 渐变 rim 点亮 + `glow` 4s 呼吸；**错误** = 红 rim 脉冲（现 `makeErrorPulse` 收编进 token）；**匹配成功** = 对勾闪现（颜色改 `status.success`，杀 `#4caf50`）。

### 4.2 悬浮面板（T1，核心表面）

- surface 玻璃 + 渐变 rim + `radius.l`；toolbar 用 chrome 玻璃压在 surface 上形成"玻璃上的玻璃"层次。
- **开合动效**：从 FAB 生长（transform-origin 指向 FAB 锚点，scale 0.94→1 + fade，`durSlow`）；内容列表项 24ms 级联入场。
- 竖排 tab 改为**图标 rail**（约 56px），激活态 = 图标点亮 + 左侧 3px 主题渐变竖条；12 个 tab 按 常用/管理/高级 分组，组间留白。
- Dialog 在面板内弹出时用 `overlay` 级（视频上必须可读）。

### 4.3 播放器 OSD（T1，无 React，纯 CSS 变量）

统一为 "OSD kit"：`da-osd` 基类 = 暗玻璃 + rim + `GLASS_TEXT_SHADOW`，跳过按钮（两种）、未来的 toast 全部继承。**永远暗玻璃**（法则 3），删除现有 CSS 里的亮色回退分支。

**密度条 v2 ——「光带」**：

- 弃用蓝→黄→红热力图（与主题无关的通用配色），改为**单色系光带**：密度映射到亮度/不透明度，主题主色为基，峰值向 secondary 过渡并 bloom。数据成为氛围的一部分。
- 播放头 = 1px 光针 + 小光晕；已播放段亮、未播段暗（沿用 played/unplayed token，值改为从主题派生）。
- OP/ED 区域：**斜纹填充 + 微标签**区分（不再单靠蓝/粉色相，色盲友好）；填充色从主题派生，`regions` token 保留可覆写。

### 4.4 Popup（T2「画光」）

- 画布 = `canvas.backdrop`（放映光：主色从左上斜洒 + 副色底部微光）+ 3% 噪点。替换现在的纯色 `background.default`。
- 现有悬浮玻璃卡保持结构，rim 升级为 `borderGradient`，圆角统一 `radius.l`。
- 亮色模式 = "白天的放映厅"：亮 canvas（暖白 + 主色微光），玻璃用现有 `lightGlassPalettes`。
- 信息架构（页面组织/导航形态）本次**不动**，设计语言先落地。

### 4.5 Dashboard（T2）

同 Popup 画布铺满全屏，卡片 `max-width` 居中——"展馆里一块发光玻璃"。宽屏下允许双栏。

### 4.6 共享组件规则（`src/common/components`）

- 表格（CommentsTable / x-data-grid）：透明底，行 hover 用 `glass.hover`，表头文字弱化。
- 空态（NothingHere）/ 加载（FullPageSpinner）：加入主题光晕点缀，不再纯灰。
- 图标色（BilibiliIcon `#00aeec` 等品牌色）：**豁免**——品牌色不属于主题体系，但需集中到一个 `brandColors.ts` 常量文件。
- `FancyTypography` 保留为 wordmark/标题渐变字。

---

## 5. 反模式清单（整改项，来源：本次全库审计）

| # | 现状 | 整改 |
|---|------|------|
| 1 | `FloatingButton.tsx` 硬编码 `#4caf50`、drop-shadow | 改 `status.success` + `glow` |
| 2 | `DanmakuDensityChart.ts` 硬编码蓝/黄/红渐变、黑底 tooltip | 密度条 v2 + tooltip 玻璃化（CSS 变量） |
| 3 | `SkipButton.css` / `FixedSkipButton.css` 硬编码 rgba 回退、亮色分支 | 收编 OSD kit，恒暗玻璃 |
| 4 | `ThemePreviewCards.tsx` `#fff` | token 化 |
| 5 | 圆角三套并存（16/20/999 散写） | 统一 4 档 radius token |
| 6 | 文字阴影三处各写各的 | 统一 `GLASS_TEXT_SHADOW`（liquidGlass.ts 已有，用起来） |
| 7 | Stats 图表颜色硬编码 | 从主题渐变采样 |
| 8 | `UpscaleControls.tsx` `borderRadius: 1` + 平淡 Paper | radius.m + surface 玻璃 |
| 9 | 新代码写 hex/rgba | **禁止**；review 时 grep 把关，仅 `themes.ts`/`brandColors.ts` 豁免 |

---

## 6. 性能与可访问性

- **blur 预算**：同屏 backdrop-filter 表面 ≤ 3 个（面板+FAB+一个 OSD）；面板打开时可暂停密度条动画。
- **降级开关**：设置页加"减少透明效果"（跟随 `prefers-reduced-transparency` 默认值）→ 全线切 `glass.solid`，保留 rim/specular。
- **reduced-motion**：全动效退化 80ms opacity。
- **对比度**：overlay 级玻璃上的正文需过 WCAG AA（4.5:1）；chrome 级只放粗短文字。
- 主题切换沿用 `useViewTransition`（View Transitions API），做十字溶解即可，不做花哨揭示。

---

## 7. 实施计划（团队分工，文件互斥）

| 阶段 | 内容 | 文件范围 | 并行 |
|------|------|----------|------|
| **P1 地基** | Token v2 + MUI 映射 + 字体 + CSS 变量 + `canvas` 画光 | `src/common/theme/**`、`assets/fonts/**` | 单 agent（根基不并行） |
| **P2 表面扫荡** | 消灭硬编码，全表面接 token | A: `content/controller/ui/**`；B: `content/player/components/** + densityPlot/**`；C: `popup/**`；D: `common/components/**` | 4 agents 并行，范围互斥 |
| **P3 签名时刻** | 面板开合动效、级联入场、FAB 状态语言、密度条 v2、光带 bloom | 跨 P2 范围的精修，串行 | 单 agent |
| **验证** | standalone + Playwright 截图（popup 500×600 / 面板压视频测试页）、vitest、biome、grep 硬编码色清零 | — | 每阶段末 |

基线注意：分支既有 6 个测试失败与 i18n 类型噪音（见 memory），验证以**新增错误为零**为准。

**实施记录（2026-07-18，三阶段全部完成）**：
- **P1**：新增 `theme/tokens.ts`（RADIUS 4 档、MOTION、DATA_FONT/UI_FONT/dataFigures）。字体决策改口——不捆绑 webfont，用等宽栈 + tabular-nums（见 §3.5）。themes.ts 扩 glass.overlay/glow/solid + canvas.backdrop + status；liquidGlass.ts 支持 overlay 变体 + radius token 键 + reduced-transparency/motion 自动降级；themeVars.ts 镜像全部新 CSS 变量；Theme.tsx 补齐 Dialog/Menu/Tooltip/Chip/Tabs/LinearProgress + status 映射。
- **P2**：4 agent 并行接 token，tsc 错误签名 diff 全空（零净增）。修了 agent 引入的密度条 bug（`dimColor` 正则只吃 rgba，但 --da-primary 是 hex，导致光带塌平）+ 补 OP/ED 斜纹 pattern。
- **P3**：面板开合改 MUI `Grow`（transform-origin bottom-left，尊重 reduced-motion）；FAB 挂载态 4s 呼吸 glow + 错误脉冲改 hex+8 位 alpha 后缀（原 `.replace` 只吃 rgba，对 hex 失效）；高能卡片 riseIn 级联（前 8 张各延 40ms）。`theme/animations.ts` 中途建过共享 keyframe 库，最终无引用已删。

---

## 8. 概念稿

`../ui-design-preview/screening-room.html`（含 T1 视频场景 + T2 popup 场景的静态概念稿与截图，仓库外，不入库）。
