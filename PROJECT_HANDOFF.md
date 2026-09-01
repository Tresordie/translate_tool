# PROJECT_HANDOFF — LinguaFlow

> 本文档面向接手本项目的 AI 模型 / 开发者，记录项目当前状态、架构、关键决策与待办事项，避免重复踩坑。
>
> **当前版本**：v0.23.1 · 2026-09-01
> **仓库**：GitHub `Tresordie/translate_tool` · Gitee `simonyuan2019/translate_tool`（双远端推送，`origin` 同时配置 fetch GitHub + push 两个）

---

## 1. 项目简介

LinguaFlow 是一个基于大模型 API（OpenAI 兼容 `/chat/completions` 接口）的 AI 翻译 + 效率工具集，包含两个形态：

- **网页版** `index.html` — 8 个 Tab：智能翻译 / 工作报告 / 任务清单 / 英语学习 / 邮件总结 / AI 解析 / AI 提示词 / 热点雷达
- **Chrome 扩展** `chrome_extension/` — Popup 翻译弹窗 + Side Panel 侧边栏（同 8 个模块）+ 划词翻译 + 右键菜单

所有页面共用：
- `theme.css` / `theme.js` — 6 款极简高级感主题（低饱和苹果风）+ 玻璃拟态/噪点质感
- `ai-service.js`（网页版根目录 & `chrome_extension/ai-service.js`）— AI 配置读写 + chat 调用 + 任务抽取 + 提示词生成

## 2. 当前功能矩阵

| 模块 | 网页 | 扩展 Popup | 扩展 Side Panel |
|------|------|-----------|-----------------|
| 智能翻译 | ✅ 主 Tab | ✅ 默认页 | ✅ Tab 1 |
| 工作报告 | ✅ iframe | ✅ 新标签页按钮 | ✅ Tab 2 |
| 任务清单 | ✅ iframe | ✅ 新标签页按钮 | ✅ Tab 3 |
| 英语学习 | ✅ iframe | ✅ 新标签页按钮 | ✅ Tab 4 |
| 邮件总结 | ✅ iframe | ✅ 信封图标按钮 | ✅ Tab 5 |
| AI 解析 | ✅ iframe | ✅ 新标签页按钮 | ✅ Tab 6 |
| AI 提示词 | ✅ iframe | ✅ 新标签页按钮 | ✅ Tab 7 |
| 热点雷达 | ✅ iframe | ✅ 新标签页按钮 | ✅ Tab 8 |

## 3. 关键架构决策

### 3.1 iframe 子页面复用
网页版的「工作报告 / 任务清单 / 英语学习 / 邮件总结 / AI 解析 / AI 提示词」全部通过 iframe 嵌入独立 HTML 页面（`workreport.html` / `todolist.html` / `english_learning.html` / `email_summary.html` / `ai_parse.html` / `ai_prompts.html`）。Chrome 扩展的 Side Panel 同样用 iframe 复用这些页面（`chrome_extension/` 下各有一份副本）。

**好处**：一套代码两端用；**代价**：主题/配置同步要靠 `postMessage` + `localStorage` 双通道。

### 3.2 配置权威源（重要 ⚠️）
**Chrome 扩展是配置的权威源**。插件保存的配置会通过 `chrome.storage.local` + `postMessage` 实时推送到所有已打开的工具页。页面内手工保存的配置会被插件同步覆盖。

实现位置：`ai-service.js` 的 `initConfigSync()`。v0.18.0 修复：`initConfigSync` 现在同步写入 `localStorage('translate_config')`，确保 `chat()` 读到的永远是最新配置（之前只更新内存变量，AI 解析/提示词页面无法立即生效）。

### 3.3 主题同步
- 网页版各 iframe 通过 `postMessage({type: 'theme-change', theme})` 从父页接收主题
- 扩展的 Side Panel 通过 `chrome.storage.local` + `postMessage` 同步到各 iframe
- `theme.js` 在 sidepanel.html 内会**跳过**自己的 FAB 注入逻辑（避免与侧边栏自带主题按钮冲突）— 这是 v0.16.1 修复

