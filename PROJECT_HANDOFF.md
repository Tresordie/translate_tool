# PROJECT_HANDOFF — LinguaFlow

> 本文档面向接手本项目的 AI 模型 / 开发者，记录项目当前状态、架构、关键决策与待办事项，避免重复踩坑。
>
> **当前版本**：v0.46.0 · 2026-09-18
> **仓库**：GitHub `Tresordie/translate_tool` · Gitee `simonyuan2019/translate_tool`（双远端推送，`origin` 同时配置 fetch GitHub + push 两个）

---

## 1. 项目简介

LinguaFlow 是一个基于大模型 API（OpenAI 兼容 `/chat/completions` 接口）的 AI 翻译 + 效率工具集，包含两个形态：

- **网页版** `index.html` — 8 个 Tab：智能翻译 / 工作报告 / 任务清单 / 英语学习 / 邮件总结 / AI 解析 / AI 提示词 / 微信工具
- **Chrome 扩展** `chrome_extension/` — Popup 翻译弹窗 + Side Panel 侧边栏（同 8 个模块）+ 划词翻译 + 右键菜单
- **本机服务** `wechat_scheduler/`（v0.26.0 起）— 微信定时消息后端：系统 PowerShell 模拟操作微信窗口发送（零 pip 依赖，引擎移植自 wxtimer）+ 定时调度 + 局域网静态托管（纯 Python 标准库，详见 §3.12）

所有页面共用：
- `theme.css` / `theme.js` — 9 款主题体系（低饱和苹果风 7 款 + 灵感库配色 2 款：轨道 Orbit / 夜曲 Nocturne）+ 玻璃拟态/噪点质感；设计规范源：《网页设计灵感参考库》（`I:\claude_code\dsh_operation\网页设计灵感参考库.html`）
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
| 微信工具 | ✅ iframe | ✅ 新标签页按钮 | ✅ Tab 8 |

> 上表除「微信工具」外的模块，**记录与配置均跨端双向同步**（v0.25.x）：任一端产生的数据实时互通到另两端（机制见 §3.9），智能翻译历史/任务清单为实时上屏，其余模块落盘同步（刷新可见）。微信工具的任务/历史存于本机 `wechat_scheduler` 服务（REST API），多端访问天然一致，**不需要也不允许**再加进 RECORD_SYNC_KEYS 映射（见 §3.12）。
>
> **结果导出能力（v0.25.11 引入，v0.46.0 扩至 6 处）**：智能翻译（网页版 `index.html` + 扩展全页 `fullpage.html`，转「译文」）、工作报告 / 邮件总结 / AI 解析 / AI 提示词（转结果）、微信工具（转 AI 总结）的结果区均有「微信格式」按钮——一键把 AI 输出转成可直接粘贴到微信发送的纯文本（详见 §3.11）。

## 3. 关键架构决策

### 3.1 iframe 子页面复用
网页版的「工作报告 / 任务清单 / 英语学习 / 邮件总结 / AI 解析 / AI 提示词」全部通过 iframe 嵌入独立 HTML 页面（`workreport.html` / `todolist.html` / `english_learning.html` / `email_summary.html` / `ai_parse.html` / `ai_prompts.html`）。Chrome 扩展的 Side Panel 同样用 iframe 复用这些页面（`chrome_extension/` 下各有一份副本）。

**好处**：一套代码两端用；**代价**：主题/配置同步要靠 `postMessage` + `localStorage` 双通道。

### 3.2 配置权威源（重要 ⚠️）
**Chrome 扩展是配置的权威源**。插件保存的配置会通过 `chrome.storage.local` + `postMessage` 实时推送到所有已打开的工具页。页面内手工保存的配置会被插件同步覆盖。

实现位置：`ai-service.js` 的 `initConfigSync()`。v0.18.0 修复：`initConfigSync` 现在同步写入 `localStorage('translate_config')`，确保 `chat()` 读到的永远是最新配置（之前只更新内存变量，AI 解析/提示词页面无法立即生效）。

⚠️ **v0.25.10 关键规则：`config` 是共享键的局部写入必须「读取-合并-写入」**。`chrome.storage.local.config` 有多个写入方：popup 写全字段（含 `enableSelectTranslate/sourceLang/targetLang`），而侧边栏、`AiService.saveConfig`（AI 解析/提示词等）、网页设置页（`content.js → background` 的 `linguaflow:saveConfig` 桥）只携带 API 三字段。历史上这些局部写入整替换 config，把扩展侧字段静默抹掉——划词开关「关了又开」（判定为 `!== false` 默认开启语义）即此根因。**新增任何只携带部分字段的 config 保存路径时，一律先 `get(['config'])` 合并再 `set`**（参考 `background.js` 桥 / `sidepanel.js` / `ai-service.js` 的 v0.25.10 写法）；整对象写入方可直接 set（popup/fullpage）。

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
706 行（网页版）/ 723 行（扩展版），IIFE 封装暴露 `window.AiService`：
- `initConfigSync()` — 配置读写 + 监听插件广播
- `chat({messages, options})` — OpenAI 兼容 chat/completions（内部经 `buildUrl()` 归一化地址、经 `proxyFetch()` 走跨域通道）
- `proxyFetch(url, options)` — **跨域请求通道，各页面统一入口**（详见 §3.10）；返回值 Response 兼容 `ok/status/text()/json()`
- `proxyFetchStream(url, options, onChunk)` — **流式跨域请求通道（v0.25.5）**：SSE 解析、直连→桥接分片回落、空闲超时、signal 取消；错误带 `_pfStreamPhase/_pfStreamPartial`（详见 §3.10 流式通道）
- `buildUrl(baseUrl)` — **唯一做了地址归一化的地方**：清理控制字符与空白、全角「：」「／」、尾斜杠、以及用户误填的重复 `/chat/completions`。v0.25.5 起全模块统一使用
- `normalizeBaseUrl(baseUrl)` — 归一化纯清理（不追加端点，v0.25.5 拆出），供 `/models` 等其他端点拼接复用（hotnews fetchModels、index.html「获取模型列表」）
- `isReasoningModel(model)` — 匹配 `reasoner|reasoning|thinking|qwq|kimi-k3|deepseek-v4|o1/o3/o4`；命中则省略 `temperature`/`max_tokens`，且 400 报错含 temperature 时自动去参重试一次。v0.25.5 起全模块统一接入；background.js/content.js 内联了 `lfIsReasoningModel` 副本（SW 无 window.AiService），**扩列正则时需同步两处内联副本**
- `parseNotes(text, mode)` — AI 解析：经典模式（任务抽取）
- `analyzeContent(text, opts)` — AI 解析：分析模式（结构化总结，含邮件 playbook）
- `generatePrompt(text)` — AI 提示词生成
- `extractPromptBody(fullText)` — 从 AI 输出中提取纯提示词正文
- `onRecordSync(key, cb)` — 跨端记录同步监听（v0.25.2）
- `loadState(key)` / `saveState(key, value)` — 页面状态双通道持久化（扩展 chrome.storage.local / 网页 localStorage）
- `createTodos(tasks)` — 把 AI 解析出的任务写入待办（`todo_items`，P0/P1→high、P3→low）

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
3. 根目录与 `chrome_extension/` 的页面副本必须同步修改：todolist 保留 2 处 CSP 差异（扩展版 Google Fonts 字体行 `media="print" id="gfAsync"` 异步加载 + `todolist.js` 头部 5 行字体启用 prelude；v0.34.0 起新版已无任何 inline onclick），english_learning 保留 2 处差异（扩展版字体异步 + 外部 JS 引用，根目录为内联 JS）
4. english_learning 根目录版的内联 JS = `chrome_extension/english_learning.js` 内容逐字一致（v0.21.0 消除分叉），改动任一侧需同步另一侧

### 3.9 记录全端双向同步体系（原「热点雷达」章节，模块已于 v0.29.0 移除）
> 热点雷达模块（hotnews.html/js、Tavily 检索链、hn_cards/hn_tavily_key 同步键、Side Panel「热点」Tab、Popup 入口）在 v0.29.0 整体下线；本节编号保留，内容改为纯记录同步体系说明（该机制与模块无关，全站仍在用）。

- **记录全端双向同步（v0.25.0）**：映射表 `RECORD_SYNC_KEYS` 在 background.js（chrome.storage 键 ↔ 网页 localStorage 键，覆盖 td_/wr_ 前缀及 popup 的 history/draft 命名差异）。网页适配器写入后 postMessage `save-record` → content.js → background 写 chrome.storage；扩展写入 → background onChanged 广播 `linguaflow:syncRecord` → 各标签页 content.js 写对应 localStorage → 页面既有 storage 监听自动刷新。**新增需同步的记录：在映射表加一行 + content.js 启动拉取列表加一个键 + 适配器写入处加一条 postMessage 即可。** 实时刷新仅覆盖已有 storage 监听的页面（任务清单/智能翻译历史），其余模块为落盘同步（刷新可见）。
- **v0.45.0 修复的三个同步断点（重要 ⚠️，三者叠加导致"网页与扩展历史不同步"）**：
  1. **`manifest.content_scripts` 缺 `all_frames`** → 内容脚本只注入顶层帧，而 index.html 的 7 个工具页全是 iframe，这些页面的记录既不上报也收不到推送。已加 `"all_frames": true`。**⚠️ 改 manifest 后必须在 `chrome://extensions` 重新加载扩展**，否则表现为"改了没生效"。
  2. **`AiService.onRecordSync` 网页分支键名不匹配** → content.js 写的是**映射后的 localStorage 键**（`wr_work_records`/`td_todo_items`），而页面订阅的是原始键（`work_records`），`e.key === key` 永远为 false。已改为同时匹配 `[key, 'wr_'+key, 'td_'+key]`。**新增带前缀的页面时沿用该规则即可，别再改回单键比较。**
  3. **顶层帧收不到自己的 storage 事件** → content.js 与 index.html 同帧，它写 localStorage 不会触发本帧 `storage` 事件；index.html 的翻译历史因此另订阅 `record-sync` postMessage（`AiService.onRecordSync('history', …)`）。iframe 子页则天然能收到跨文档 storage 事件。
  4. **英语学习扩展页启动引导方向反了**：原实现无条件把本页 localStorage 副本 `set` 进 chrome.storage，若网页端在扩展页关闭期间新增了记录，一打开扩展页就用旧副本覆盖回去。已改为**以 chrome.storage 为权威源**：远端有值 → 拉回本地；远端缺键 → 才迁移本地。**同类"启动即上报"引导不要出现在其他页面。**

### 3.10 网页版跨域代理桥（v0.23.0 引入，超时策略 v0.25.4 修订）

