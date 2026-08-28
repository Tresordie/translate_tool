# LinguaFlow · AI 智能翻译

> 基于大模型 API 的在线翻译工具，支持网页版和 Chrome 扩展，全球 30+ 语言互译，支持划词翻译。

![Version](https://img.shields.io/badge/version-0.19.7-blue)
![License](https://img.shields.io/badge/license-MIT-green)

**语言 / Language**：中文 | [English](README_EN.md)

---

## ✨ 功能特性

### 网页版

- **30+ 语言互译** — 中文、英语、日语、韩语、法语、德语、西班牙语、俄语、阿拉伯语等全球常用语言
- **灵活接入** — 支持任意兼容 OpenAI Chat Completions 接口的大模型（OpenAI、DeepSeek、通义千问等）
- **深度上下文翻译** — AI 翻译前执行 5 步深度分析（领域识别→文体判断→语气分析→受众定位→意图理解），译文更精准自然
- **原始格式保留** — 完整保留 Markdown、HTML、代码块等原始格式，翻译后自动整理排版
- **Chrome 扩展全屏模式** — Popup 右上角新增「全屏按钮」，点击后在新标签页打开完整翻译界面（无高度限制）
- **弹窗高度动态适配** — 最大高度改为 `screen.availHeight`，可拖拽到屏幕最底部
- **12 款 Catppuccin 主题一键切换** — 拿铁 Latte / 冰沙 Frappé / 玛奇朵 Macchiato / 摩卡 Mocha 四风味 × 蓝/紫/粉/绿/青强调色变体，每个主题一个独立色彩世界（base/mantle/crust 分层背景、subtext/overlay 文字阶梯、冷暖对撞副强调色），右下角悬浮分组面板切换，玻璃拟态质感，默认摩卡蓝
- **打字机效果** — 翻译结果逐字显示，体验流畅
- **翻译历史** — 自动保存最近 20 条翻译记录，点击即可回填
- **便捷操作** — 一键交换语言、粘贴、清空、复制翻译结果
- **快捷键** — `Ctrl + Enter` 快速翻译
- **数据本地化** — API 配置与历史记录保存在浏览器 localStorage，隐私安全
- **响应式设计** — 完美适配桌面与移动端
- **工作报告** — 内置工作报告生成器，支持 AI 一键总结、历史记录管理、按日期筛选
- **任务清单** — 内置任务管理模块，支持添加/完成/删除任务、优先级标记、进度统计、Markdown 批量导入/导出（含 checkbox 语法）、Apple 提醒事项一键导入（URL Scheme 点击即运行 + AppleScript 文件备用）、Google Calendar 同步、.ics 日历下载
- **英语学习助手** — 内置英语学习模块，支持单词学习、AI 释义、语音发音、学习历史、笔记导出
- **邮件总结** — 新增第 5 个 Tab：粘贴邮件线程或上传本地文件（.txt/.md/.eml/.pdf），AI 按专业规范输出四段式详细总结（主题背景/时间线表格/技术要点/风险注意点）+ 按责任方分解的 To Do List（P0/P1/P2 优先级），支持 30 种语言输出、HTML/Markdown 下载、历史记录查阅与编辑
  - **PDF 解析** — 内置 pdf.js 本地解析（最大 200MB），超大文件自动处理：读取进度提示、文本预算/页数上限提前终止、逐页内存释放
  - **超长内容自动截取** — 超过 6 万字符自动保留首尾、省略中间并标注，无需手动拆分
- **AI 解析** — 新增第 6 个 Tab：经典模式（粘贴笔记/需求 → AI 抽取任务清单，可勾选后批量创建到待办，含优先级/标签/子步骤）+ 分析模式（填写需求说明或上传附件 → AI 生成结构化分析总结，支持 .eml 邮件线程自动识别），结果可复制 / 下载 Markdown / HTML
- **AI 提示词** — 新增第 7 个 Tab：输入粗略需求 → 生成专家级结构化提示词（含「📋 提示词」「⚠ 假设」「💡 使用建议」），支持单独复制提示词正文或全量复制、下载
- **页面复用架构** — 工作报告、任务清单、英语学习、邮件总结、AI 解析、AI 提示词 Tab 通过 iframe 嵌入独立页面，与 Chrome 扩展共用同一套代码
- **零依赖** — 纯 HTML + CSS + JavaScript，无需安装任何环境

### Chrome 扩展版

- **划词翻译** — 在任意网页上选中文字，自动弹出翻译图标，点击即可查看翻译
- **Popup 翻译面板** — 点击工具栏图标，快速输入文本翻译
- **右键菜单翻译** — 选中文字后右键选择「LinguaFlow 翻译」
- **12 款 Catppuccin 主题切换** — 与网页版共享 theme.css 主题系统，鲜亮清爽配色 + 玻璃拟态质感
- **自由调整大小** — 拖拽弹窗边缘或角落自由调整尺寸，尺寸自动记忆
- **翻译不中断** — 翻译过程中 Popup 失焦关闭，后台继续完成翻译，重新打开自动恢复结果
- **翻译历史** — 自动保存最近 20 条翻译记录，点击即可回填
- **深度上下文翻译** — AI 执行 5 步上下文分析（领域/文体/语气/受众/意图），生成更精准自然的译文
- **原始格式保留** — 支持 Markdown、HTML 等格式输入，翻译后自动整理
- **划词翻译开关** — 可在设置中启用/关闭划词翻译功能
- **语言偏好记忆** — 自动保存源语言和目标语言选择
- **邮件总结入口** — Popup 头部新增信封图标，新标签页打开邮件总结页（与网页版功能一致，含 PDF 上传与 30 语言输出）
- **Side Panel 侧边栏** — Chrome 114+ 专属侧边栏，内置智能翻译/工作报告/任务清单/英语学习/邮件总结/AI 解析/AI 提示词全部 7 个模块，Tab 一键切换，模块懒加载不卡顿；可通过 Popup 侧边栏按钮、快捷键 `Alt+Shift+L` 或右键菜单「在侧边栏打开 LinguaFlow」随时打开
- **AI 解析 / AI 提示词** — 侧边栏新增「解析」「提示词」两个 Tab（懒加载）；Popup 新增两个入口按钮，点击在新标签页打开独立页面

## 📸 界面预览

<p align="center">
  <img src="preview.png" alt="LinguaFlow 截图" width="800" />
</p>

## 🚀 快速开始

### 使用方式

1. 用浏览器打开 `index.html`
2. 点击右上角 **「API 设置」** 按钮
3. 填入以下配置：

| 配置项 | 说明 | 示例 |
|--------|------|------|
| **Base URL** | 大模型 API 地址 | `https://api.openai.com/v1` |
| **API Key** | 你的 API 密钥 | `sk-xxxxxxxxxxxxxxxx` |
| **模型名称** | 使用的模型 | `gpt-4o` / `deepseek-v4-pro` |

4. 点击 **「保存配置」**
5. 选择源语言和目标语言，输入文本，点击 **「开始翻译」**

### 插件配置一键同步到所有页面

在 Chrome 扩展（LinguaFlow 插件）的弹窗设置中填入 **Base URL / API Key / Model** 并保存后，配置会自动同步到所有已打开的工具页面（翻译、工作报告、邮件总结、英语学习、AI 解析、AI 提示词），无需逐页重复填写：

- **已打开的网页**：实时生效（无需刷新），设置面板自动回填并收起
- **未打开的页面**：下次打开时自动读取插件配置
- **扩展内打开的工具页**：实时监听插件存储，保存即生效

> 提示：若工具页面以本地文件（`file://`）方式打开，请在浏览器扩展管理页开启「允许访问文件网址」。
> 插件配置为全局权威来源：页面内手工保存的配置会被插件同步覆盖。

### 支持的 API 提供商示例

| 提供商 | Base URL | 模型示例 |
|--------|----------|----------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-v4-pro` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| 智谱 AI | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| 月之暗面 | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |

> 任何兼容 OpenAI `/chat/completions` 接口的服务均可使用。

## ⌨️ 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl` + `Enter` | 开始翻译 |

## 🛠️ 技术栈

- 纯 HTML + CSS + JavaScript（零框架依赖）
- Google Fonts（Inter + Noto Sans SC）
- OpenAI 兼容 Chat Completions API

## 📁 项目结构

```
translation_tool/
├── index.html              # 网页版应用（翻译主页面，含 7 个 Tab：翻译/报告/清单/英语/邮件/AI 解析/AI 提示词）
├── workreport.html         # 工作报告页面（独立，与 Chrome 扩展共用）
├── workreport.js           # 工作报告核心逻辑（IIFE 封装）
├── english_learning.html    # 英语学习助手页面（独立，与 Chrome 扩展共用）
├── english_learning.js      # 英语学习助手逻辑
├── todolist.html            # 任务清单页面（独立，含 Markdown/AppleScript 功能）
├── todolist.js              # 任务清单核心逻辑（IIFE 封装，含跨页面 AI 解析任务同步）
├── ai-service.js           # AI Parse / AI Prompts 共享服务（配置读写/OpenAI 兼容 chat 调用/任务抽取/提示词工程）
├── ai_parse.html           # AI 解析页面（经典模式任务抽取 + 分析模式结构化总结）
├── ai_parse.js             # AI 解析页面逻辑
├── ai_prompts.html         # AI 提示词页面（输入需求 → 生成结构化提示词）
├── ai_prompts.js           # AI 提示词页面逻辑
├── install_url_scheme.sh     # Apple 提醒事项 URL Scheme 桥接器安装脚本
├── theme.css               # 共享主题系统（12 款 Catppuccin 主题变量 + 玻璃卡片/噪点/环境光等公共样式）
├── theme.js                # 主题切换器/iframe 主题同步/星星背景/Markdown 预览绑定
├── markdown.js             # Markdown 渲染器
├── md-editor.js            # Markdown 编辑器组件
├── email_summary.html      # 邮件总结页面（独立，与 Chrome 扩展共用）
├── email_summary.js        # 邮件总结核心逻辑（SKILL 提示词/AI 调用/PDF 解析/历史管理）
├── pdf.min.js              # pdf.js 3.11.174（PDF 文本提取，本地打包）
├── pdf.worker.min.js       # pdf.js Worker
├── ai_summary_prompt.md    # 工作报告 AI 总结提示词说明
├── preview.png             # 网页版截图
├── chrome_extension/       # Chrome 浏览器扩展
│   ├── manifest.json       # 扩展配置
│   ├── popup.html          # 弹窗界面
│   ├── popup.css           # 弹窗样式
│   ├── popup.js            # 弹窗逻辑
│   ├── sidepanel.html      # 侧边栏入口页面（Chrome 114+，7 个 Tab）
│   ├── sidepanel.css       # 侧边栏样式（现代极简有质感设计）
│   ├── sidepanel.js        # 侧边栏逻辑（Tab 切换/懒加载/配置同步）
│   ├── ai-service.js       # AI Parse / AI Prompts 共享服务（与网页版共用）
│   ├── ai_parse.html       # AI 解析页面（Chrome 扩展版）
│   ├── ai_parse.js         # AI 解析页面逻辑
│   ├── ai_prompts.html     # AI 提示词页面（Chrome 扩展版）
│   ├── ai_prompts.js       # AI 提示词页面逻辑
│   ├── fullpage.html       # 全屏翻译页面
│   ├── fullpage.js         # 全屏页面逻辑
│   ├── content.js          # 划词翻译脚本
│   ├── content.css         # 划词翻译样式
│   ├── background.js       # 后台服务
│   ├── workreport.html     # Chrome 扩展工作报告页面
│   ├── workreport.js       # Chrome 扩展工作报告逻辑
│   ├── english_learning.html # 英语学习助手页面
│   ├── english_learning.js   # 英语学习助手逻辑（外部JS，CSP 兼容）
│   ├── todolist.html       # 任务清单页面
│   ├── todolist.js         # 任务清单逻辑
│   ├── email_summary.html  # 邮件总结页面
│   ├── email_summary.js    # 邮件总结逻辑
│   ├── pdf.min.js          # pdf.js（PDF 解析，MV3 CSP 需本地打包）
│   ├── pdf.worker.min.js   # pdf.js Worker
│   ├── install_url_scheme.sh     # URL Scheme 桥接器安装脚本
│   ├── native_host.py      # Chrome Native Messaging 宿主（可选）
│   ├── native_host_manifest.json  # Native Messaging 注册模板
│   ├── install_native_host.sh     # Native Messaging 安装脚本
│   ├── icons/              # 扩展图标
│   └── _locales/           # 国际化文件
├── vibe_images/            # 图标源文件
├── README.md               # 中文说明文档
└── README_EN.md            # 英文说明文档
```

## 🧩 Chrome 扩展版

除了网页版，本项目还提供 **Chrome 浏览器扩展**，支持**划词翻译**。

### 扩展功能

- **Popup 翻译面板** — 点击浏览器工具栏图标，快速输入文本翻译
- **划词翻译** — 在任意网页上选中文字，自动弹出翻译小图标，点击即可查看翻译
- **右键菜单翻译** — 选中文字后右键选择「LinguaFlow 翻译」
- **12 款 Catppuccin 主题与质感 UI** — 与网页版共享主题系统，鲜亮清爽配色、玻璃拟态卡片、噪点背景与景深阴影
- **自由调整大小** — 拖拽弹窗任意边缘或角落调整尺寸（宽 320~800px，高 300~780px），自动保存
- **翻译不中断** — Popup 关闭后后台 Service Worker 继续翻译，重新打开自动恢复结果
- **翻译历史** — 自动保存最近 20 条翻译记录，支持单条删除和一键清空
- **30+ 语言** — 与网页版相同，支持全球常用语言
- **打字机效果** — 翻译结果逐字显示
- **划词翻译开关** — 可在设置中启用/关闭划词翻译功能

### 安装方式

1. 将 `chrome_extension` 文件夹复制到本地
2. 打开 Chrome，地址栏输入 `chrome://extensions/`
3. 开启右上角 **「开发者模式」**
4. 点击 **「加载已解压的扩展程序」**
5. 选择 `chrome_extension` 文件夹
6. 点击工具栏中的 LinguaFlow 图标，配置 API 即可开始使用

### 划词翻译使用方法

1. 在任意网页上用鼠标选中一段文字
2. 选中区域旁会出现一个紫色翻译图标
3. 点击图标，弹出翻译浮窗显示翻译结果
4. 可一键复制翻译结果

### Side Panel 侧边栏使用方法（Chrome 114+）

1. 打开侧边栏（任选其一）：
   - 点击 Popup 弹窗右上角的「侧边栏」按钮
   - 按快捷键 `Alt+Shift+L`
   - 在任意页面右键 → 「在侧边栏打开 LinguaFlow」
2. 侧边栏顶部 Tab 栏可切换 7 个模块：智能翻译 / 工作报告 / 任务清单 / 英语学习 / 邮件总结 / AI 解析 / AI 提示词
3. 模块按需懒加载：首次打开的模块才加载对应页面，日常打开侧边栏不卡顿
4. 侧边栏顶部「API 设置」保存后与弹窗、全屏页、各工具页实时同步配置与主题
5. 侧边栏右下角圆形主题按钮可随时切换 12 款 Catppuccin 主题，实时同步到各模块

## 📋 浏览器兼容性

- Chrome 90+
- Edge 90+
- Firefox 88+
- Safari 15+

## 📝 更新日志

### v0.19.7 (2026-08-29)
- 修复英语学习页面学习内容输入区拉长后右侧边界线消失的问题（移除 `.el-input-area` 的 `overflow: hidden`，增加 1px padding 防止滚动条裁切边框）
- 输入区新增 `resize: vertical` 支持垂直拖拽调整高度

### v0.19.5 (2026-08-29)
- **修复**：英语学习页面内部宽度统一与 AI Parse 页面一致（内容容器固定 24px 水平内边距，不再随视口变化）
- **修复**：暗色主题下英语学习页面右侧白色边缘（CSS 变量提升到 html 层级，html/body 背景色正确跟随主题）

### v0.19.4 (2026-08-28)

- 英语学习页面修复：
  - Side Panel 模式下内容宽度与 AI Parse 页面对齐（`.el-container` 增加 `padding: 0 24px`）
  - 修复暗色主题下右侧白色边缘问题（`html, body` 增加 `overflow-x: hidden`）
  - 新增主题化滚动条样式（滚动条颜色跟随主题变量，避免暗色模式下出现白色滚动条）

### v0.19.3 (2026-08-28)

- 英语学习页面优化：
  - 发音语种选择扩展至 30 种语言（与翻译页面一致）
  - 内容容器宽度从 960px 改为 100%，与工作报告页面内容宽度一致
  - 输入区尺寸与 GUI 界面排版同宽
  - 字体增加 Noto Sans 系列（JP/KR/Arabic/Hebrew/Thai/Devanagari/Bengali），兼容全球所有语言
  - 修复暗色主题下页面周边白色边框问题（body 背景色跟随主题）
  - 网页版与 Chrome 插件版同步更新

### v0.19.2 (2026-08-28)
- 修复：Side Panel 英语学习页面四周留白问题（`@media max-width: 480px` 去除 padding，header/section 圆角归零，内容充满整个面板）

### v0.19.1 (2026-08-28)
- **英语学习发音面板恢复语种选择**：新增「选择语种」下拉菜单（English US/UK、中文、日本語、한국어、Français、Deutsch、Español），语音列表按所选语种自动过滤
- 发音语言跟随用户选择，不再硬编码为中英文自动判断

### v0.19.0 (2026-08-28)
- **英语学习页面 UI 全面重构**：深海蓝 (#0F172A) + 琥珀金 (#F59E0B) 专业配色，Inter + Noto Sans SC 字体
- 统一 Lucide 线性图标系统（1.5px 描边，24×24px），替换所有 emoji 图标
- 微渐变 + 多层阴影卡片悬浮感设计，摒弃纯扁平风格
- 严格 8px 栅格间距，模块间距 ≥64px（桌面）/ 40px（移动）
- 支持暗色主题（Catppuccin Frappé/Macchiato/Mocha 自动适配）
- 网页版（index.html iframe）与 Chrome 插件版同步更新
- WCAG 2.1 AA 对比度标准，1024px/375px 响应式布局

### v0.18.0 (2026-08-28)

- **Side Panel 现代极简重设计** — 侧边栏 UI 全面重构，采用「现代、极简、有质感」设计规范
  - 色彩：浅灰白背景 #F8F9FA / 深色 #121212，主色低饱和 #4F46E5（仅核心交互使用）
  - 质感：12px 圆角卡片，微阴影 `0 4px 6px -1px rgba(0,0,0,0.05)`，1px 极细边框
  - 顶部栏毛玻璃效果：`backdrop-filter: blur(12px)`
  - 排版：系统无衬线字体，正文 14px / 行高 1.5，严格 8px 栅格间距
  - 动效：Hover 背景加深 5%，点击 `scale(0.98)`，过渡 `0.2s ease`
  - 暗色模式自动适配（跟随 Catppuccin Frappé / Macchiato / Mocha 主题）
  - 零外部依赖（移除 Google Fonts 加载），复制即可运行
- **配置全页面同步修复** — 修复在弹窗 / 全屏页 / 侧边栏保存 API 配置后，AI 解析 / AI 提示词页面未立即生效的问题
  - `ai-service.js` 的 `initConfigSync` 现在同步写入 `localStorage('translate_config')`，确保 `chat()` 读取到最新配置
  - 所有页面（翻译 / 报告 / 清单 / 英语 / 邮件 / 解析 / 提示词）均在配置保存后立即使用新 API 设置

### v0.17.0 (2026-08-28)

- **新增 AI 解析 / AI 提示词** — 集成 TaskFlow 项目的 AI Parse 与 AI Prompts 功能
  - AI 解析：经典模式（粘贴笔记 → 抽取任务清单）+ 分析模式（需求说明 → 结构化总结，支持邮件识别）
  - AI 提示词：输入粗略需求 → 生成专家级可复制提示词（含假设与使用建议）
  - 网页版 `index.html` 新增两个 Tab（iframe 嵌入）；侧边栏新增「解析」「提示词」Tab；弹窗新增入口按钮
  - 共用大模型 API 配置（Base URL / API Key / Model），配置变动所有页面实时同步

### v0.16.1 (2026-08-28)

- **修复侧边栏无法设置主题** — 侧边栏右下角新增圆形主题切换按钮，可直接在侧边栏内切换 12 款 Catppuccin 主题，并实时同步到各模块与弹窗/全屏页

### v0.16.0 (2026-08-28)

- **新增 Chrome Side Panel 侧边栏** — 基于 Chrome 114+ Side Panel API，将全部 5 个模块（智能翻译 / 工作报告 / 任务清单 / 英语学习 / 邮件总结）收纳进浏览器侧边栏
  - 顶部 Tab 一键切换，模块按需懒加载，打开侧边栏无需加载全部页面
  - 三种打开方式：Popup 新增「侧边栏」按钮、快捷键 `Alt+Shift+L`、右键菜单「在侧边栏打开 LinguaFlow」
  - 侧边栏自带 API 设置面板，与弹窗/全屏页实时同步配置与主题（子页面复用 fullpage/workreport/todolist/english_learning/email_summary）
  - manifest 新增 `side_panel` 配置、`sidePanel` 权限与快捷键命令，声明 `minimum_chrome_version: 114`

### v0.15.0 (2026-08-22)

- **全站视觉重构（Premium UI Refactor）** — 在完全保留网页结构、内容与业务逻辑的前提下，对全部 5 个页面（智能翻译 / 工作报告 / 任务清单 / 英语学习 / 邮件总结）进行高端视觉升级
  - **深邃分层暗黑背景** — 近黑分层渐变 `#0A090D → #161323`，摆脱纯黑或平庸纯色；核心视觉区叠加 Glow Mesh 渐变光晕 + 微弱噪点纹理
  - **玻璃拟态升级** — 卡片改为半透明底 `rgba(255,255,255,0.03~0.04)` + 1px 高光边框 + `backdrop-blur(30px) saturate(1.6)`，顶缘柔和高光反射
  - **字体与排版重塑** — 引入 Google Fonts：标题用 Syne / Plus Jakarta Sans，正文用 Inter；标题渐变文字、增大标题/正文字号对比、微调字距与行高增加呼吸感
  - **动效与交互质感** — 修复 `--transition` 缺失问题，全站统一 300ms `ease-out` 微交互；按钮/卡片悬停轻上浮（-2~-4px）+ 边缘发光 + 外阴影加深
  - **细节去“廉价感”** — 多层叠加柔和弥散阴影（Soft Ambient Shadows）、统一图标风格与间距对齐
  - **响应式保留** — 移动端 Tab 导航自适应换行折叠；浅色 latte 主题单独优雅轻玻璃处理，无失读
- **暗色主题去眩光（De-glare）** — 针对用户反馈，降低暗色主题下按键/卡片过亮反光：主按钮叠加暗纱压低泛白渐变、去除白色顶部高光、悬停移除 brightness 增亮仅保留轻微饱和度、光泽扫过带减淡、卡片顶缘高光收敛

### v0.14.0 (2026-08-22)

- **主题系统重建为 Catppuccin 专属（v2）** — 移除经典 6 主题，全量替换为 12 款 Catppuccin 官方配色主题，默认摩卡蓝
  - **拿铁 Latte（浅色）**：蓝 #1e66f5 / 紫 #8839ef / 粉 #ea76cb
  - **冰沙 Frappé（深灰）**：蓝 #8caaee / 紫 #ca9ee6 / 绿 #a6d189
  - **玛奇朵 Macchiato（深蓝）**：蓝 #8aadf4 / 紫 #c6a0f6 / 青 #8bd5ca
  - **摩卡 Mocha（暗夜）**：蓝 #89b4fa / 紫 #cba6f7 / 绿 #a6e3a1
  - 每个主题独立色彩世界：base/mantle/crust 分层背景、subtext/overlay 文字阶梯、sky/mauve/teal/peach 冷暖对撞副强调色，玻璃/阴影/渐变/alpha 层全部官方色板派生，星芒/光球/噪点强度按浅深自动适配
- **质感增强 v2** — 全部 12 款主题视觉升级：渐变画布纵深（替代纯色背景）、卡片阴影色相染色（替代纯黑）、5 层多色环境光晕（含副强调色）、三色混彩星空、发丝边框副色段、按钮 hover 渐变流动 + 辉光、标题双层光晕、文字选区主题色、焦点环发光、扫描线纹理开启
- **主题面板四组分区** — Latte/Frappé/Macchiato/Mocha 四组展示，面板高度自适应（可滚动），swatch 色板 12 款
- **主题系统同步** — 网页版与 Chrome 扩展 theme.css/theme.js 同步更新，iframe 子页面与 Popup 全量跟随

### v0.13.0 (2026-08-08)

- **六主题配色推翻重建（色彩世界 v2）** — 每个主题重构为独立色彩世界，告别同质化柔和粉彩
  - 色相染色中性色：背景/文字/阴影全部随主题 hue 偏移，无通用灰
  - 主色加深一档（颜料感），副强调色 accent2 带有意 hue 间距（如陶土×雾岩蓝冷暖对撞）
  - 四色标标题渐变：尾部融入副强调色 hue 过渡，每个主题标题光独一无二
  - 六主色：青瓷#2e9c8b / 玄墨#8b87f0 / 月白#4f63d8 / 陶土#cc6742 / 绯樱#d4698e / 静谧海#4799e2，swatch 色板同步更新
- **生产健壮性加固（harden）** — 全部 AI 调用面（翻译/工作报告/邮件总结/扩展全屏页/Popup）新增友好错误诊断：401/403（Key 无效）、404（地址/模型错误）、429（限流/余额）、5xx、CORS/断网均给出问题定位与恢复路径，不再透传原始报错
- **破坏性操作防护** — 智能翻译页清空历史增加二次确认；模型占位符修正为真实存在的 deepseek-chat
- **质感精修（polish）** — 翻译等待态改 shimmer 骨架屏（不再清空成空白）；空状态提色去斜体；Popup 微小字号 9/10px 提升至 11px；错误文案硬编码色改语义色 var(--red)
- **无障碍与动效克制** — 按钮 :focus-visible 焦点环、prefers-reduced-motion 关闭循环动画、全站按钮统一 :active 按压反馈

### v0.12.0 (2026-08-07)

- **新增邮件总结模块** — 网页版新增第 5 个 Tab，Chrome 扩展 Popup 新增信封图标入口（新标签页打开）
  - AI 按 email-thread-summarizer SKILL 规范总结邮件线程：四段式详细总结（主题与背景/时间线表格/技术要点/风险与注意点）+ 按责任方分解的 To Do List（我方/对方/联合验证，P0/P1/P2 优先级）
  - 输入方式：手动粘贴邮件线程，或上传本地文件（.txt/.md/.eml/.log/.pdf 等）
  - 总结输出语言可选 30 种全球语言
  - 结果支持复制、HTML/Markdown 文件下载（完整保留表格/引用/任务列表格式）
  - 总结历史自动保存（上限 30 条），支持查阅、Markdown 编辑修改、删除
- **PDF 邮件文件支持** — 内置 pdf.js 3.11.174 本地解析（网页版与扩展版均支持）
  - 文件大小上限 200MB，读取进度实时提示
  - 超大文件自动处理：提取文本达 12 万字符预算或 500 页上限自动终止并标注，逐页释放内存
  - 扫描件/图片型 PDF 自动识别并提示需 OCR
- **超长内容自动处理** — 内容超过 6 万字符时自动保留首 60% + 尾 40%，中间省略并明确标注，编辑器仍保留全文，无需手动拆分
- **翻译历史增强** — 智能翻译页历史记录同时展示原文与译文，点击回填时同步恢复译文（网页版 + 扩展全屏页）

### v0.11.0 (2026-08-07)

- **多主题系统全面升级** — 新增 6 主题一键切换（海洋/清新/暗黑/浅色/暖橙/樱花），右下角悬浮按钮切换，iframe 子页面自动同步父页主题
- **视觉风格重塑：鲜亮清爽 + 质感** — 中高饱和鲜亮配色，玻璃拟态卡片（半透明 + backdrop-blur + 顶部光泽）、SVG 噪点背景、三层径向环境光、多层景深阴影、发丝渐变边框、标题渐变辉光
- **扩展与主站外观统一** — chrome_extension 各页面与根目录页面统一圆角 20px、容器宽度、主题质感；popup 升级为噪点背景 + 多层阴影 + 主题渐变按钮
- **工作报告 HTML 导出修复** — AI 总结导出 HTML 改用原始 Markdown 转换（rawText），导出格式与界面渲染完全一致，支持标题/列表/加粗
- **跨环境交互一致性** — Markdown 预览按钮改为「无内联 onclick 即绑定」机制，扩展页面在 chrome-extension:// 与 file:// 下行为一致
- **动效克制化** — 移除常亮霓虹动画（gradientShift/borderGlow），保留 fadeUp/光球浮动等克制动效
- **Popup 形态优化** — 默认最小高度提升、翻译区完整展开，弹窗默认尺寸更宽松

### v0.10.0 (2026-07-14)

- **任务清单 Markdown 支持** — 新增 Markdown 批量导入和导出功能
  - 支持标准 `- [ ]` / `- [x]` checkbox 语法解析
  - 导入时自动识别可选标记：`@日期`、`@时间`、`#priority`
  - 一键导出当前任务列表为 Markdown 格式，复制到剪贴板
  - 自动去重，相同标题+日期的任务不会重复导入
- **Apple 提醒事项一键导入** — 点击「🍎 提醒」即可一键导入提醒事项
  - **URL Scheme 通道**：安装桥接器后，点击按钮直接触发 AppleScript 执行，瞬间创建提醒（macOS 通知确认）
  - **AppleScript 文件备用**：同时下载 `.applescript` 文件，双击可用脚本编辑器运行
  - **一键安装桥接器**：运行 `./install_url_scheme.sh` 注册 `linguaflow-reminders://` 协议
  - 自动逐条创建提醒事项，含截止日期和高/中/低优先级映射
- **任务清单 UI 全面优化** — CSS/HTML 重构，视觉升级
  - CSS 变量分块、语义化注释、统一配色
  - 输入栏加大内边距，日期/时间选择器暗色适配，自定义下拉箭头
  - 工具栏按钮尺寸统一、配色增强（ics 青/Google 蓝/MD 紫/Apple 红）+ hover 发光阴影
  - 任务卡片 hover 微动效、完成状态绿色背景、同步徽章标签化
  - 过滤 pills 优化、设置面板暗色背景、空状态重设计
  - 移除全部 inline style，提取为 CSS 类

### v0.9.0 (2026-07-09)

- **新增英语学习助手** — 网页版与 Chrome 扩展同步新增「英语学习」模块
  - AI 单词学习：调用大模型生成音标、释义、例句、同反义词、记忆技巧
  - 语音发音：集成 Web Speech API，支持多语音选择和语速调节
  - 学习历史：自动保存学习记录，支持单条删除和一键清空
  - 笔记导出：支持 Markdown 和 HTML 格式导出今日学习内容
  - 预设 API 配置：DeepSeek / OpenAI / Ollama / 硅基流动 / 自定义
- **Chrome 扩展 MV3 CSP 兼容** — 英语学习模块 JS 提取为外部文件 `english_learning.js`，解决 MV3 默认 CSP 禁止内联 `<script>` 的问题
  - `english_learning.html` 通过 `<script src="english_learning.js">` 加载
  - `manifest.json` 新增 `host_permissions: ["<all_urls>"]` 支持 API 跨域请求
- **DeepSeek 默认模型更新** — 默认模型从 `deepseek-chat` 更新为 `deepseek-v4-pro`

### v0.8.0 (2026-07-09)

- **新增工作报告模块** — 网页版新增「工作报告」Tab，支持完整的报告生成与管理功能
  - AI 一键总结：调用大模型对工作报告进行智能摘要
  - 历史记录管理：支持保存、删除、清空工作报告记录
  - 按日期筛选：可按月/周/日筛选查看报告
  - 总结历史回顾：支持查看和管理历次 AI 总结
- **新增任务清单模块** — 网页版新增「任务清单」Tab，提供轻量级任务管理
  - 任务增删改查：支持添加、完成、删除任务
  - 优先级标记：任务可设置不同优先级
  - 进度统计：直观展示任务完成情况
- **页面复用架构** — 工作报告 Tab 通过 iframe 嵌入独立的 `workreport.html` 页面，与 Chrome 扩展共用同一套 HTML/CSS/JS 代码，实现 Web 版与插件功能一致
- **JavaScript 模块化封装** — `workreport.js` 和 `todolist.js` 均采用 IIFE（立即调用函数表达式）封装，避免全局变量冲突
  - 修复 `let config` 在 `index.html` 内联脚本与 `workreport.js` 中重复声明导致的全局变量冲突（`Identifier 'config' has already been declared`）
  - 通过 IIFE 作用域隔离，彻底解决多模块 JS 共存时的变量污染问题
- **正则表达式修复** — 修复 `autoFormatResult` 函数中 `/([^\n])\n(#{1,6}\s)/g` 正则表达式的 `\n` 被展开为字面换行符导致的 JS 语法错误
- **Google Fonts 非阻塞加载** — 优化 Google Fonts 加载策略，避免阻塞页面渲染，解决页面打开缓慢问题
- **UI 优化** — 清理任务清单空状态中 macOS emoji 渲染为大尺寸彩色图标的显示异常

### v0.7.1 (2026-07-07)

- **全屏页面修复** — 修复了 Chrome 扩展全屏模式（fullpage.html）中 API 设置按钮无响应、语言下拉为空的问题
  - 修复 `fullpage.js` 中 `autoFormatResult` 函数的正则表达式损坏（`\n` 被替换为字面换行符，导致 JS 语法错误）
  - 移除全屏页面中所有内联事件处理器（`onclick`/`oninput`），改用 `addEventListener`，符合 Chrome 扩展 CSP 策略
  - 历史记录列表改用事件委托机制，不再依赖内联 `onclick`
  - 全屏页面存储层从 `localStorage` 迁移到 `chrome.storage.local`，与 Popup 共享配置和历史

### v0.7 (2026-06-25)

- **Chrome 扩展全屏模式** — Popup 右上角新增「全屏按钮」，点击后在新标签页打开完整翻译界面（无高度限制）
- **弹窗高度动态适配** — 最大高度改为 `screen.availHeight`，可拖拽到屏幕最底部
- **扩展内资源路径修复** — 使用 `chrome.runtime.getURL()` 正确访问扩展内部 HTML 文件

### v0.6 (2026-06-25)

- **网页版深色科技风 UI** — 网页版全面升级为暗色主题，与 Chrome 插件视觉风格统一
  - 深色卡片替代原玻璃拟态白色背景
  - 霓虹紫/青色渐变配色体系
  - 32px 网格纹理背景 + 旋转光晕动画
  - 输入框、下拉框、按钮等全部组件深色化 + 霓虹发光交互
  - 翻译按钮升级为紫→青渐变 + 双层发光阴影
  - 历史卡片、设置面板、语言栏全部深色适配
- **深度上下文理解翻译** — 所有翻译模块（网页版、Popup、划词翻译、后台服务）升级为 5 步分析工作流
  - Step 1：领域与主题识别（科技/医学/法律/文学/日常/新闻/学术等）
  - Step 2：文体与语气判断（正式/非正式/幽默/严肃/说服/指导等）
  - Step 3：受众与关键概念分析（专业术语、习语、文化引用）
  - Step 4：意图理解（告知/说服/娱乐/指导/警告）
  - Step 5：基于分析结果进行上下文感知翻译，保留作者风格

### v0.5 (2026-06-25)

- **Chrome 扩展深色科技风 UI** — 全新暗色主题，霓虹紫/青色渐变配色，网格纹理背景，圆角弹窗设计
- **AI 科技风格** — Logo 呼吸指示灯、翻译按钮流光边框、Header 扫描光动画等 AI 风格特效
- **自由调整弹窗大小** — 支持拖拽弹窗 8 个方向（边缘 + 角落）自由调整尺寸，尺寸自动保存恢复
- **翻译后台持久化** — 翻译过程中 Popup 失焦关闭不中断，后台 Service Worker 继续执行，重新打开自动恢复翻译结果
- **Chrome 扩展翻译历史** — Popup 新增翻译历史记录区域，支持单条删除和一键清空
- 拖拽高度上限从 600px 提升至 780px

### v0.4 (2026-06-25)

- **上下文智能翻译** — AI 翻译前自动分析文本语境、语气和意图，生成更准确自然的译文
- **原始格式保留** — 完整保留 Markdown、HTML、代码块等原始格式输入
- **自动整理排版** — 翻译后自动清理多余空行、规范化列表缩进、修复标点间距等
- **格式修复** — 自动修复源文本中破损的格式，确保输出整洁美观
- 所有翻译模块（网页版、Popup、划词翻译、后台服务）同步升级

### v0.3 (2026-06-12)

- **翻译历史单条删除** — 鼠标悬停历史记录时显示垃圾桶图标，可单独删除某条记录
- **网页版自动保存草稿** — 输入内容自动缓存到 localStorage，意外关闭标签页后可恢复
- **Chrome 扩展 Popup 状态保持** — 输入内容自动缓存，Popup 关闭后重新打开内容不丢失
- 翻译完成后自动保存结果到草稿
- 清空按钮同时清除草稿缓存

### v0.2 (2026-06-12)

- 新增 **Chrome 浏览器扩展**，支持划词翻译
- 划词翻译：选中网页文字自动弹出翻译图标，点击显示翻译浮窗
- 右键菜单翻译：选中文字后右键即可翻译
- Popup 翻译面板：点击工具栏图标快速翻译
- 划词翻译开关：可在设置中启用/关闭
- 语言偏好自动记忆

### v0.1 (2026-06-11)

- 初始版本发布
- 支持 30+ 语言互译
- 玻璃拟态 UI 设计，动态星空背景
- 打字机效果输出翻译结果
- 翻译历史记录（最多 20 条）
- 响应式布局，支持移动端

## 📄 许可证

MIT License