### 3.4 主题系统架构（v0.19.x 全新重做，v0.20.0 增补）
`theme.css` / `theme.js` 由「12 款 Catppuccin」重做为 **6 款极简高级感主题（低饱和苹果风）**：
- **浅色 3 款**：纸感白 `lf-paper` / 雾霭 `lf-mist` / 奶油 `lf-cream`；**深色 3 款**：石墨 `lf-graphite`（默认）/ 板岩 `lf-slate` / **夜曲 `lf-midnight`（v0.20.0 重设计：深海靛背景 × 电子蓝 #6E7BFF 主色，替代原暖调紫罗兰）**
- 每款主题在 `html[data-theme]` 块内**自洽定义全部变量**（81 个），不再依赖旧版全局深色/浅色覆盖
- **明暗分组改为 `html[data-mode="light|dark"]`**：`theme.js` 的 `applyTheme()` 在设置主题同时设置 `data-mode`；页面/质感层选择器统一按 `data-mode` 分组，替代旧版 `html[data-theme^="cat-latte"]` 前缀判断 → 未来新增主题无需再改选择器
- **旧主题自动迁移**：`getSavedTheme()` 内置 12 个 `cat-*` → 新主题映射，老用户保存的主题自动落到同明暗的新主题
- ⚠️ **改动主题时注意**：`theme.css` / `theme.js` 根目录与 `chrome_extension/` 下各有一份副本（`theme.css` 完全相同、`theme.js` 仅 side panel 注释差异），必须同步修改

### 3.5 Side Panel 现代极简 UI（v0.18.0）
`sidepanel.css` 完全重写：
- 浅灰白背景 `#F8F9FA` / 深色 `#121212` / 主色 `#4F46E5`
- 12px 圆角卡片 + 微阴影 + 1px 极细边框
- 顶部栏 `backdrop-filter: blur(12px)` 毛玻璃
- 系统无衬线字体（移除了 Google Fonts 依赖）
- 暗色模式通过 `html[data-mode="dark"]` 自动适配

### 3.6 品牌命名：UI 文案 vs 代码标识（重要 ⚠️）
产品**界面可见标题已统一改为 `AI Tool Box`**（index.html 主标题/footer、扩展 Popup、Side Panel、fullpage、各子页面 `<title>`/footer、`manifest.json` name、`_locales` appName、右键菜单、划词翻译浮窗 brand）。

但以下**代码标识符仍保留 `LinguaFlow`，不可改名**（改了会破坏用户已有数据或跨页面契约）：
- `localStorage` 键 `linguaflow_theme`（主题持久化）
- `window.LinguaFlowTheme`（theme.js 对外 API，被各页面调用）
- DOM id / class：`#linguaflow-tooltip`、`.lf-*`（划词翻译浮窗）
- `todolist.js` 中 iCalendar `PRODID:-//LinguaFlow//TodoList//EN`

主标题字体为 **Sora**（Google Fonts，与 Syne/Jakarta/Inter 一并异步加载）；Side Panel 因 v0.18.0 起刻意移除 Google Fonts 依赖，改用系统级字体栈。

### 3.7 AI 服务层（`ai-service.js`）
507 行（网页版）/ 524 行（扩展版），IIFE 封装暴露 `window.AiService`：
- `initConfigSync()` — 配置读写 + 监听插件广播
- `chat({messages, options})` — OpenAI 兼容 chat/completions（reasoning 模型自动省略 temperature）
- `parseNotes(text, mode)` — AI 解析：经典模式（任务抽取）
- `analyzeContent(text, opts)` — AI 解析：分析模式（结构化总结，含邮件 playbook）
- `generatePrompt(text)` — AI 提示词生成
- `extractPromptBody(fullText)` — 从 AI 输出中提取纯提示词正文
- `writeTodoItems(items)` — 把 AI 解析出的任务写入待办（`todo_items` + chrome.storage 双通道）

### 3.8 页面 UI 精修层架构（v0.20.0，⚠️ v0.21.0 已被单一连贯样式层取代）

> **v0.21.0 变更**：todolist（两份）/ english_learning（两份）的「基础层 + UI 精修层 v1/v2 覆盖块」架构已废弃——三个页面的 `<style>` 全部重写为**单一连贯样式层**（变量直接取自 theme.css 全局主题变量），sidepanel.css 同样重写为单层（`--sp-*` 全量映射主题变量）。**修改这些页面样式时直接改 `<style>` 内对应规则即可，不再存在覆盖层级问题。** 以下 v0.20.0 记录仅作历史参考。