无 CORS 头的端点（**阿里云 Token Plan 专属网关**）在网页版会被浏览器拦截。若用户已装本扩展，请求可经 background 转发：
`页面 postMessage → content.js → chrome.runtime → background fetch（host_permissions 免跨域）→ 原路返回`。

- **入口** `AiService.proxyFetch(url, options)`：扩展页面（能读到 `chrome.storage`）直连；网页版先直连，**仅网络层失败才回落到桥**。因此开放 CORS 的端点（DeepSeek / 千问标准 API / 智谱 / 月之暗面，2026-09-03 实测均返回 `Access-Control-Allow-Origin`）**永远不会走桥**——这是「同一份配置换个模型就正常」类反馈的首要排查方向。
- **`bridge-ping` 由 content.js 直接应答，不经过 background**。ping 成功只证明 content script 已注入，**不证明 SW 健康**，排查时别被误导。
- 桥消息发往 `window.top`（content script 默认只注入顶层帧），回包用 `e.source` 定位发起帧，故 index.html 内的 iframe 子页面同样能走桥（v0.23.1）。
- **超时**：`bridgeFetch` 页面侧定时器 v0.25.4 起为 **600 秒**（原 120 秒）。PDF 邮件线程最多发送 6 万字符（`email_summary.js:376`），慢网关非流式生成常超 120 秒，会在正常返回前被误判「桥接请求超时」。
- **流式通道（v0.25.5）**：邮件总结主路径改走 `AiService.proxyFetchStream()`（SSE）。链路：页面 postMessage `bridge-fetch-stream` → content.js **立即回 ack**（旧版 content.js 无此逻辑，页面 5 秒收不到 ack 即判定「通道不支持」并降级非流式）→ `chrome.runtime.connect('linguaflow:proxyFetchStream')` 长端口 → background 流式 fetch、reader 循环逐片 postMessage 回端口 → content.js 以 `e.source` 回传。事件：`ack` / `chunk`（SSE 原始分片，页面侧统一解析）/ `json`（网关忽略 stream 的整包 JSON）/ `http-error` / `end` / `error`；取消经 `bridge-abort` → background AbortController。**空闲超时 180 秒**（STREAM_IDLE_TIMEOUT_MS）取代总超时——流式字节持续流动，慢网关长生成不再被掐断/误判。直连错误带 `_pfStreamPhase`（connect/read）标记：只有 connect 阶段失败才回落桥，read 阶段失败带 `_pfStreamPartial`（已收正文）直接抛给调用方保留部分结果。
- ⚠️ **v0.25.6 起邮件总结改回一次性输出（非流式），流式通道整体休眠**：`proxyFetchStream` 与桥接分片协议保留但无任何模块调用（应需求撤销流式逐行上屏）。若未来重启流式，接入范例可参考 git 历史中 v0.25.5 的 `email_summary.js` summarize()。桥接保活心跳（bridge-ka）仍生效——它保护的是非流式桥接请求。
- ⚠️ **不要再给 background 加 SW 保活**。排查时曾假设 MV3 service worker 在 30 秒空闲后被终止、`sendResponse` 丢失。实测（`tests/bridge-long-request.e2e.mjs`，真实 Chromium + 真实扩展 + 不回 CORS 头的模拟端点）在途 fetch **45s / 300s / 420s** 三档均完整回传、连接未中断——Chrome 会因在途 fetch 维持 SW 存活。该假设已被证伪，保活代码已撤销。
- **划词翻译也走桥（v0.25.10 起）**：content.js 的划词请求原为页面上下文直接 `fetch()`，受所在页面 CSP `connect-src` 限制（MV3 内容脚本 fetch 按页面源处理），严格 CSP 站点上必然「Failed to fetch」而弹窗同配置正常。现改经 `lfSendRuntime({action:'linguaflow:proxyFetch',...})` 由 background 代发；`unwrapProxy` 分层映射应答（桥通道错误 / `{ok,status,text}` / 网络异常 `{ok:false,status:0,error}`）。**扩展内任何新增的页面侧网络请求都应经桥，不要在 content script 直连。**

### 3.11 微信格式转换与剪贴板读取（v0.25.11，v0.46.0 扩至智能翻译）

**微信格式（`markdownToWechat`，共享于 `markdown.js`）**——微信不渲染 Markdown，6 处结果区（智能翻译译文：网页版 `index.html` + 扩展全页 `fullpage.html`；工作报告 / 邮件总结 / AI 解析 / AI 提示词的结果；微信工具的 AI 总结）各有一个「微信格式」按钮，点击后在该页结果下方展开 `<pre class="wechat-result">` 区域并显示转换结果，区域内独立「复制」按钮。

- **实现位置**：`markdown.js`（根目录与 `chrome_extension/` 两份副本逐字节一致）导出 `window.markdownToWechat(md)`。**这是唯一实现，勿再往各模块 JS 里复制**——六个模块 + 扩展副本共用；`workreport.js` 已从本地实现改为调用共享版。
- **转换规则（v0.45.0 重写，目标是"与 `renderMarkdown` 预览同构"）**：块级——标题分级符号 h1 `【】` / h2 `■ ` / h3 `▍ ` / h4+ `▸ `；无序列表 `•`（缩进按层级保留）、任务项 `☑/☐`、有序列表保留编号；`**1. 标题** 详述` 转「1. 标题：详述」；**多行引用转整块 `▎ ` 前缀**（块内 `- `→`• `、序号保留，`> [!warning]` 等 GitHub 告警标注转图标（warning/caution→⚠、note/info→ℹ、tip→💡、important→❗、danger→🚨、success→✅ 等）；水平线 `————————`；**表格转文本表格**：按显示宽度对齐（CJK/全角/emoji 记 2 列，其余 1 列），超 `TABLE_MAX_WIDTH=60` 预算时压缩最宽列（最小 4 列）并把单元格在列内折行，保留表头下的 `─` 分隔线与 `:---:` 对齐；**仅列数 >6 才退回**「▪ 首列值 + 键：值」块（文本表格已不可读）；代码围栏标记丢弃、正文**含缩进原样保留**。行内——`**粗体**` 的 **ASCII 字母/数字转 Unicode 粗体**（`𝗔-𝘇/𝟬-𝟵`，中文无对应字形故仍为普通字重）、斜体/删除线/行内代码去符号保内容、`[文本](url)` 转「文本（url）」。收尾——逐行清理：**表格与代码行只去行尾空格**（保住对齐缩进），普通行才折叠连续空格；收敛空行、去首尾空行、清除 `U+FE0E/U+FE0F/U+200D/U+20E3`。
- ⚠️ **宽度计算与 Unicode 粗体的耦合**：`isWide()` 必须把 SMP 的数学字母（0x1D400–0x1D7FF）算作**窄字符**，否则加粗后的英文单元格会被按 2 列宽计算、表格列全部错位。改 `markdownToWechat` 时同步检查 `strWidth`/`isWide`。
- **emoji 兼容（关键）**：全程按**字符串级正则**处理，绝不逐字符遍历，避免拆坏四字节代理对；仅清除微信会渲染成方框/分离字符的隐藏字符——变体选择符 `U+FE0E/U+FE0F`、零宽连接符 `U+200D`、键帽包围符 `U+20E3`。标准 emoji（`📋 🔑 📝 ✅` 等）原样保留。
- **数据来源各页不同**：workreport/email_summary 读 DOM 上的 `dataset.rawText`；ai_parse 读 `currentSummaryMd`；ai_prompts 读 `currentResultMd`；智能翻译两页（index/fullpage）读译文容器的 `outputText.dataset.text`（与复制/草稿/历史保存同一来源，译文为 Markdown 源文本，非渲染后 DOM）。生成新结果或加载历史时调用各页的 `resetWechatSection()` 清空并隐藏区域，避免展示过期转换。
- **智能翻译两页的接入差异（v0.46.0）**：函数命名为 `convertResultToWechat` / `copyResultWechat` / `resetWechatSection`（页面已有同名模块故改名）；`index.html` 按钮用内联 `onclick`，`fullpage.js` 按钮按 id 绑定（`#wechatFormatBtn` / `#copyWechatBtn`）。陈旧保护挂了 5 个钩子：`renderResult()`（新结果/历史回填）、`doTranslate()` 起始、译文 `input` 监听、`clearSource()`、草稿恢复——译文内容一变即隐藏区块。区块放在翻译卡片内 translate-bar 之后（`border-top` 分区延续卡片语言），样式用主题变量自适应深浅色。
- ⚠️ **新增支持该功能的页面时**：在结果按钮行加 `#wechatFormatBtn`、结果下方加 `#wechatSection`（含 `#copyWechatBtn` / `#wechatResult`）、样式块按各页 `<style>` 约定复制 `.wechat-*` 规则，JS 侧复用 `convertToWechat` / `copyWechat` / `resetWechatSection` 三个函数模式并调用 `window.markdownToWechat`。

**剪贴板读取（v0.25.11，避免重复授权弹窗）**——`navigator.clipboard.readText()` 受权限门控，`file://` 页面属不透明来源、浏览器**不保留**其授权，故每次调用都弹授权框。

- **扩展页**（弹窗 / 全屏页 / 侧边栏）：manifest 新增 `clipboardRead` 权限（⚠️ 新增权限后必须在 `chrome://extensions` 重新加载）；`fullpage.js` 用 `readClipboardText()`——隐藏 textarea + `document.execCommand('paste')` 优先，失败回退 `readText()`。
- **网页版**：不直接调用 `readText()`。先经 `content.js` 新增的 `read-clipboard` 桥（页面 postMessage → content script 用扩展权限 `execCommand('paste')` 代读 → `e.source` 回包 `{type:'clipboard-text', requestId, text|error}`），**一键粘贴且不弹框**；桥不可用（无扩展/扩展未获文件访问权）时，仅当 `navigator.permissions.query({name:'clipboard-read'})` 已为 `granted` 才直接读取，否则聚焦输入框并提示按 `Ctrl+V`——**任何路径都不主动触发授权对话框**。桥的超时 400ms。
- **注意**：`execCommand('paste')` 依赖扩展的 `clipboardRead` 权限，这是该权限的官方用途；content script 能以此读页面剪贴板已在真实浏览器实测通过（含 4 字节 emoji）。

### 3.12 微信工具（原微信定时消息）· 本机服务架构（v0.26.0 引入，v0.27.0 换引擎，v0.28.0 加总结）

**形态**：第 8 个模块「微信工具」（v0.26.0 引入时名「微信定时消息」，v0.29.0 更名）= 管理页 `wechat_schedule.html/js`（两副本，仅字体加载差异）+ 本机 Python 服务 `wechat_scheduler/`。**这是项目第一个带后端的模块**，但后端刻意做成「用户自己电脑上的一条命令」，项目本身仍是免安装前端。

