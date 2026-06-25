# LinguaFlow · AI 智能翻译

> 基于大模型 API 的在线翻译工具，支持网页版和 Chrome 扩展，全球 30+ 语言互译，支持划词翻译。

![Version](https://img.shields.io/badge/version-0.4-blue)
![License](https://img.shields.io/badge/license-MIT-green)

[English](README_EN.md) | 中文

---

## ✨ 功能特性

### 网页版

- **30+ 语言互译** — 中文、英语、日语、韩语、法语、德语、西班牙语、俄语、阿拉伯语等全球常用语言
- **灵活接入** — 支持任意兼容 OpenAI Chat Completions 接口的大模型（OpenAI、DeepSeek、通义千问等）
- **上下文智能翻译** — AI 自动分析文本语境、语气和意图，生成更准确自然的译文
- **原始格式保留** — 完整保留 Markdown、HTML、代码块等原始格式，翻译后自动整理排版
- **精美界面** — 动态星空背景、玻璃拟态卡片、渐变流光按钮
- **打字机效果** — 翻译结果逐字显示，体验流畅
- **翻译历史** — 自动保存最近 20 条翻译记录，点击即可回填
- **便捷操作** — 一键交换语言、粘贴、清空、复制翻译结果
- **快捷键** — `Ctrl + Enter` 快速翻译
- **数据本地化** — API 配置与历史记录保存在浏览器 localStorage，隐私安全
- **响应式设计** — 完美适配桌面与移动端
- **零依赖** — 单个 HTML 文件，无需安装任何环境

### Chrome 扩展版

- **划词翻译** — 在任意网页上选中文字，自动弹出翻译图标，点击即可查看翻译
- **Popup 翻译面板** — 点击工具栏图标，快速输入文本翻译
- **右键菜单翻译** — 选中文字后右键选择「LinguaFlow 翻译」
- **上下文智能翻译** — AI 理解语境，生成更准确的译文
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
| **模型名称** | 使用的模型 | `gpt-4o` / `deepseek-chat` |

4. 点击 **「保存配置」**
5. 选择源语言和目标语言，输入文本，点击 **「开始翻译」**

### 支持的 API 提供商示例

| 提供商 | Base URL | 模型示例 |
|--------|----------|----------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
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
├── index.html              # 网页版应用（单文件）
├── preview.png             # 网页版截图
├── chrome_extension/       # Chrome 浏览器扩展
│   ├── manifest.json       # 扩展配置
│   ├── popup.html          # 弹窗界面
│   ├── popup.css           # 弹窗样式
│   ├── popup.js            # 弹窗逻辑
│   ├── content.js          # 划词翻译脚本
│   ├── content.css         # 划词翻译样式
│   ├── background.js       # 后台服务
│   ├── icons/              # 扩展图标
│   └── _locales/           # 国际化文件
├── README.md               # 中文说明文档
└── README_EN.md            # 英文说明文档
```

## 🧩 Chrome 扩展版

除了网页版，本项目还提供 **Chrome 浏览器扩展**，支持**划词翻译**。

### 扩展功能

- **Popup 翻译面板** — 点击浏览器工具栏图标，快速输入文本翻译
- **划词翻译** — 在任意网页上选中文字，自动弹出翻译小图标，点击即可查看翻译
- **右键菜单翻译** — 选中文字后右键选择「LinguaFlow 翻译」
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