v0.20.0 对 workreport / todolist / english_learning / sidepanel 的视觉重构采用**「追加覆盖层」**方式实现：在各页面 `<style>` 末尾（或 sidepanel.css 末尾）追加了标记为 **`UI 精修层（v0.19.9）`** 与 **`UI 精修层 v2`** 的覆盖样式块。

- **workreport**（两份）：精修层把 `btn-save/btn-record` 等从绿色硬渐变改为 `--btn-gradient`，`.header h1` 用 `--header-gradient` 渐变文字，lang-bar/summary-section 主色底
- **todolist**（两份）：v1 层改配色/hover/任务项卡片化；v2 层加双层阴影、进度环发光+渐变百分比、空状态渐变 emoji、滚动条主题化，并新增 `@media (max-width: 900px/480px)` 响应式（窄容器侧栏折行——Side Panel 适配的关键）
- **english_learning**（两份）：v1 层把 `--el-accent*` / `--el-gradient-accent` 从橙黄映射到主题主色；v2 层把 `--el-bg/surface/text/border` 全部桥接到全局主题变量，`--el-gradient-header` 改为主色光晕带，`.el-header-title` 改 28px 渐变文字（替代 36px 白字深色横幅）
- **sidepanel.css**：v1 层映射 `--sp-primary` 到全局主题、header 渐变细线/渐变 logo；v2 层修复 tab 溢出（`sp-tab` 恢复竖排——7 个 tab 横排在 ~350px 边栏会溢出）+ active 渐变胶囊 + header 氛围光

⚠️ **修改这些页面样式时的规则（v0.21.0 起）**：
1. todolist / english_learning / sidepanel 已是单一连贯样式层，直接改对应规则即可；workreport 仍保留 v0.20 覆盖层结构（改覆盖层优先）
2. 页面引用了大量全局主题变量（`--primary`/`--btn-gradient`/`--header-gradient` 等），配色调整优先改 `theme.css` 主题块
3. 根目录与 `chrome_extension/` 的页面副本必须同步修改：todolist 保留 3 处 CSP 差异（扩展版 Google Fonts 异步 + 2 处无 inline onclick），english_learning 保留 2 处差异（扩展版字体异步 + 外部 JS 引用，根目录为内联 JS）
4. english_learning 根目录版的内联 JS = `chrome_extension/english_learning.js` 内容逐字一致（v0.21.0 消除分叉），改动任一侧需同步另一侧

### 3.9 热点雷达两段式检索（v0.22.0，数据源 v0.22.1 重建）
`hotnews.html/js`（两份副本，JS 逐字一致、HTML 仅字体加载差异）：
- **数据源回退链（v0.22.1，原 vvhan 接口已失效）**：
  1. **60s 分板块热榜** `https://60s.viki.moe/v2/{weibo|zhihu|douyin|toutiao|ithome|36kr}` —— CORS 开放，网页/扩展均可直连，含热度值与链接；⚠️ 官方限速严格（并行请求会 429），已实现串行 + 250ms 间隔 + 429 退避重试，仅取 6 板块
  2. **UApi 热榜** `https://uapis.cn/api/v1/misc/hotboard?type={weibo|zhihu|baidu|douyin|bilibili|toutiao|ithome|36kr|sspai|qq-news}` —— 无 CORS 头：扩展内 host_permissions 免跨域直连；网页版经公共 CORS 代理回退（codetabs / allorigins / r.jina.ai / allorigins-get，不同网络可用性不同）
  3. **60s 日报** `https://60s.viki.moe/v2/60s` —— CORS 开放稳定可用，真实每日新闻（无热度/链接）
  - 任一源拿到 ≥20 条候选池即返回（`parse60sBoard`/`parseJsonLoose` 均为防御性解析）；全部失败才显示错误态，控制台按源分级输出失败原因。更换/追加数据源只需增改 `hotnews.js` 的源 runner 数组。