- **发送引擎来源（重要）**：v0.27.0 起默认通道 `psauto` **移植自用户真机打磨的 wxtimer 项目**（`I:\claude_code\wechat`）——`scripts/WeChatAuto.ps1` 以字节级复制为底（UTF-8+BOM+CRLF，勿用 UTF-8/LF 工具重写），**已带本地补丁（与上游分歧）**：wxtimer 原版 `Get-WindowCandidate` 用 `IsWindowVisible` 一票否决，而微信 4.x 关窗缩托盘是 `SW_HIDE`（不可见），导致「托盘自动唤回」承诺对 4.x 失效（code 10 死循环）。补丁在 `Find-WeChatWindow` 尾部加 Win32 兜底：`FindWindow(类名,'微信')` 精确匹配（失败再 `FindWindow(cls,null)`+`GetWindowTextW` 校验标题），`AutomationElement::FromHandle` 包成 UIA 元素交给既有 `Restore-WeChatWindow`（SW_RESTORE 实测可还原托盘窗）。上游修复合入后可整文件回退。Python↔PS 用 `ps_driver.py` 的 UTF-8 JSON 作业文件桥接（命令行不传文本，绕开中文编码坑）。驱动安全层：哨兵式剪贴板回读校验、前台断言、锁屏/登录窗识别、首次发送 8 秒倒计时、绝不按 Esc（会把微信关进托盘）。退出码表见 `ps_driver.CODE_TEXT` / README §四。
- **通道与边界（重要 ⚠️）**：`wx_sender.py` 统一协议 `status()/contacts()/send(task, content)`（**task 是完整 dict**：receiver/files/options/sent_count），三实现：`PsAutoSender`（默认，零依赖）、`WechatAutoSender`（`--sender wechatauto`，可选增强：读微信本地库提供联系人列表；社区项目）、`MockSender`（`--mock`）。非官方自动化有风控风险，页面首次保存强制勾选确认（`ws_risk_ack`）。微信 4.x 界面自绘**无法核对会话标题**——唯一前缀备注名（如 `定-妈妈`）是硬约定，同时避开搜索下拉「搜一搜」抢回车坑。消息只能由登录中的微信发出：关机/锁屏/无窗口期间不发送。
- **调度语义（v0.27.0 对齐 wxtimer）**：补发窗口 `catch_up_minutes`（默认 240，options 可调）——超窗**放弃留痕**不轰炸；周期任务整段停机只补最近 1 次；同一计划点连败 `MAX_RETRY_PER_SLOT=5` 次放弃推进；once 发完/放弃即停用；滞后 >90s 才加「【补发】」前缀。发送经 `data/.send.lock`（msvcrt 非阻塞锁）互斥；`sent_count` 字段控制首次倒计时。
- **五种调度**：`schedule = {type: once|daily|weekly|monthly|yearly}`——weekly `weekdays[1..7]`(1=周一)；monthly `day 1..31` + `clamp`（当月无此日提前月末/跳过）；yearly `date "MM-DD"`（2-29 只在闰年）。纯函数在 `scheduler_logic.py`，时间字符串 `fmt_dt` **秒级精度**（分钟截断会让带秒的 once 提前触发——已踩坑）。内容占位符 `{target}{date}{time}{note}` 在触发时刻渲染（server.render_content，不用 str.format）。`files` 附件路径列表（相对路径按服务目录解析，发送前存在性校验）。
- **服务（`server.py`，纯标准库）**：`ThreadingHTTPServer` 承担 ① REST API（`/api/status|doctor|probe|contacts|tasks|history` + `tasks/<id>/run|dryrun`，CORS `*`，可选 `--token`）② 秒级调度线程（通道未就绪**跳过不消耗触发时刻**）③ 静态托管项目根目录。**勿引入任何第三方依赖**（wechatauto-replica 也只作可选通道，惰性 import）。
- **前端约定**：`ws_api_base`/`ws_api_token` 双写（扩展 chrome.storage.local / 网页 localStorage）；基址默认 http(s) 访问取 `location.origin`（手机零配置）否则 `http://127.0.0.1:8765`；15s 轮询。**任务数据在服务端，不走 RECORD_SYNC_KEYS/content.js 桥**。接收人允许纯名称（`receiver.wxid` 可空，psauto 按 name 搜索）；联系人下拉仅在装了 wechatauto-replica 时可用，否则手填。
- **验证**：`tests/test_scheduler_logic.py`（含 monthly/yearly/clamp/闰年）+ `tests/test_wx_reader_clean.py`（XML 清洗 5 项，含真机双重转义样本）+ `tests/wx-scheduler-mock.e2e.mjs`（**31 项**：CRUD/到点触发/手动/窗口内补发/超窗放弃/演练拒绝/合法 start&end 不 400/静态托管/路径穿越/历史删除/总结 CRUD）。真机（微信 4.1.13.65 + pyenv-win 3.12.9）已全部闭环：doctor、托盘唤回、真实发送、群聊读取（XML 噪音清零）、假 AI 端点跑通总结→微信格式→复制全链。
- ⚠️ **编码维护约定**：`start_wx_scheduler.bat` 必须 **GBK+CRLF**（cmd 按 ANSI 码页解析，UTF-8/LF 错位——`echo` 变 `cho`）；`scripts/WeChatAuto.ps1` 必须 **UTF-8+BOM+CRLF**（PS 5.1 无 BOM 中文注释乱码报错）。两者都别用 UTF-8/LF 工具顺手重写。bat 的 Python 探测链：`py -3`/`python`（排除 Store 桩 exit 49）→ pyenv `version` 全局 → `versions\*` 扫描 → `%LOCALAPPDATA%\Programs\Python\Python3*`。**findstr 坑**：`/R "a b"` 空格会拆成 OR 模式（端口检测恒误报），必须 `/C:"..."` 字面量或两段管道。⚠️ **`chrome_extension/` 目录内禁止出现下划线开头文件**（Chrome 加载解压缩扩展直接报错，`_locales`/`_metadata` 除外）——对 `native_host_launcher.py` 跑 `py_compile` 会生成 `__pycache__`，编译检查后务必删除（已入 .gitignore 但加载看的是磁盘实况）。
- **聊天记录 AI 总结（v0.28.0）**：`wx_reader.py` 经 wechatauto-replica `WeChatDB`（单例 + 锁，首次密钥提取 ~20s）本地解密读消息，`GET /api/messages?target&start&end` 按时间窗口过滤（target 支持 wxid 直用/名称 `search_contact` 唯一匹配；未装依赖返回 502 可行动错误，页面降级手输名称）。**引用/卡片消息的协议 XML 由 `clean_content()` 清洗**：`_deep_unescape`（真机存在双重转义）+ 迭代提取 `<title>/<content>` 语义文本（≤3 层），纯噪音丢弃、无文本给 `[类型]` 占位（单测 `tests/test_wx_reader_clean.py`）。AI 调用在**页面端**走共享 `AiService.chat`（服务不存 API Key），语料 60k 预算保首尾；**输出语言**下拉复用 `AiService.OUTPUT_LANGS`（10 语种，同工作报告），选择持久化 `ws_sum_lang`；「清除」按钮重置本次读取/结果/预览（`clearSummary`）。总结记录存 `data/summaries.json`（POST/GET/DELETE `/api/summaries`，上限 100，多端一致）；发送历史同版加 `id` 迁移 + `DELETE /api/history/<id>` / `DELETE /api/history`。联系人列表带 localStorage 缓存 `ws_contacts_cache`（10 分钟，聚焦空列表即时触发拉取）。**下载**：「下载 Markdown」导出原始 md；「下载 HTML」由 `buildHtmlReport` 用共享 `renderMarkdown` 渲染（支持任务表格——workreport 本地 `markdownToHtml` 不支持表格，勿复用），独立文档含会话/时间范围/条数元信息头，文件名 `wx-summary-<会话>-<时间戳>`。模块 UI 更名「微信工具」（内部 id `wxschedule`、文件名不变）。
- **部署/自启/故障排查**：见 `wechat_scheduler/README.md` 与 `USAGE.md`（含 `schtasks` 开机自启、坐标校准 §4.2、退出码表）。

### 3.13 数据与云同步 + 服务自启（v0.29.0）

**需求共识（与用户逐条确认）**：所有数据本地存储；服务作为枢纽镜像到 **Google Drive 桌面客户端的本地同步文件夹**（非 API/OAuth）；**自动备份 + 手动恢复**；「导入本地」= 选已导出的 JSON 文件；**备份包永不包含 API Key 与服务口令**（用户明确选最安全档）。

- **`sync.py` SyncHub**：`data/settings.json`（drive_path/auto_backup/last_backup_*）+ `data/browser_state.json`（页面推送的浏览器数据）。备份包 = `browser_state` + `wechat{tasks,history,summaries}`，写 `<drive>/LinguaFlow/latest.json` + 当日快照 `backup-YYYY-MM-DD.json`（保留 14 份，`_prune`）。自动备份经 `schedule_backup` 去抖 5s，挂在所有数据变更点（record/任务 CRUD/总结/历史删除/browser-data/restore）。
- **脱密双保险**：`strip_secrets`——整键剔除 `ws_api_token`/`hn_tavily_key`（遗留），`translate_config`/`config` 对象内 `apiKey` 置空（字符串形态自动往返）。客户端 `data-sync.js` 推送前也剥一遍。**e2e 有「备份文件 grep 不到明文密钥」断言，改脱密逻辑必须保过它。**
- **`data-sync.js`**：注入 16 个页面（含扩展副本与 fullpage；popup/sidepanel 宿主不注入防重复）。收集 localStorage 全量 +（扩展环境）chrome.storage.local，脱密后 POST `/api/browser-data`。触发=加载后 4s / storage 事件去抖 / 60s 心跳；服务不可达完全静默（2.5s 超时 ping + 30s 可用性缓存）。`LinguaFlowDataSync.applyState` 供恢复流程写回双存储后 reload。
- **恢复流**：`POST /api/restore {name}`（Drive 快照）或 `{bundle}`（上传文件）→ 服务替换 tasks/history/summaries + browser_state → 返回 browser_state 给页面 `applyState` + 2s 后 reload。恢复入口全部带 confirm。
- **开机自启（A 必选）**：`POST /api/autostart {enable}`——服务用 `sys.executable` 生成 `launch_hidden.vbs`（**GBK+CRLF**，vbs 不认 UTF-8 中文）+ `schtasks /SC ONLOGON`；查询用 `schtasks /Query`。⚠️ vbs 生成两坑：① `ws.Run` 不解析 `>>` 重定向，必须 `ws.Run "cmd /c ""<py>"" server.py >> log 2>&1", 0, False`；② VBS 引号用双写转义，结构错了 wscript 静默失败（任务显示已注册但永不拉起）。
- **目录选择用页面内嵌浏览器，不用原生对话框**：`GET /api/listdir?path=`（空=盘符；仅目录名，`abspath` 归一化，隐藏 `$`/`.` 前缀目录）+ 管理页「浏览…」展开下钻列表「选用此目录」回填。曾用 PowerShell FolderBrowserDialog 原生弹框，但**服务由 agent/非交互父进程拉起时子进程继承非交互窗口站，对话框创建了却不可见**（用户侧表现为点了没反应），且 DriveFS 客户端配置库（root_preference_sqlite.db roots 表）在本机为空不可依赖——原生方案已整体移除。
- **一键拉起（B 可选）**：`chrome_extension/native_host_launcher.py`（stdio 协议：探测 8765 → 未监听则 `DETACHED_PROCESS` 拉起 server.py 并等端口就绪）+ `install_native_host_win.bat <扩展ID>`（生成 manifest + 写 HKCU 注册表）。链路：页面 `start-scheduler` → content.js → background `sendNativeMessage`。仅扩展浏览器可用，页面按钮按 `isExtension` 显隐。
- **API 面**：`GET/PUT /api/settings`、`POST /api/backup`、`GET /api/backup/status|snapshot`、`POST/GET /api/browser-data`、`POST /api/restore`、`GET/POST /api/autostart`（全部走既有 CORS + token 门）。
- **验证**：e2e 扩至 **44 项**（路径校验/脱密/落盘/零泄露/删任务后恢复/快照列表/autostart 查询）。

