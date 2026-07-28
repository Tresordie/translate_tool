# 工作报告 AI 总结提示词

> 来源：`workreport.js` 的 `doSummarize()` 函数（约 L420-L535）
> 适用页面：`index.html` 工作报告页 与 Chrome 扩展 `workreport.html`（两版逻辑一致）

## 一、整体结构

采用 **system + user 双消息**结构，通过 OpenAI 兼容接口调用大模型。
根据**输出语言**是否为中文，分为两套模板，目的是避免中英文混排触发模型语码转换（code-switching）。

```
messages: [
  { role: "system", content: systemPrompt },
  { role: "user",   content: userMsgContent }
]
```

## 二、输出为中文时（outputLang === 'zh'，默认）

### System 提示词

```text
你是工作汇报总结助手。请阅读以下工作记录，提取关键要点并生成结构化的中文总结。

输出格式：
## 📋 工作总结 (日期范围)
### 🔑 要点总结
- [要点]
### 📝 要点详述
**1. [标题]** 详细阐述
```

### User 消息

```text
请用中文总结以下工作记录（日期范围）：

[1] 2026-07-28 09:30
第一条记录内容

---

[2] 2026-07-28 14:00
第二条记录内容
```

## 三、输出为非中文时（如 English）

### System 提示词

```text
Role: English-only work summarizer.
Rule: You read [输入语言名] input but write ONLY in [输出语言名].
Format:
## 📋 Work Summary
### 🔑 Key Points
- point
### 📝 Detailed Breakdown
**1. title** elaboration.
```

### User 消息

```text
Produce a [输出语言名] summary of these work records (日期范围).
Respond ENTIRELY in [输出语言名]. Do NOT write any [输入语言名].

=== BEGIN INPUT (read in [输入语言名], respond in [输出语言名]) ===
[1] 2026-07-28 09:30
第一条记录内容

---

[2] 2026-07-28 14:00
第二条记录内容
=== END INPUT ===

Now write the [输出语言名] summary:
```

## 四、API 调用参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 接口 | `{baseUrl}/chat/completions` | OpenAI 兼容接口 |
| `model` | 用户配置 | 如 `deepseek-chat` |
| `temperature` | `0.1` | 低随机性，输出稳定 |
| 鉴权 | `Authorization: Bearer {apiKey}` | — |

## 五、输入记录拼接规则

- 单条格式：`[序号] 日期 时间\n内容`
- 记录间分隔符：`\n\n---\n\n`
- 日期范围：多条时为 `最早日期 至 最晚日期`（中文）/ `earliest to latest`（非中文），单条时即该日期

```js
const recordsText = filtered.map((r, i) => {
  return `[${i + 1}] ${r.date} ${r.time}\n${r.content}`;
}).join('\n\n---\n\n');
```

## 六、语言名映射

非中文输出时使用**英文语言名**（`LANG_NAMES_EN`），防止中文语言名混入英文提示词。

| code | 中文输出用 (LANG_NAMES) | 非中文输出用 (LANG_NAMES_EN) |
|------|------------------------|------------------------------|
| zh | 中文 | Chinese |
| en | English | English |
| ja | 日本語 | Japanese |
| ko | 한국어 | Korean |
| fr | Français | French |
| de | Deutsch | German |
| es | Español | Spanish |
| pt | Português | Portuguese |
| ru | Русский | Russian |
| ar | العربية | Arabic |
| it | Italiano | Italian |
| nl | Nederlands | Dutch |
| th | ไทย | Thai |
| vi | Tiếng Việt | Vietnamese |
| id | Indonesia | Indonesian |
| ms | Melayu | Malay |
| tr | Türkçe | Turkish |
| pl | Polski | Polish |
| sv | Svenska | Swedish |
| da | Dansk | Danish |
| fi | Suomi | Finnish |
| el | Ελληνικά | Greek |
| cs | Čeština | Czech |
| ro | Română | Romanian |
| hu | Magyar | Hungarian |
| uk | Українська | Ukrainian |
| hi | हिन्दी | Hindi |
| bn | বাংলা | Bengali |
| he | עברית | Hebrew |
| fa | فارسی | Persian |

## 七、输出后处理（autoFormatResult）

模型返回结果在渲染前会经过规整：

```js
function autoFormatResult(text) {
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');   // 统一换行符
  text = text.split('\n').map(line => line.trimEnd()).join('\n'); // 去行尾空白
  text = text.replace(/\n{3,}/g, '\n\n');                     // 压缩多余空行
  text = text.replace(/^\n+/, '').replace(/\n+$/, '');        // 去首尾空行
  text = text.replace(/^([\s]*[-*+])\s{2,}/gm, '$1 ');        // 规范无序列表标记
  text = text.replace(/^([\s]*\d+\.)\s{2,}/gm, '$1 ');        // 规范有序列表标记
  text = text.replace(/([。！？；])([^\n\s])/g, '$1 $2');      // 中文标点后补空格
  text = text.replace(/\s+([。！？，；：、])/g, '$1');          // 去中文标点前空格
  return text;
}
```

## 八、设计要点小结

1. **双语模板分流**：以 `outputLang === 'zh'` 为界，中文走简洁指令，非中文走"角色 + 强制语言规则 + 隔离输入块"的翻译式工作流。
2. **语言名隔离**：非中文场景全程使用英文语言名，杜绝模型因看到中文字符而切回中文。
3. **结构化输出约束**：system 中直接给出 `## 📋 / ### 🔑 / ### 📝` 三级骨架，保证总结格式统一、可被 Markdown 渲染。
4. **低温采样**：`temperature: 0.1` 让多次总结结果保持稳定。
5. **后处理兜底**：`autoFormatResult` 修正换行、列表标记与中英文标点空格，提升渲染一致性。