- **AI 归类**：候选池（每板块前 12 条）+ 卡片提示词 → `AiService.chat()`，严格筛选（宁缺毋滥，不足 10 条返回实际数量，每条附 reason）+ `extractJsonItems()` 容错解析（AI 异常自动重试一次）。配置复用 ai-service.js 同步机制；页面自带「大模型接口」配置子区（经 `AiService.saveConfig` 双写 localStorage translate_config 与 chrome.storage config，v0.23.0 起网页保存还会经 content.js 中继写 chrome.storage 实现全端双向同步），未配置时自动展开，保存后自动重试失败卡片。
- **跨域代理桥（v0.23.0/v0.23.1）**：`AiService.proxyFetch()` —— 扩展页面直连；网页直连失败时经 postMessage → content.js → background（host_permissions 免跨域）转发。⚠️ **桥消息必须发往 `window.top`**（content script 默认不注入 iframe，manifest 未开 all_frames），content.js 回包用 **e.source**（发起帧）——嵌在 index.html 里的 iframe 页面（热点雷达等）依赖此路由。chat / 热点雷达模型列表 / UApi 热榜（「UApi桥接」通道）均已接入。
- **存储键**：`hn_cards`（扩展 chrome.storage.local / 网页 localStorage，含 id/name/prompt/items/updatedAt）；跨页同步监听同 todolist 模式。

## 4. 版本与分支历史

| 版本 | 关键改动 |
|------|---------|
| v0.23.1 | 修复 iframe 内页面代理桥不可用：桥消息改发 window.top（content script 默认仅注入顶层），content.js 以 e.source 精准回包；端到端验证通过 |
| v0.23.0 | 配置全端双向同步（网页保存经 content script 中继写 chrome.storage）+ 网页版跨域代理桥（无 CORS 端点经扩展 background 代理，Token Plan 网页版可用）+ 热点雷达设置卡合并 + 热点相关性强化（宁缺毋滥 + reason 字段） |
| v0.22.3 | 热点雷达适配阿里云 Token Plan 等专有网关：「获取模型列表」自动补全（/models）+ 分场景错误引导；确认 Token Plan 无 CORS 头（网页版不可直连，仅扩展可用），模型 ID 需用网关专属名（qwen3.6-flash 等） |
| v0.22.2 | 热点雷达内置 API 配置区（独立打开可用，AiService.saveConfig 双写 translate_config/chrome.storage 全页互通；未配置自动展开 + 保存后自动重试失败卡片） |
| v0.22.1 | 修复网页版热榜抓取失败（vvhan 失效）：数据源重建为回退链（60s 分板块热榜 CORS 直连 → UApi 直连/代理 → 60s 日报兜底） |
| v0.22.0 | 新增「热点雷达」模块：卡片式全网热点 Top 10（热榜聚合真实数据 + AI 按提示词筛选归类），网页 Tab 8 / Side Panel Tab 8 / Popup 入口 |
| v0.21.0 | todolist Dashboard 重设计 + english_learning 重设计（两份副本 CSS 统一 + JS 分叉消除 + 玻璃立体感补齐）+ 容器宽度统一 1400px + sidepanel.css 单层重写（令牌全量映射主题）+ README_EN 同步至 v0.21.0 |
| v0.20.0 | 品牌升级为 AI Tool Box + Sora 字体 + Midnight 夜曲重设计 + workreport/todolist/english_learning/sidepanel 视觉重构 |
| v0.19.8 | 划词浮窗与右键菜单细节修复 |
| v0.19.7 | 英语学习输入区边框/拉伸修复 |
| v0.19.5 | 英语学习宽度统一与暗色边缘修复 |
| v0.19.0–0.19.4 | 6 款极简主题体系落地（`lf-*` + data-mode 明暗分组） |
| v0.18.0 | Side Panel 现代极简重设计 + 配置同步修复 |
| v0.17.0 | 新增 AI 解析 / AI 提示词，集成 TaskFlow 功能 |
| v0.16.1 | 修复侧边栏无法设置主题（theme.js 放开 sidepanel 排除） |
| v0.16.0 | 新增 Chrome Side Panel（Manifest V3，`minimum_chrome_version: 114`） |
| v0.15.0 | 全站 Premium UI 重构（深邃分层暗黑背景 / 玻璃拟态升级 / Syne+Jakarta 字体） + 暗色去眩光 |
| v0.14.0 | Catppuccin 12 主题重建 |
| v0.13.0 | 六主题色彩世界重建 + 生产 hardening + 质感 polish |
| v0.12.0 | 邮件总结模块 + PDF 解析 + 超长内容自动截取 |
| v0.11.0 | 多主题系统 + 视觉重塑 |
| v0.10.0 | 任务清单 Markdown + Apple 提醒事项导入 |
| v0.9.0  | 英语学习助手 |
| v0.8.0  | 工作报告 + 任务清单 + IIFE 模块化封装 |
| v0.1–0.7 | 基础翻译、Chrome 扩展、划词翻译、全屏模式 |