### 3.14 跨平台化（v0.30.0）

**需求共识**：用户希望微信工具在 Windows/macOS/Linux 均可用（微信可跨系统登录），且要求跨平台总结；经逐条确认——发送驱动接受"mac/linux 实验性需真机验证"，总结因仅 Windows 有解密方案，跨平台靠"结果同步查看 + 局域网访问主力机服务"满足。

- **服务本体跨平台**：`server.py` 纯标准库天然可移植；`SendLock` 双实现（Windows `msvcrt.locking` / POSIX `fcntl.flock`，`HERE/data/.send.lock`）；`/api/status` 增 `platform`(sys.platform) + `reader_available`(仅 win/cygwin/msys)。
- **发送通道按 OS 选默认**（`wx_sender.default_sender()`）：win→`psauto`(已验证)、darwin→`macauto`、linux→`linuxauto`。`--sender` 五选。
  - `mac_sender.py`（osascript + System Events）：`tell application "WeChat" to activate` → Cmd+F 搜索 → 粘贴名 → Return → 哨兵剪贴板回读校验（`the clipboard` 往返）→ 粘贴正文 → Return(key code 36)。需辅助功能+自动化授权。
  - `linux_sender.py`（xdotool）：`search --class wechat|weixin` → `windowactivate` → `key ctrl+f` → `type`（自带 Unicode）→ Return。**Wayland 原生窗口 xdotool 注入不了**（需 ydotool/uinput，未内置），仅 X11/XWayland 可用。
  - ⚠️ 两者**均未经真机验证**（开发在 Windows）：窗口类名、快捷键、mac 进程名 "WeChat" vs "微信" 等需用户实测调参；`contacts()` 在非 win 直接抛可行动错误（无库读取方案）。
- **`wx_reader` 平台守卫**：`_get_db()` 非 win 抛 ReaderError，指引"Windows 主力机总结 + Drive 同步查看 / 局域网访问主力机服务"，不再盲目 import 失败。
- **启动脚本**：新增 `start_wx_scheduler.sh`（mac/linux，定位 python3 + 端口检查 + 日志）；bat 仍 Windows。`autostart_enable/disable/status` 按 `_os()` 分派：win=schtasks+vbs(GBK+CRLF)、mac=launchd plist(`~/Library/LaunchAgents/com.linguaflow.wxscheduler.plist`)、linux=systemd user unit(`~/.config/systemd/user/linguaflow-wxscheduler.service`, WantedBy=default.target)。
- **云同步状态 chip**：`data-sync.js` 在非 wechat_schedule 页注入左下角「☁」胶囊（`#lfSyncChip`），显示 已同步时间/未配置 Drive/服务未启动，点击跳 wechat_schedule.html，60s 刷新。六大模块数据本在备份包内，至此状态可见。
- **Linux Drive 边界**：无官方客户端 → 同步以 Win/Mac 为主；Linux 建议局域网访问主力机服务（用户确认此方案）。
- **验证**：全模块 py_compile/node --check 通过；Windows 端功能回归不变（e2e 44 项绿）；mac/linux 驱动待用户对应设备实测。

### 3.15 全模块云同步抽屉（v0.31.0）

- **`cloud-sync.js`**：自包含右侧滑出抽屉（fixed 定位，不依赖宿主 DOM），把微信工具页的云同步控制搬到**每个模块页**——`data-sync.js` 注入的「☁」胶囊点击调 `LfCloudSync.toggle()`（无组件时回退跳 wechat_schedule.html）。功能：Drive 路径 + 内嵌目录选择弹窗（`/api/listdir`）、自动备份 switch、立即备份、从 Drive 恢复、快照逐个下载/恢复、导入/导出本地 JSON、开机自启（`/api/autostart`）；自带 toast 与 `lfcs-` 前缀样式（用 theme CSS 变量带 fallback）。恢复复用 `LinguaFlowDataSync.applyState` + reload。
- **注入面**：`cloud-sync.js` 加在 `data-sync.js` 之后，覆盖 index + 6 模块页 + 微信工具页（根目录 + 扩展副本；chrome_extension 无 index.html）。**v0.32.0 起微信工具页不再有内联云卡片**——`data-sync.js` 去掉了对 wechat_schedule 的胶囊排除，全页面统一用抽屉；微信页特有的「一键拉起服务」按钮（native host，仅扩展环境显示）从云卡片挪进「定时服务连接」操作行，`wechat_schedule.js` 里云卡片逻辑（bindCloudCard/refreshCloud/loadDir 等 ~200 行）整体删除，仅保留精简版 `bindWake()`。至此云同步 UI 单一来源 = `cloud-sync.js`。
- **验证**：e2e 46 项、逻辑 8、清洗 7 全绿；抽屉 API 面与微信页一致，未新增后端接口。

### 3.16 输入内容保护原则（v0.45.0，⚠️ 产品级约束）

**规则：任何页面的输入内容，只有用户主动删除才允许清空；保存、提交、切换、载入历史、取消操作等一律不得清除。** 新增功能时必须遵守，评审时按此条检查。

- **保存类**：`workreport.js` 保存/更新记录后**不再** `workEditor.clear()`、也不再 `storage.remove(['work_draft'])`；`wechat_schedule.js` 保存定时任务改调 `resetForm(false)`（只退出编辑态、复位标题与按钮，不清字段），显式「重置」按钮走 `resetForm(true)`。
- **取消类**：`workreport.js` `cancelEdit()` 恢复 `_preEditText`（进入编辑前抓取）而非清空；`todolist.js` MD 导入弹层的「取消」与导入成功后都不再 `todoEditor.clear()`（重复导入有 title+date 去重兜底）。
- **覆盖类**：会把历史/记录灌进输入框的入口先 `confirm()`——`index.html`/`fullpage.js`/`popup.js` 的 `loadHistory`、`english_learning.js` 的 `loadHistory`、`workreport.js` 的 `editRecord`。判定条件统一为「当前有非空内容 **且** 与目标内容不同」，相同则不打扰；取消即 return，绝不改动输入。
- **焦点类（易被忽略的丢内容主因）**：中文输入法合成中若输入框失焦，未上屏内容会被浏览器直接丢弃。因此**输入框附近的按钮必须 `mousedown` 时 `preventDefault()`**，点击不抢焦点。已处理：`index.html`（内联 `onmousedown`）、`fullpage.js`、`popup.js`（JS 监听，MV3 禁内联）。
- **允许的主动清空**：各页「清空 / 清空所有 / 清空全部 / 重置 / 删除 / 清除配置」按钮、附件 file input 复位、筛选条件清除。
- **已知例外（待用户确认是否收紧）**：`todolist.js` `openTaskModal()` 每次打开「新建任务」弹层会重置标题/备注——属"新建一条"的常规语义；若要求也保留，改成不清字段即可（代价是易误建重复任务）。

### 3.17 历史区域「勾选 → 导出 MD/HTML」统一模式（v0.45.0）

8 处历史区域（智能翻译网页版 + 扩展全页、工作报告历史总结、英语学习、邮件总结、AI 解析、AI 提示词、微信工具发送历史、微信工具总结记录）统一为同一交互，新增历史区请照抄：

- **UI**：区域标题行放 `<label class="hist-select-all"><input type="checkbox" id="xxxSelectAll">全选</div>` + 两个按钮「导出 MD」「导出 HTML」（class 沿用各页既有按钮样式：`history-clear` / `btn-select-all` / `btn-chip` / `btn-tool` / `btn-mini` / `el-btn-ghost`）；每条历史项首个子元素放 `<input type="checkbox" class="hist-check|history-check|sum-hist-check|el-history-check" data-index|data-id|data-sid="…">`。
- **事件**：列表点击委托里**第一行**加 `if (e.target.closest('.hist-check')) return;`（否则勾选会触发"点击载入"）；重绘列表时把全选框复位为 `false`。
- **导出**：读取 `:checked` → 映射回数据数组 → 每条渲染成 `## 标题（时间 · 语种 · 来源）` + 正文，条目间用 `\n\n---\n\n` 拼接；MD 用 `text/markdown;charset=utf-8`，HTML 用 `AiService.mdToHtml(md, 标题)`（微信工具页用其自带 `buildListHtmlReport`）。下载统一走 `AiService.downloadText`（微信工具页 `triggerDownload`、英语学习页 `downloadFile`）。
- **数据源差异**：workreport/email/ai_prompts 的历史正文本身就是 Markdown（`content`/`result`/`md` 字段）直接拼；**AI 解析的 `mode:'parse'` 历史存的是 tasks 数组**，由 `taskListMarkdown()` 转成「优先级|任务|说明|标签|子步骤」表格；翻译历史由 `text`/`result` 组装；英语学习复用页面既有的 `generateMarkdown(items, date)` / `generateHTML(items, date)`（两者接受任意子集数组）。
- ⚠️ 原先"一键导出全部为 JSON"的按钮已按需求删除（翻译历史 / 工作记录 / 英语学习 / 邮件总结），**不要恢复**；英语学习页原 `exportHistory` 因引用未声明的 `history` 实际导出的是空对象，属既有缺陷，已随之下线。

## 4. 版本与分支历史

