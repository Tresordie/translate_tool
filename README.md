# LinguaFlow · AI 智能翻译

> 基于大模型 API 的在线翻译工具，支持网页版和 Chrome 扩展，全球 30+ 语言互译，支持划词翻译。

![Version](https://img.shields.io/badge/version-0.9.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

[English](README_EN.md) | 中文

---

## ✨ 功能特性

### 网页版

- **30+ 语言互译** — 中文、英语、日语、韩语、法语、德语、西班牙语、俄语、阿拉伯语等全球常用语言
- **灵活接入** — 支持任意兼容 OpenAI Chat Completions 接口的大模型（OpenAI、DeepSeek、通义千问等）
- **深度上下文翻译** — AI 翻译前执行 5 步深度分析（领域识别→文体判断→语气分析→受众定位→意图理解），译文更精准自然
- **原始格式保留** — 完整保留 Markdown、HTML、代码块等原始格式，翻译后自动整理排版
- **Chrome 扩展全屏模式** — Popup 右上角新增「全屏按钮」，点击后在新标签页打开完整翻译界面（无高度限制）
- **弹窗高度动态适配** — 最大高度改为 `screen.availHeight`，可拖拽到屏幕最底部
- **深色科技风界面** — 暗色主题 + 霓虹紫/青色渐变 + 网格纹理背景 + 动态光晕，网页版与插件视觉统一
- **打字机效果** — 翻译结果逐字显示，体验流畅
- **翻译历史** — 自动保存最近 20 条翻译记录，点击即可回填
- **便捷操作** — 一键交换语言、粘贴、清空、复制翻译结果
- **快捷键** — `Ctrl + Enter` 快速翻译
- **数据本地化** — API 配置与历史记录保存在浏览器 localStorage，隐私安全
- **响应式设计** — 完美适配桌面与移动端
- **工作报告** — 内置工作报告生成器，支持 AI 一键总结、历史记录管理、按日期筛选
- **任务清单** — 内置任务管理模块，支持添加/完成/删除任务、优先级标记、进度统计、Markdown 批量导入/导出（含 checkbox 语法）、Apple 提醒事项一键导入（URL Scheme 点击即运行 + AppleScript 文件备用）、Google Calendar 同步、.ics 日历下载
- **英语学习助手** — 内置英语学习模块，支持单词学习、AI 释义、语音发音、学习历史、笔记导出
- **页面复用架构** — 工作报告、任务清单、英语学习 Tab 通过 iframe 嵌入独立页面，与 Chrome 扩展共用同一套代码
- **零依赖** — 纯 HTML + CSS + JavaScript，无需安装任何环境

### Chrome 扩展版

- **划词翻译** — 在任意网页上选中文字，自动弹出翻译图标，点击即可查看翻译
- **Popup 翻译面板** — 点击工具栏图标，快速输入文本翻译
- **右键菜单翻译** — 选中文字后右键选择「LinguaFlow 翻译」
- **深色科技风 UI** — 暗色主题 + 霓虹渐变 + 网格纹理 + 圆角设计，AI 科技感十足
- **自由调整大小** — 拖拽弹窗边缘或角落自由调整尺寸，尺寸自动记忆
- **翻译不中断** — 翻译过程中 Popup 失焦关闭，后台继续完成翻译，重新打开自动恢复结果
- **翻译历史** — 自动保存最近 20 条翻译记录，点击即可回填
- **深度上下文翻译** — AI 执行 5 步上下文分析（领域/文体/语气/受众/意图），生成更精准自然的译文
- **原始格式保留** — 支持 Markdown、HTML 等格式输入，翻译后自动整理
- **划词翻译开关** — 可在设置中启用/关闭划词翻译功能
- **语言偏好记忆** — 自动保存源语言和目标语言选择

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
├── index.html              # 网页版应用（翻译主页面）
├── workreport.html         # 工作报告页面（独立，与 Chrome 扩展共用）
├── workreport.js           # 工作报告核心逻辑（IIFE 封装）
├── english_learning.html    # 英语学习助手页面（独立，与 Chrome 扩展共用）
├── todolist.html            # 任务清单页面（独立，含 Markdown/AppleScript 功能）
├── todolist.js              # 任务清单核心逻辑（IIFE 封装）
├── install_url_scheme.sh     # Apple 提醒事项 URL Scheme 桥接器安装脚本
├── preview.png             # 网页版截图
├── chrome_extension/       # Chrome 浏览器扩展
│   ├── manifest.json       # 扩展配置
│   ├── popup.html          # 弹窗界面
│   ├── popup.css           # 弹窗样式
│   ├── popup.js            # 弹窗逻辑
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
- **深色科技风 UI** — 暗色主题搭配霓虹紫/青色渐变，网格背景，AI 脉冲指示灯
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

## 📋 浏览器兼容性

- Chrome 90+
- Edge 90+
- Firefox 88+
- Safari 15+

## 📝 更新日志

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