> ⚠️ `agent/mika/*` 分支是 agent 工作分支，**不要直接在上面长期开发**。每个任务会产生新分支，功能稳定后合并到 `master`。

## 5. 开发须知

### 5.1 测试扩展
1. `chrome://extensions/` → 开启开发者模式
2. 「加载已解压的扩展程序」→ 选 `chrome_extension/` 目录
3. 修改代码后在扩展卡片点「重新加载」
4. 本地文件（`file://`）方式打开的页面需要在扩展管理页勾选「允许访问文件网址」

### 5.2 修改清单（常见坑）
- **改了主题/配置同步** → 必须同时验证：弹窗、全屏页、侧边栏、各 iframe 子页面（含 AI 解析 / AI 提示词）
- **改了 `ai-service.js`** → 网页版和 `chrome_extension/` 下的是两份独立副本，**必须同步修改**
- **改了 iframe 子页面** → 网页版和扩展版各自有一份，注意同步
- **Google Fonts** → 侧边栏已移除依赖；网页版仍加载，但用了 `preconnect` 非阻塞
- **MV3 CSP** → Chrome 扩展不允许内联 `<script>`，所有 JS 必须外部文件（`english_learning.js` 就是这么来的）
- **manifest.json 权限** → `sidePanel` 权限 + `minimum_chrome_version: 114` 必须同时存在

### 5.3 测试脚本
```bash
# 语法检查所有根目录 JS
for f in *.js; do node --check "$f" || echo "FAIL: $f"; done

# 语法检查扩展 JS
for f in chrome_extension/*.js; do node --check "$f" || echo "FAIL: $f"; done

# JSON 校验 manifest
node -e "JSON.parse(require('fs').readFileSync('chrome_extension/manifest.json','utf8')); console.log('OK')"
```

## 6. 已知问题 / 待办

- [x] **README_EN.md 已同步** — 2026-09-01 更新至 v0.21.0（品牌 AI Tool Box、6 主题体系、7 模块、项目结构、更新日志 v0.17–v0.21）
- [ ] **`web_accessible_resources` 未包含新页面** — `manifest.json` 的 `web_accessible_resources` 目前只列出 `fullpage/workreport/todolist/english_learning`，未加 `ai_parse.html` / `ai_prompts.html`（因为 sidepanel 直接用相对路径访问扩展内部文件不需要此声明，但若未来需要从外部网页嵌入则需补充）
- [ ] **`ai-service.js` 双副本维护** — 网页版（507 行）与扩展版（524 行）略有差异，长期看应该考虑构建流程自动同步或抽成共享模块
- [ ] **PDF 解析仍依赖 pdf.js 本地打包**（~1.3MB），每个 iframe 首次打开都会加载，可考虑按需动态 `import()`
- [ ] **Apple 提醒事项 URL Scheme** 仅 macOS，Windows/Linux 用户无替代方案
- [ ] **任务清单与 Google Calendar 同步** 仅实现了 .ics 下载，未做 OAuth 直连

## 7. 接手清单

接手本项目时，按此顺序验证环境：

1. `git pull` 拉最新 master，确认版本徽章为 v0.22.0
2. 浏览器打开 `index.html`，配置 API（可用 DeepSeek `https://api.deepseek.com/v1` + `deepseek-chat` 测试）
3. 依次点击 8 个 Tab，确认每个都能正常工作
4. Chrome 加载 `chrome_extension/`：
   - 点工具栏图标 → 弹窗翻译
   - 点弹窗「侧边栏」按钮或按 `Alt+Shift+L` → 侧边栏 8 个 Tab 切换
   - 在任意页划词 → 弹出翻译图标
5. 在弹窗改 API 配置 → 切到侧边栏「AI 解析」，应立即使用新配置（无需刷新）
6. 切换主题（右下角面板 / 侧边栏右下角圆形按钮）→ 全部 8 个 Tab + 弹窗 + 网页版全部同步

---

**最后更新**：2026-09-01 by Mika (agent) · v0.22.0（新增热点雷达模块，详见 §3.9；v0.21 重设计详见 §3.8）
**参考文档**：`README.md` · `README_EN.md`（已同步至 v0.21.0） · `ai_summary_prompt.md` · `translate_tool_prompts.txt`
