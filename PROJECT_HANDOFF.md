# PROJECT_HANDOFF — LinguaFlow

> 本文档面向接手本项目的 AI 模型 / 开发者，记录项目当前状态、架构、关键决策与待办事项，避免重复踩坑。
>
> **当前版本**：v0.18.0 · 2026-08-28
> **仓库**：GitHub `Tresordie/translate_tool` · Gitee `simonyuan2019/translate_tool`（双远端推送，`origin` 同时配置 fetch GitHub + push 两个）

---

## 1. 项目简介

LinguaFlow 是一个基于大模型 API（OpenAI 兼容 `/chat/completions` 接口）的 AI 翻译 + 效率工具集，包含两个形态：

- **网页版** `index.html` — 7 个 Tab：智能翻译 / 工作报告 / 任务清单 / 英语学习 / 邮件总结 / AI 解析 / AI 提示词
- **Chrome 扩展** `chrome_extension/` — Popup 翻译弹窗 + Side Panel 侧边栏（同 7 个模块）+ 划词翻译 + 右键菜单

所有页面共用：
- `theme.css` / `theme.js` — 12 款 Catppuccin 主题 + 玻璃拟态/星空/噪点质感
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

### 3.4 Side Panel 现代极简 UI（v0.18.0）
`sidepanel.css` 完全重写：
- 浅灰白背景 `#F8F9FA` / 深色 `#121212` / 主色 `#4F46E5`
- 12px 圆角卡片 + 微阴影 + 1px 极细边框
- 顶部栏 `backdrop-filter: blur(12px)` 毛玻璃
- 系统无衬线字体（移除了 Google Fonts 依赖）
- 暗色模式自动适配 Catppuccin Frappé / Macchiato / Mocha

### 3.5 AI 服务层（`ai-service.js`）
507 行（网页版）/ 524 行（扩展版），IIFE 封装暴露 `window.AiService`：
- `initConfigSync()` — 配置读写 + 监听插件广播
- `chat({messages, options})` — OpenAI 兼容 chat/completions（reasoning 模型自动省略 temperature）
- `parseNotes(text, mode)` — AI 解析：经典模式（任务抽取）
- `analyzeContent(text, opts)` — AI 解析：分析模式（结构化总结，含邮件 playbook）
- `generatePrompt(text)` — AI 提示词生成
- `extractPromptBody(fullText)` — 从 AI 输出中提取纯提示词正文
- `writeTodoItems(items)` — 把 AI 解析出的任务写入待办（`todo_items` + chrome.storage 双通道）

## 4. 版本与分支历史

| 版本 | 关键改动 |
|------|---------|
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

- [ ] **README_EN.md 未同步** — 中文版已更新到 v0.18.0 和 AI 解析/AI 提示词，英文版仍停留在 v0.16.1
- [ ] **`web_accessible_resources` 未包含新页面** — `manifest.json` 的 `web_accessible_resources` 目前只列出 `fullpage/workreport/todolist/english_learning`，未加 `ai_parse.html` / `ai_prompts.html`（因为 sidepanel 直接用相对路径访问扩展内部文件不需要此声明，但若未来需要从外部网页嵌入则需补充）
- [ ] **`ai-service.js` 双副本维护** — 网页版（507 行）与扩展版（524 行）略有差异，长期看应该考虑构建流程自动同步或抽成共享模块
- [ ] **PDF 解析仍依赖 pdf.js 本地打包**（~1.3MB），每个 iframe 首次打开都会加载，可考虑按需动态 `import()`
- [ ] **Apple 提醒事项 URL Scheme** 仅 macOS，Windows/Linux 用户无替代方案
- [ ] **任务清单与 Google Calendar 同步** 仅实现了 .ics 下载，未做 OAuth 直连

## 7. 接手清单

接手本项目时，按此顺序验证环境：

1. `git pull` 拉最新 master，确认版本徽章为 v0.18.0
2. 浏览器打开 `index.html`，配置 API（可用 DeepSeek `https://api.deepseek.com/v1` + `deepseek-chat` 测试）
3. 依次点击 7 个 Tab，确认每个都能正常工作
4. Chrome 加载 `chrome_extension/`：
   - 点工具栏图标 → 弹窗翻译
   - 点弹窗「侧边栏」按钮或按 `Alt+Shift+L` → 侧边栏 7 个 Tab 切换
   - 在任意页划词 → 弹出翻译图标
5. 在弹窗改 API 配置 → 切到侧边栏「AI 解析」，应立即使用新配置（无需刷新）
6. 切换主题（右下角面板 / 侧边栏右下角圆形按钮）→ 全部 7 个 Tab + 弹窗 + 网页版全部同步

---

**最后更新**：2026-08-28 by Mika (agent)
**参考文档**：`README.md` · `README_EN.md` · `ai_summary_prompt.md` · `translate_tool_prompts.txt`