| 版本 | 关键改动 |
|------|---------|
| v0.46.0 | **智能翻译译文一键转微信格式（网页版 + 扩展全页）**：译文区（`index.html` / `fullpage.html`）新增「微信格式」按钮，点击在翻译卡片底部（translate-bar 之后）展开「💬 微信格式」区块，复用共享 `markdownToWechat`（v0.45.0 结构还原版，未改动）转纯文本 + 独立复制按钮。数据源为 `outputText.dataset.text`（与复制/草稿/历史同源）；陈旧保护挂 5 个钩子（`renderResult` / `doTranslate` 起始 / 译文 `input` / `clearSource` / 草稿恢复）内容一变即隐藏。函数名 `convertResultToWechat` / `copyResultWechat` / `resetWechatSection`；index 用内联 onclick，fullpage 按 id 绑定。样式沿用 `.wechat-*` 模式但区块用主题变量自适应深浅色。微信格式转换至此覆盖 6 处（智能翻译×2 / 工作报告 / 邮件总结 / AI 解析 / AI 提示词 / 微信工具 AI 总结），接入清单见 §3.11。验证：Node 语法检查 + 内置浏览器实测两页（浅色纸感白/深色石墨主题、转换正确性、复制通路、陈旧隐藏、扩展页 bindEvents 手动执行无报错） |
| v0.45.0 | **微信格式还原预览结构 + 8 处历史勾选导出 + 同步三断点 + 输入保护原则**：① `markdownToWechat` 重写（双副本）——表格转按显示宽度对齐、单元格列内折行的文本表格（`:---:` 生效，仅列数 >6 退回键值块）、标题全层级符号（`【】`/`■`/`▍`/`▸`）、多行引用转 `▎` 块并识别 `> [!warning]` 告警、ASCII 加粗转 Unicode 粗体（`isWide()` 须把 SMP 数学字母算窄，否则表格错位）、代码块缩进保留、收尾清理改为"表格/代码行只去行尾空格"。② 8 处历史区域统一「勾选 + 全选 + 导出 MD/HTML」（见 §3.17），移除原「导出全部 JSON」按钮（翻译历史/工作记录/英语学习/邮件总结）；AI 解析 parse 历史转任务表格 Markdown。③ 同步修复：manifest `content_scripts` 补 `all_frames: true`（index 内 7 个工具页是 iframe，此前内容脚本不注入 → 双向全断）、`onRecordSync` 网页分支匹配 `wr_`/`td_` 前缀键、index.html 顶层帧补 `record-sync` 订阅、英语学习扩展页启动引导改为以 chrome.storage 为权威（原会把旧副本推盖回云端）。④ 输入保护原则落地（见 §3.16）：保存/取消/导入不再清输入，载入历史前 confirm，输入框邻按钮 `mousedown` preventDefault（防输入法未上屏内容被丢），并补上扩展全页版/弹窗版**从未绑定**的 Markdown 预览按钮。⑤ 微信工具「AI 总结」按钮永久发灰修复（写死 `dim-50` + 读取失败不恢复禁用）。⑥ 翻译页输入区可 `resize: vertical`（须同时取消 flex 拉伸）；修两栏与分区线错位（`width:auto` 覆盖 theme.css 的 `width:100%`）；修 workreport `init()` 漏读 `work_summaries` 致历史总结刷新后恒空。验证：无头浏览器 44+13+19 项断言 + Node 单测，全绿 |
| v0.44.0 | **同步覆盖审计 + 网页↔扩展记录互通补全**（系统性扫描 8 模块实际使用的 localStorage/chrome.storage 键 vs RECORD_SYNC_KEYS vs data-sync 收集范围）：缺口=① email_summary_draft（自动保存草稿）无反向 relay；② 微信工具 ws_api_base/ws_api_token/ws_risk_ack/ws_sum_lang/ws_contacts_cache 五键无任何跨端通道（扩展版 store.set 双写 chrome.storage ✓ 但映射表缺失，网页版 store.set 只写 file:// localStorage）。修复=record 同步映射表（background.js）与 content.js 启动预填清单各补 6 键（含 ws_api_token——本地双向一致，Drive 推送仍被 SECRET_DROP 剔除）；email_summary.js 草稿自动保存补 relayRecord；wechat_schedule.js store.set 网页分支补 `window.top` postMessage relay（数据入 chrome.storage）+ 双环境实时缓存刷新监听（扩展 onChanged / 网页 storage 事件更新 store.cache）。**Drive 同步确认**：data-sync.js 全量 localStorage/chrome.storage 收集 + SECRET_DROP 剔密已天然覆盖全部模块记录，无需改动 |
| v0.43.0 | **修复英语学习页扩展环境下完全失效的真正根因：MV3 CSP 阻止内联脚本**——扩展版 english_learning.html 是全站唯一把全部逻辑写在内联 `<script>` 的模块页（其他页均为外部 JS），MV3 扩展页面默认 CSP `script-src 'self'` 直接阻止该脚本执行 → 配置加载/同步/单词学习/历史全部交互在扩展环境中静默死掉（页面渲染正常极具迷惑性）。修复：内联脚本（998 行）提取为外部 `english_learning.js`（根目录 + chrome_extension 双副本逐字一致，含 gfAsync 字体切换 prelude），html 改外部引用，字体行 `onload` 内联属性同步改 `id="gfAsync"`（CSP 同样阻止内联事件处理器）。v0.42.0 的 areaName 修复仍有效（onChanged 监听在外部 js 中正常注册）。**架构说明**：打破 v0.21.0"根版内联=ext js 逐字一致"约定，改为与 workreport 等页一致的外部 JS 架构。⑦ **连带修复：全站 `--green` 基础色变量缺失**（用户报告"保存配置/保存今天内容按钮无质感、浅色主题下不可见"）——theme.css 历史上只定义了 `--green-rgb` 与 alpha 变体，从未定义 `--green` 基础色；v0.38 修 Tailwind 色时引用 `var(--green)` 引入回归（按钮背景解析为 none，浅色主题下白字彻底隐形）。修复=9 主题块各补 `--green: rgb(var(--green-rgb))` 与缺失的 `--green-a12`/`--cyan-a12`（rgba 同源形式），ai-panel.css 的 `--white-a06`（未定义）→ `--white-a10`。**教训**：修"硬编码色→令牌"时必须先确认令牌存在（评审报告作者不知道项目里 --green 不存在）；系统性校验用"全量 var 引用 vs 已定义集合"比对 |
| v0.42.0 | **修复 Chrome 114+ onChanged 签名变更导致的全站实时同步失效**（用户截图实证：popup 保存配置后英语学习页不填入）：Chrome 114 起 `chrome.storage.onChanged` 第二参数由 string `'local'` 改为 context 对象 `{areaName, incognito}`，全站 19 处 `area === 'local'` / `area !== 'local'` 判断在新版 Chrome 永远为 false/true → 所有实时监听静默失效（background 广播、content.js 中继、ai-service initConfigSync/onRecordSync、email/todolist/workreport/english_learning/index 各页监听全部中招）。此前"其他页面能同步"是假象——数据层 `loadConfig()` 每次请求实时读存储掩盖了 UI 层失效。修复=16 文件统一双签名兼容 `(area === 'local' \|\| (area && area.areaName === 'local'))`（!== 同理），单元验证旧 string/新 context 双模式 4 例全过。**教训**：涉及 Chrome API 的监听判断必须兼容两代签名 |
| v0.41.0 | **英语学习配置同步统一通道 + todolist 品牌区对齐 hero 规格**：① 英语学习页新增 `AiService.initConfigSync` 调用（三处：根 html / ext html / ext js）——复用其他页面已验证可用的统一通道（扩展环境 chrome.storage.onChanged + 启动 get('config')，网页环境 postMessage），与 v0.40.0 的 storage 事件/专用监听形成多通道冗余，applySyncedApiConfig 幂等；postMessage 模拟验证表单自动填入；② todolist 品牌区升级至子页 hero 同规格：图标砖 40→48px（svg 20→24、圆角 12→14）、字标 1.5rem→`clamp(1.35rem,2.6vw,1.8rem)`、gap 12→15px，实测 48px 砖 + 28.8px 字标 + 同排。**注意**：扩展行为未变时先在 chrome://extensions 重新加载扩展 |
| v0.40.0 | **用户反馈五项修复**：① 移除三套灵感库主题（书斋 Study / 鎏金 Navy / 极光 Aurora，主题 12→9 款；**教训**：批量正则删除 theme.css 块时非贪婪 `[^]*?` 从最早注释头起匹配，连带吞掉相邻 8.1 Nocturne 块——已重建恢复，删块正则必须锚定目标 id 紧邻的注释头）；② **英语学习页配置同步修复**：根因=content.js 的 postMessage 广播只触达顶层窗口，iframe 内英语学习页收不到；其他页面靠 `AiService.loadConfig()` 每次请求实时读 translate_config（数据层）所以正常，英语学习页表单是 UI 层。修复=内联脚本补 `storage` 事件监听（translate_config/config 双键→applySyncedApiConfig，跨窗口天然派发）+ `__elExtSynced` 竞态守卫（loadApiConfig 不覆盖已同步值）；三处同步（根 html/ext html/ext js），双标签页真实跨窗口验证通过；③ **page-hero 改横向锁定**：CSS Grid（badge 整行居中 → tile 列1 + h1 列2 同排 → 副题列2 下行 → 发丝线整行居中），DOM 零改动，--sm 变体同步；④ **字标扁平修复**：Syne 大写宽扁观感差 → 字标统一 `'Plus Jakarta Sans'` 800 / -0.025em（index/fullpage/子页 hero、todolist brand、english_learning 标题五处）；⑤ 英语学习/任务清单标题对齐图标+标题同排格式（随 ③④ 统一）。**报告误报补充**：评审报告称英语学习同步"已接入"仅指 postMessage 通道存在，实际 iframe 场景收不到 |
| v0.39.0 | **全站图文标题（page-hero）体系**（参考 LOCALAI 徽标+字标牌结构，适配本应用玻璃语言）：theme.css 新增 `.page-hero` 组件（56px 渐变图标砖 + 双色字标 + 功能副题 + 72px 渐变发丝线，`--sm` 修饰类 48px/30px 用于子页，注意须与基类并用 `class="page-hero page-hero--sm"`）；index/fullpage 升级大 hero（工具箱砖 + 副题含模块清单）；6 子页头替换为 `--sm` hero 且 **glyph 与功能匹配**——邮件总结=信封、AI 解析=闪电、AI 提示词=双星、工作报告=文档+柱图、微信工具=聊天气泡、任务清单 topbar 品牌区=mini-hero（conic 圆点→工具箱渐变砖+实色字标）；english_learning 卡内标题升级（书形图标→44px 渐变砖、字标实色化修复 `--header-gradient` 首色深底不可读通病）；sidepanel 头部补品牌渐变发丝线；ai-panel.css 删除旧 `.header` 规则（与组件冲突）。**教训**：JS `String.replace` 替换串中 `$6` 被解析为捕获组引用导致字面量残留，批量模板替换须转义 `$$` 或避免 `$` |
| v0.38.0 | **《页面设计评审报告》十项全量落实**：① theme.css 全局层——语义刻度令牌（`--radius-xs..pill` 6 级圆角 / `--sp-1..8` 间距 / `--shadow-1..4` 高度（`html[data-mode=light]` 自动减重）/ `--glow-brand/cyan/green` 语义光 / `--dur-*`+`--ease` 动效 / `--fs-*` 字号 / `--h2-*` 标题令牌 / `--ink-on-accent`）+ 全局 `:focus-visible` 键盘焦点环（`!important` 兜底页面级 `:focus{outline:none}`，WCAG 2.4.7）+ `prefers-reduced-motion` 全局降级（动画/过渡 .01ms + 停无限循环）+ `@media print` 打印基线（强制浅色面栈/隐藏屏幕装饰/玻璃→实线/防拆行/外链尾注）+ 排版微调（`text-autospace`/`text-wrap:balance`/`.num` 等宽工具类）；② 6 页标题大纲补 h2 台阶（index 模型配置/翻译历史、workreport/email/ai_parse/ai_prompts 的 h3→h2 + `.settings-header h2` 选择器、todolist 指南 h4→h3）；③ 字体统一：index/fullpage/popup 去 Sora 全走 `--font-display`（Syne），english_learning 补 Syne；④ english_learning 去 Tailwind 色（#059669/#DC2626/#EA580C/#047857 等 8 处→`var(--green/--red/--orange)`+color-mix）；⑤ ai_parse `#1a1a1a`→`var(--ink-on-accent)`；⑥ wechat_schedule 32 处内联样式→工具类（`.w-full/.row-center/.hint-text/.panel-flush-*` 等 21 类；12 处 `display:none` 初始态保留——JS 用 `style.display=''` 恢复，改类会破坏）+ 去本地 `--green` 覆盖 + catchup 标签色令牌化；⑦ todolist 删除错误的 `rgba(var(--primary-rgb,80,120,220))` 猜测回退 + 5 处裸黑阴影→`--shadow-*`；⑧ workreport/email/ai_parse/ai_prompts 断点补齐（1180 平板档 + `hover:none` 触屏降级 + settings-grid `auto-fit`）；⑨ 新建 `ai-panel.css`（双副本）抽取 ai_parse/ai_prompts/email_summary 三页 57 条字节级相同规则（~9.6KB），加载顺序 theme.css→ai-panel.css→页面 `<style>`。**报告误报记录**：email_summary 字体加载并非缺陷（根目录 email_summary.js 已有 gfAsync→media 兜底）；ai_parse `#1a1a1a` 实为橙底 chip 深色文字（已令牌化）。⑩ **index/fullpage 页头重设计**（用户反馈巨型发光标题难看）：`clamp(2.15rem,7vw,4.4rem)` 70px 巨题 + 双层霓虹光晕 → 紧凑品牌锁定（40px 渐变图标砖 + `clamp(1.55rem,3vw,2.1rem)` 标题 + 缩小徽章），theme.css `.header h1` 光晕收敛为单条 `drop-shadow(0 2px 12px var(--primary-a15))`，页头高度 244px→127px，内容首屏可见；⑪ **标题体系专家优化**（四表面统一）：双色字标 `<span class="wm-accent">AI</span> Tool Box`——仅强调词走 `--btn-gradient` 渐变、主体实色 `--text-strong`（修复整词渐变在深色主题下 `--header-gradient` 首色近黑致 "AI" 不可读），theme.css `.header h1` 改实色 + 新增 `.wm-accent` 全局规则；品牌图形统一为工具箱渐变砖（popup 地球线标→28px 砖、sidepanel 地球 glyph→工具箱 glyph，与 index/fullpage 同款）；眉标规格归一 0.66rem/1.2px/text-dim（pane-label 0.72→0.66、popup header-tag 字距 1.5→1.2px opacity 0.6→0.75）；`.tab-header` 为 index 死 CSS（无标记使用，仅记录未删）。**遗留**：index 21 层选择器压平（报告自身建议避免大重构） |
| v0.37.0 | **灵感库设计体系落地（全站分批改版第 1 批）**：新增 5 套主题（源自《网页设计灵感参考库》五套配色，**色值经提亮调饱和以匹配本应用玻璃拟态+辉光语言**）——深色 夜曲 Nocturne（`#0B0E14`×晴空蓝 `#4D9FF8`×薄荷青 `#3FD6B4`）/ 鎏金 Navy（宝石海军蓝 `#0D1F35`×香槟金 `#F2C94C`，`--primary` 首次用作金色）/ 极光 Aurora（深紫 `#170E30`×电光紫 `#B57BFF`×玫粉 `#FF8FB8`×薄荷 `#4FE3C1`），浅色 书斋 Study（米白纸感 `#FDF8F1`×翡翠绿 `#2F8C67`×活力陶土 `#D98A54`）/ 晴空 Sky（纯白×清透天青 `#0E9FD8`）；主题总数 12 款（5 浅+7 深）。任务清单页布局重设计：统计胶囊升级为 **Bento KPI 指标卡**（灵感库 demo-02 范式：3px 左色条 蓝/青/紫/绿轮换 + JetBrains Mono 等宽大数字 tabular-nums + 大写眉标 + 蓝→紫渐变进度条 1s cubic-bezier(.2,.8,.2,1) 缓动 + 语义副行 今日x/y·逾期n·高优先级n·完成率）；品牌区改 conic 渐变圆点 + 英文大写眉标（TODO · KANBAN BOARD）；日期/时间/计数 chip 全面等宽化；引导编号等宽；新增 `--font-mono` 页面变量与 Google Fonts JetBrains Mono 引入；`updateStats()` 重写为 KPI 填充（今日/待办/进行中/已完成 + 逾期/高优先级/完成率统计）；看板交互与数据模型零改动 |
| v0.36.0 | **新增第 7 款主题「轨道 · Orbit」**（`lf-orbit`，深色）：配色取自 ML 监控面板风格——深空蓝黑底（`#0A0E14`/卡 `#11161E`）× 电光青主色（`#2FC6E8`）× 琥珀辅助色（`--accent2/--orange #F5A623`）× 珊瑚红/薄荷绿状态色；扁平卡片 + 极细中性描边（`--glass-border 7%`），去玻璃弥散（`--orb-opacity 0.05`/`--card-border-glow 0`/噪点 0.03）；`--accent2` 首次用作琥珀（看板中优先级标签、MD 按钮随之变琥珀色）；注册点：theme.css 变量块 + `.swatch-lf-orbit` 色板 + theme.js 深色组/`DARK_THEMES`（双副本，theme.js 仅注释差异、theme.css 字节一致） |
| v0.35.0 | **任务清单看板质感精修**（与 v0.33.0 云同步抽屉设计语言同源）：渐变标题（`--header-gradient` clip text）+ 渐变品牌/弹层图标砖（`--btn-gradient` + 发光）+ 列顶状态色渐变发丝线（`.kb-col::before`）+ 状态色图标砖/计数胶囊 + 卡片左侧优先级渐变条（`--kb-pri` 自定义属性，已完成列绿色）+ `--glass-shadow` 分层玻璃阴影 + emoji 图标砖 + 标签/chip 彩色内描边（`color-mix`）+ 拖拽倾斜 1.5° + 筛选激活渐变填充 + 按钮 `background-size:170%` 渐变扫掠 hover + 首次渲染卡片入场瀑布动画（`renderBoard({animate:true})` 仅初始调用，后续刷新不重播）+ 空列状态收件箱图标 + 呼吸虚线框 + 弹层标题渐变发丝线/关闭按钮旋转微动效 + 定制滚动条统一；双副本同步，CSP 差异仍为 2 处 |
| v0.34.0 | **任务清单看板化重设计**（参考 Roadmaps Board 视图）：`todolist.html/js` 双副本整体重写——四列看板（待办/进行中/已完成/已暂停，列头状态图标+计数+列内添加）+ HTML5 拖拽换列（拖入已完成列同步 `completed=true`）+ 卡片结构（emoji 图标/标题/描述/日期逾期红标/时间/优先级彩色标签/✓Google/✓ICS 徽标/悬浮快捷操作）+ 顶栏统计胶囊（今日进度小圆环）与筛选（全部/今日/高优先级）；数据模型新增 `status/desc/icon` 字段，加载时自动迁移旧数据（`completed`→`done` 其余→`todo`，`completed` 与 `status` 持续双向同步，AI Parse 旧格式任务自动落入待办列）；KPI 统计精简为顶栏胶囊、Markdown 导入导出/Google Calendar/ICS/Apple 提醒/同步指南全部保留收进顶栏与弹层（新建/编辑、设置、MD 导入三弹层）；存储键不变 `td_todo_items`/`todo_cal_config`，Google Drive 云同步机制零改动；todolist 两副本 CSP 差异收敛为 2 处（字体行 + JS prelude，无 inline onclick） |
| v0.33.0 | **云同步抽屉质感升级**：`cloud-sync.js` 重构为主题自适应玻璃拟态（渐变头部/状态胶囊圆点/强调条分区/卡片字段/渐变按钮+微动效/快照图标/定制滚动条/transform 滑入）；修浅色主题输入框按钮偏暗（`--bg-card`→`--bg-card2`），6 主题明暗均适配 |
| v0.32.0 | **云同步入口统一**：删除微信工具页内联云卡片+目录模态（~200 行），`data-sync.js` 取消微信页胶囊排除，全页面统一用 `cloud-sync.js` 抽屉；「一键拉起服务」按钮挪入服务连接区，wechat_schedule.js 仅留精简 `bindWake()`。云同步 UI 单一来源 |
| v0.31.0 | **全模块云同步抽屉**：新增自包含 `cloud-sync.js`（右侧滑出，☁ 胶囊触发），把 Drive 路径/目录浏览器/自动备份/立即备份/恢复/快照/导入导出/开机自启带到 index + 6 模块页（13 文件双副本），各页无需跳微信工具页即可管理同步；微信页保留内联卡片（同 API 两视图）。详见 §3.15 |
| v0.30.0 | **跨平台化**：服务本体 SendLock(msvcrt/fcntl 双实现)、autostart 按 OS(schtasks/launchd/systemd-user)、`start_wx_scheduler.sh`、`/api/status` 报 platform+reader_available；发送通道按系统选默认(win=psauto已验证 / mac=macauto osascript / linux=linuxauto xdotool，后两者实验性待真机)；wx_reader 非 win 平台守卫给主力机/局域网指引；各页云同步状态 chip(data-sync.js 注入)；Linux 无官方 Drive 客户端→同步以 Win/Mac 为主。详见 §3.14 |
| v0.29.0 | **数据与云同步**：`sync.py`（Drive 文件夹镜像：自动备份去抖+每日快照×14+latest；备份=浏览器数据+微信数据；**永不含 API Key/口令**，e2e 零泄露断言）+ `data-sync.js` 注入 16 页静默推送 + 微信工具页「数据与云同步」卡片（路径试写/开关/立即备份/快照下载恢复/导入导出）；**服务自启**：开机计划任务注册（launch_hidden.vbs GBK+CRLF）+ 可选 native host 一键拉起（install_native_host_win.bat）；**移除热点雷达**（模块 9→8，§3.9 改为同步体系说明）；e2e 44 项；manifest 0.29.0 |
| v0.28.0 | 微信工具新增**聊天记录 AI 总结**（wx_reader 本地解密读取 + 时间窗口 + 页面端 AiService 三段式总结 + 总结记录服务端存储/复制/微信格式）；发送历史支持单条删除与清空（条目 id 自动迁移）；模块更名「微信工具」；e2e 扩至 30 项；真机验证中文会话名读取；manifest 0.28.0 |
| v0.27.0 | 微信定时消息换引擎 + 语义对齐 wxtimer：默认通道改 `psauto`（系统 PowerShell UIA/键盘驱动，移植 wxtimer 的 WeChatAuto.ps1——哨兵剪贴板回读校验/前台断言/锁屏与登录窗识别/首次发送倒计时/绝不按 Esc，**零 pip 依赖**；wechatauto 降为可选=联系人列表）；调度补 monthly/yearly（clamp、2-29 闰年）、占位符 {target}{date}{time}{note}、附件 files、补发窗口 catch_up_minutes（超窗放弃留痕）、同点连败 5 次放弃、发送互斥锁、sent_count；API 新增 doctor/probe/dryrun；页面新增环境体检/演练按钮与放弃/演练徽章；真机 doctor 验证通过（微信 4.1.13.65），真实发送待用户开窗口后演练；e2e 扩至 19 项；bat 重写为三步零依赖（含 findstr 误报修复）；manifest 0.27.0 |
| v0.26.0 | 新增第 9 模块「微信定时消息」：管理页两副本 + index Tab + Side Panel Tab 9 + Popup 按钮；`wechat_scheduler/` 纯标准库服务（REST API + 秒级调度 + 开机补发 + 局域网静态托管 + `--mock`）；任务存服务端 data/*.json 不走记录同步体系；⚠️ 非官方自动化有封号风险、关机期间不发送只补发；tests 双脚本；（wcferry/wechatauto 通道均被 v0.27.0 的 psauto 取代） |
| v0.25.11 | 四个模块（工作报告/邮件总结/AI 解析/AI 提示词）新增「微信格式」一键转换（共享 `markdown.js` 的 `markdownToWechat`，保留 emoji + 清除微信方框字符 + 代码块不缩进）；智能翻译原文输入框新增复制按钮（网页 + 扩展弹窗/全屏页/侧栏）；修复工作报告「输出语言选 English 却输出中文」（配置同步把 `config.outputLang` 重置为 zh 且不回写下拉框 → 现以界面下拉框为准，同步只更新连接信息并保留语言偏好）；修复粘贴按钮每次都弹剪贴板授权框（扩展声 `clipboardRead` + content.js `read-clipboard` 桥 `execCommand('paste')` 代读；网页未授权时降级聚焦 + Ctrl+V，绝不触发授权框）；Popup 新增「打开本地网页版」入口（路径可配置 + 未开文件访问权时给指引）；页面初始化加 `request-config` 握手修首开配置竞态 |
| v0.25.10 | 修复划词开关失效：侧边栏/`AiService.saveConfig`/网页设置桥等**局部保存整替换 `chrome.storage.config`**，抹掉 popup 写入的 `enableSelectTranslate`（判定 `!== false` 默认开启 → 图标"复活"，sourceLang/targetLang 同丢），全部改「读取-合并-写入」；修复严格 CSP 站点划词「Failed to fetch」：content.js 页面上下文直连 fetch 受页面 CSP `connect-src` 约束，改经 `linguaflow:proxyFetch` 桥由 background 代发，`unwrapProxy` 分层错误诊断（归一化/推理门控/400 去参重试保留）|
| v0.25.9 | 英语学习长内容模式重设计：材料模式提示词改返回 `{translation, words}`（全文中文翻译 + ≤20 较难词汇），结果区 = 全文翻译卡 + 词汇卡（词头喇叭按钮一键朗读，`resultContent` 事件委托）；**历史条目改存结构化解析结果**，恢复走 `displayResult` 与学习时一致（修复恢复显示原始 JSON 串），旧格式按 `{fallback}` / 原文 Markdown 兜底兼容；md/html 导出改结构化生成（删 htmlToText/extractText/extractSection/extractExamples 死函数）；修复「清空所有」误删 `learningHistory` + 清空经 `elRelayRecord` 同步防 chrome.storage 复活；「清空所有」无确认弹窗 |
| v0.25.8 | 热点雷达切换 Tavily 检索链（AI 提取 3-5 关键词 → Tavily 新闻搜索 → 三维度打分归类 ≤10 主题，输出标题/摘要/来源/热度）；新增 hn_tavily_key 设置区并入全端同步（16 键）；热榜聚合与必应层退役；Tavily CORS 开放网页直连无需扩展 |
| v0.25.7 | 英语学习支持长材料输入：>4 词自动切材料模式，提取关键词汇（≤15 个）逐词生成学习卡片；历史显示短标签、点击恢复全文；两副本同步 |
| v0.25.6 | 邮件总结恢复一次性输出（撤销 v0.25.5 流式逐行上屏，应用户反馈）；非流式请求带耗时提示与直连取消；流式基础设施保留休眠；其余兼容性修复（buildUrl/推理门控/SW 保活/错误诊断）全部保留 |
| v0.25.5 | 修复邮件总结超长 PDF「API 服务无法访问」：全链路改 SSE 流式（proxyFetchStream + 桥接长端口分片 + 180s 空闲超时 + 取消按钮 + 非流式降级）；**修复扩展端邮件总结无法加载文件**（english_learning storage 适配器把对象裸写 localStorage 毒化共享 origin → 各页面顶层 JSON.parse 崩溃；已改序列化写入 + 各模块容错解析）；全模型兼容统一（buildUrl/isReasoningModel/400 去参重试推广到智能翻译/工作报告/英语学习/扩展弹窗后台/划词/全屏页）；修复 english_learning textAsync、hotnews ext pr.text、5 处扩展页 CSP inline onload；index.html 设置面板新增「获取模型列表」；manifest 版本 0.20.0→0.25.5；新增 tests/stream-and-url.test.mjs、tests/pdf-parse.test.mjs |
| v0.25.4 | 修复邮件总结超长 PDF「桥接请求超时」：代理桥页面侧超时 120s → 600s（两份 ai-service.js 同步）；真实浏览器实测**证伪**「MV3 SW 30s 空闲被杀」假设（45/300/420s 均存活），未加保活代码；更正「阿里云端点无 CORS」文档错误（仅 Token Plan 网关如此，千问标准 compatible-mode 实测 CORS 开放）；新增 `tests/`（超时守卫 + 长请求 e2e） |
| v0.25.3 | 修复刷新后同步记录消失：content script 改为 document_start 注入 + 启动拉取 15 个同步键写入 localStorage（扩展为权威源）；智能翻译历史 flag/time 归一化 |
| v0.25.2 | 三端实时同步补全：AiService.onRecordSync 统一监听 API + 工作报告/邮件总结/英语学习/AI 解析/AI 提示词全部接入实时刷新 |
| v0.25.1 | 修复 iframe 页面记录反向同步（14 处中继改发 window.top）+ 各模块历史记录「导出」按钮（JSON 下载） |
| v0.25.0 | 记录全端双向同步：background 映射表（chrome.storage↔localStorage 键）+ content.js 中继 + 各适配器反向汇报；任务清单/热点雷达/翻译历史实时刷新，其余模块落盘同步 |
| v0.24.2 | 代理桥全模块覆盖：index.html 智能翻译 / 工作报告 / 邮件总结 / 英语学习的独立 fetch 全部接入 AiService.proxyFetch（返回值 Response 兼容 ok/status/text()/json()），Token Plan 等无 CORS 端点在网页版全模块可用 |
| v0.24.1 | 修复卡片刷新报错：refreshCard 误将 fetchPool 返回的池对象传入 mergePools（已改用 .items 并加 Array.isArray 防御） |
| v0.24.0 | 热点雷达「全网搜索」升级：UApi 板块扩至 14（+虎扑/微信读书/掘金/澎湃）+ 新增必应搜索层（按提示词实时搜索 www.bing.com/search?format=rss，经扩展桥免跨域，失败降级纯热榜） |
| v0.23.2 | 修复热点筛选空结果：候选池改为 60s 综合榜 + UApi 全板块并行合并（含 IT之家/36氪 垂直板块，实测 124 条/10 板块）；空数组优雅呈现（不再报格式异常）；JSON 尾逗号容错 |
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
- **manifest.json 权限** → `sidePanel` 权限 + `minimum_chrome_version: 114` 必须同时存在；v0.25.11 起新增 `clipboardRead`（原文粘贴免授权，见 §3.11）——**新增/修改扩展权限后必须提醒用户在 `chrome://extensions` 重新加载扩展**
- **`markdown.js`** → 根目录与 `chrome_extension/` 两份副本逐字节一致，新增/修改共享渲染或转换函数（`renderMarkdown` / `markdownEscapeHtml` / `markdownToWechat`）必须同步两份
- **新增「微信格式」支持的页面** → 见 §3.11 的接入清单（按钮 + 区域 + `.wechat-*` 样式 + 三个 JS 函数模式），根目录与扩展副本同步
- **剪贴板相关改动** → 勿在网页版直接调用 `navigator.clipboard.readText()`（`file://` 每次弹授权框），走 §3.11 的桥/降级路径
- **同步相关改动（v0.45.0 起）** → ① 改 `manifest.json` 任何字段（含 `content_scripts.all_frames`、新增权限）都必须提醒用户在 `chrome://extensions` 重新加载，否则表现为"改了没生效"；② 新增带前缀存储键的页面（`wr_`/`td_`）时，`onRecordSync` 已按 `[key, 'wr_'+key, 'td_'+key]` 匹配，别再退回单键比较；③ **顶层帧（index.html）写 localStorage 不会触发本帧 storage 事件**，其自身数据要同步必须订阅 `record-sync` postMessage；④ 任何页面启动引导都**不得**把本地 localStorage 无条件推盖 chrome.storage（会用旧副本吃掉网页端新记录），一律以 chrome.storage 为权威、仅缺键时迁移
- **输入框与其邻侧按钮** → 按钮点击默认会抢焦点，中文输入法**未上屏的合成内容会被浏览器丢弃**（表现为"一点按钮输入就没了"）。输入框附近的按钮统一加 `mousedown → preventDefault()`；HTML 内联属性仅限网页版，扩展页面必须用 `addEventListener`（MV3 CSP 禁内联处理器）
- **新增/改动历史导出** → 按 §3.17 的清单接（复选框 + 全选 + 导出 MD/HTML + 列表点击委托首行守卫 + 重绘复位全选）；⚠️ 不要恢复已删除的"导出全部 JSON"按钮
- **`markdownToWechat` 改动后** → 用含宽表格/多行引用/加粗中英混排/代码块的样例实测输出，重点看表格列是否对齐（Unicode 粗体的宽度归类最易出错）

### 5.3 测试脚本
```bash
# 语法检查所有根目录 JS
for f in *.js; do node --check "$f" || echo "FAIL: $f"; done

# 语法检查扩展 JS
for f in chrome_extension/*.js; do node --check "$f" || echo "FAIL: $f"; done

# JSON 校验 manifest
node -e "JSON.parse(require('fs').readFileSync('chrome_extension/manifest.json','utf8')); console.log('OK')"

# 代理桥超时守卫（虚拟时钟，毫秒级，无需浏览器）
node tests/bridge-timeout.test.mjs

# URL 归一化 + 流式通道单测（SSE 分块/桥接分片/取消/降级，虚拟沙箱）
node tests/stream-and-url.test.mjs

# PDF 解析管线（用页面同一份 pdf.min.js 解析样例 PDF）
node tests/pdf-parse.test.mjs

# 用 git 旧版对照，确认该测试真能捕获回归（预期报红，exit=1）
git show HEAD:ai-service.js > /tmp/ai-service-old.js && SVC_PATH=/tmp/ai-service-old.js node tests/bridge-timeout.test.mjs

# 真实浏览器验证 SW 长时间在途 fetch 存活（会打开可见窗口，默认延迟 45s）
node tests/bridge-long-request.e2e.mjs
DELAY_MS=420000 DEADLINE_MS=470000 node tests/bridge-long-request.e2e.mjs
```

> `bridge-long-request.e2e.mjs` 依赖本机 playwright chromium（详见 §6 环境说明）；加载未打包扩展必须**有头模式**。

## 6. 已知问题 / 待办

### 国产模型接入缺口（2026-09-03 排查「桥接请求超时」时发现）

- [x] **URL 地址归一化覆盖全模块** — v0.25.4 给 email_summary 接入 `buildUrl`；v0.25.5 推广到剩余全部 AI 调用点（index.html 智能翻译 / workreport ×2 / english_learning ×2 / fullpage / background / content），另拆出 `normalizeBaseUrl()` 供 `/models` 复用（hotnews fetchModels 与 index.html 设置面板「获取模型列表」均已接入）。
- [x] **推理模型参数自适应覆盖全模块** — v0.25.4 email_summary 已接入（本条原文「全仓库无任何模块调用」自该提交起过时）；v0.25.5 全部剩余调用点统一接入 `isReasoningModel` 门控 + 「400 报错含 temperature 则去参重试一次」（含 background/content 内联的 `lfIsReasoningModel` 副本——**修改 REASONING_RE 时两处内联副本需同步**）。仍需注意：正则按模型名子串匹配，GLM 系等以参数开思考的模型不在列（它们接受 temperature，不会 400；遇到拒绝 temperature 的新模型靠 400 重试兜底）。
- [x] **「获取模型列表」进入主设置面板** — v0.25.5 index.html API 设置面板已加（经 proxyFetch，Token Plan 网页版可用）；扩展弹窗/侧边栏设置面板仍未加（低优先）。
- [ ] **Token Plan 专属网关的真实 host 仓库内无记录** — 各处注释与 README 只出现「阿里云 Token Plan」这个名字，从未写出 Base URL，导致无法实测其 CORS 与响应特征。宜在 README 提供商表补一条真实地址（脱敏 Key）。
- [x] **微信定时消息真机发送已闭环（v0.27.0，2026-09-13）** — 微信 4.1.13.65 真环境：`/api/doctor` 通过（含**托盘隐藏窗自动还原**，修复 wxtimer 上游 IsWindowVisible bug 后）；真实发送「副卡simon」成功（keyboard 模式，剪贴板回读校验通过）。一次性任务失败不再直接停用（保持启用由重试上限控制放弃）；启用过期 once 任务给明确中文报错。

### 测试环境

- [ ] `tests/bridge-long-request.e2e.mjs` 依赖本机 playwright chromium（当前：playwright-core 1.62.1 + `ms-playwright/chromium-1234`，Chrome for Testing 151）。加载未打包扩展须有头模式；`--load-extension` 在品牌版 Chrome 137+ 已移除，Chrome for Testing 仍支持。仓库无 `package.json`；`.gitignore` 自 v0.25.11 起已收录 `node_modules/` 与 `.zcode/`（均为本机开发/agent 产物，不随项目分发）。

### 既有待办

- [ ] **流式通道整体休眠（v0.25.6）** — 邮件总结已改回一次性输出（应用户反馈，撤销 v0.25.5 的逐行上屏），当前无任何模块使用流式；全部模块非流式，经代理桥时受 600s 总超时约束（开放跨域端点直连无此限制）。`proxyFetchStream` 与桥接分片协议保留，重启流式时可直接复用（接入范例见 git 历史 v0.25.5 的 email_summary.js）
- [ ] **模型兼容性已知边界**（详见 README「模型兼容性说明」）— 仅支持 OpenAI 兼容协议（Anthropic/Gemini 原生协议不支持）；`REASONING_RE` 按模型名匹配，按参数开思考且名字无线索的模型（GLM 系）不命中（它们接受 temperature，正常工作，靠 400 重试兜底）；发送上限 6 万字符；扫描件 PDF 需 OCR

- [x] **README_EN.md 已同步** — changelog 与功能特性已补至 v0.25.11（注意 v0.25.4 条目 EN 版缺失、v0.25.6/v0.25.9 中文条目较细，正文以中文 README 为准）
- [ ] **`web_accessible_resources` 未包含新页面** — `manifest.json` 的 `web_accessible_resources` 目前只列出 `fullpage/workreport/todolist/english_learning`，未加 `ai_parse.html` / `ai_prompts.html` / `email_summary.html`（扩展内部相对路径访问不需要此声明，但若未来需要从外部网页嵌入则需补充）
- [x] **`manifest.json` 版本号长期未同步** — v0.25.5 起已同步为 0.25.5（后续发版记得一并更新）
- [ ] **`ai-service.js` 双副本维护** — 网页版与扩展版略有差异（扩展版多一个 `applyConfig` 写回 localStorage 的 shim），长期看应该考虑构建流程自动同步或抽成共享模块
- [ ] **英语学习 storage 适配器遗留双写** — v0.25.5 修复了它把 chrome.storage 对象裸写 localStorage 的污染 bug，但其「localStorage → chrome.storage 复制 + 双通道监听」与 v0.25 记录同步体系存在职责重叠，长期应收敛到 AiService.loadState/saveState 统一通道
- [ ] **PDF 解析仍依赖 pdf.js 本地打包**（~1.3MB），每个 iframe 首次打开都会加载，可考虑按需动态 `import()`
- [ ] **Apple 提醒事项 URL Scheme** 仅 macOS，Windows/Linux 用户无替代方案
- [ ] **任务清单与 Google Calendar 同步** 仅实现了 .ics 下载，未做 OAuth 直连
- [ ] **灵感库全站分批改版（v0.37.0 起动）** — 设计规范源：《网页设计灵感参考库》。已完成：主题体系（9 款，v0.40.0 移除书斋/鎏金/极光）+ 任务清单页（Bento KPI）+ **v0.38.0 设计评审十项落实（全局令牌刻度/焦点环/降级/打印/大纲/字体统一/去硬编码/断点/ai-panel.css 抽取）**。待跟进批次：工作报告→Bento 指标面板（L2 范式：KPI 左色条+等宽数字）、英语学习→杂志多栏阅读（L3 范式：衬线词头+等宽音标+多栏正文）、邮件总结/AI 解析→结论置顶卡片流（L4 范式：渐变 TL;DR 区+等宽编号要点）、智能翻译→双语对照分栏（L1 范式：行同步高亮+术语标注）；改版时遵守库内硬规则（暗色非纯黑、对比度≥4.5:1、60-30-10、数字全等宽、动画≤400ms）
- [ ] **index.html 深层选择器压平**（v0.38.0 评审报告遗留）— 最深 21 层选择器链，报告自身建议避免大重构，待后续小批次处理

## 7. 接手清单

接手本项目时，按此顺序验证环境：

1. `git pull` 拉最新 master，确认版本徽章为 v0.46.0（`chrome_extension/manifest.json` 的 `version`）
2. 浏览器打开 `index.html`，配置 API（可用 DeepSeek `https://api.deepseek.com/v1` + `deepseek-chat` 测试）
3. 依次点击 8 个 Tab，确认每个都能正常工作；在智能翻译生成一次译文、或在工作报告/邮件总结/AI 解析/AI 提示词生成一次结果后点「微信格式」，确认区域展开、内容无 `#`/`**` 残留且 emoji 正常；编辑译文/结果后区块应自动隐藏
4. Chrome 加载 `chrome_extension/`（v0.25.11 起新增 `clipboardRead` 权限，加载/更新后需在扩展卡片点「重新加载」）：
   - 点工具栏图标 → 弹窗翻译
   - 点弹窗「侧边栏」按钮或按 `Alt+Shift+L` → 侧边栏 8 个 Tab 切换
   - 在任意页划词 → 弹出翻译图标
   - 点弹窗的原文「粘贴」按钮 → 应直接粘贴且不弹剪贴板授权框
5. 在弹窗改 API 配置 → 切到侧边栏「AI 解析」，应立即使用新配置（无需刷新）
6. 切换主题（右下角面板 / 侧边栏右下角圆形按钮）→ 全部 8 个 Tab + 弹窗 + 网页版全部同步

---

**最后更新**：2026-09-18 · v0.46.0（智能翻译译文一键转微信格式：网页版 + 扩展全页，微信格式转换扩至 6 处；详见 §4 版本表与 §3.11）
**参考文档**：`README.md` · `README_EN.md`（changelog 停在 v0.25.11，正文随版本更新，仍以中文版为准） · `ai_summary_prompt.md` · `translate_tool_prompts.txt`
