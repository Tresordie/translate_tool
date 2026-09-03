/**
 * ai-service.js — AI Parse / AI Prompts 共享服务（网页版与 Chrome 扩展通用）
 *
 * 提供:
 *   - 配置读写（localStorage translate_config / chrome.storage config / 插件 postMessage 同步）
 *   - OpenAI 兼容 chat/completions 调用（reasoning 模型自动省略 temperature）
 *   - AI Parse: 任务抽取 parseNotes() / 自由分析 analyzeContent()（含邮件线程 playbook）
 *   - AI Prompts: 提示词工程 generatePrompt() + extractPromptBody()
 *   - 任务清单写入（todo_items）与 Markdown/HTML 下载等工具
 *
 * 用法: 在页面底部引入 <script src="ai-service.js"></script>，经 window.AiService 调用。
 */
(function (global) {
  'use strict';

  /* ================= 配置 ================= */

  function isExtension() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function getConfig() {
    var cfg = null;
    try { cfg = JSON.parse(localStorage.getItem('translate_config') || 'null'); } catch (e) { cfg = null; }
    return (cfg && cfg.baseUrl) ? cfg : { baseUrl: '', apiKey: '', model: '' };
  }

  function saveConfig(cfg) {
    try { localStorage.setItem('translate_config', JSON.stringify(cfg)); } catch (e) {}
    if (isExtension()) {
      try { chrome.storage.local.set({ config: cfg }, function () {}); } catch (e) {}
    } else {
      // 网页保存 → content.js 中继 → background 写 chrome.storage（扩展弹窗/侧边栏同步）
      try { (window.top || window).postMessage({ source: 'linguaflow-page', type: 'save-config', config: cfg }, '*'); } catch (e) {}
    }
  }

  /**
   * 三路配置同步（与 email_summary / workreport 同一模式）:
   *   - 网页环境: content script 通过 postMessage 广播
   *   - 扩展环境: 直接监听 chrome.storage + 首次读取兜底
   * onConfig 回调仅在拿到有效配置时触发。
   */
  function initConfigSync(onConfig) {
    /**
     * 收到新配置时：
     * 1. 同步写入 localStorage('translate_config')，使 chat() → getConfig() 能读到最新值
     * 2. 回调 onConfig 通知业务层更新 UI
     */
    function applyConfig(cfg) {
      if (!cfg || !cfg.baseUrl) return;
      try {
        localStorage.setItem('translate_config', JSON.stringify({
          baseUrl: cfg.baseUrl,
          apiKey: cfg.apiKey,
          model: cfg.model,
        }));
      } catch (e) {}
      onConfig(cfg);
    }

    global.addEventListener('message', function (e) {
      var d = e.data;
      if (d && d.source === 'linguaflow-extension' && d.config && d.config.baseUrl) applyConfig(d.config);
    });
    if (isExtension()) {
      try {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area === 'local' && changes.config && changes.config.newValue && changes.config.newValue.baseUrl) {
            applyConfig(changes.config.newValue);
          }
        });
        chrome.storage.local.get(['config'], function (res) {
          var c = res && res.config;
          if (c && c.baseUrl) applyConfig(c);
        });
      } catch (e) {}
    }
  }

  /* ================= 页面状态持久化（双通道） ================= */

  /** 读取页面状态（JSON 对象），不存在或损坏时返回 null；扩展环境读 chrome.storage.local，网页环境读 localStorage */
  function loadState(key) {
    return new Promise(function (resolve) {
      if (isExtension()) {
        try {
          chrome.storage.local.get([key], function (res) { resolve((res && res[key]) || null); });
        } catch (e) { resolve(null); }
      } else {
        var raw = null;
        try { raw = localStorage.getItem(key); } catch (e) {}
        var data = null;
        if (raw) { try { data = JSON.parse(raw); } catch (e) {} }
        resolve(data);
      }
    });
  }

  /** 写入页面状态；扩展环境写 chrome.storage.local，网页环境写 localStorage */
  function saveState(key, value) {
    if (isExtension()) {
      try {
        var patch = {};
        patch[key] = value;
        chrome.storage.local.set(patch, function () {});
      } catch (e) {}
    } else {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
      // 网页 → 扩展反向同步（v0.25.0：content.js 中继，映射表见 background.js）
      try { (window.top || window).postMessage({ source: 'linguaflow-page', type: 'save-record', key: key, value: value }, '*'); } catch (e) {}
    }
  }

  /* ================= chat/completions ================= */

  var REASONING_RE = /reasoner|reasoning|thinking|qwq|kimi-k3|deepseek-v4|(^|[^a-z0-9])o[134]($|[^0-9])/i;

  function isReasoningModel(model) {
    return REASONING_RE.test(String(model || '').toLowerCase());
  }

  function buildUrl(baseUrl) {
    var u = String(baseUrl || "").trim().replace(/[\u0000-\u0020\u007f\u3000]+/g, "").replace(/：/g, ":").replace(/／/g, "/")
    while (u.endsWith("/")) u = u.slice(0, -1);
    if (u.endsWith("/chat/completions")) u = u.slice(0, -1 * "/chat/completions".length);
    return u + "/chat/completions";
  }

  /* ================= 网页版跨域代理桥（v0.23.0） =================
   * 无 CORS 头的端点（如阿里云 Token Plan）在网页版会被浏览器拦截；
   * 若用户安装了一工具箱扩展（content script 已注入页面），可将请求经
   * background（host_permissions 免跨域）代理发出。
   * 链路：页面 postMessage → content.js → chrome.runtime → background fetch
   * → 原路返回。扩展页面自身直连，不走桥。 */
  var _bridge = { available: null, seq: 0, pending: {} };

  // 桥消息发往顶层帧：content script 默认只注入顶层（manifest 不含 all_frames），
  // 嵌在 index.html 里的 iframe 页面（如热点雷达）必须经 window.top 才能到达 content.js。
  function bridgeTarget() {
    try { return window.top || window; } catch (e) { return window; }
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.source !== 'linguaflow-extension' || !d.bridgeId) return;
    var cb = _bridge.pending[d.bridgeId];
    if (cb) { delete _bridge.pending[d.bridgeId]; cb(d); }
  });

  function bridgePing() {
    return new Promise(function (resolve) {
      var id = 'ping' + (++_bridge.seq);
      var timer = setTimeout(function () { delete _bridge.pending[id]; resolve(false); }, 1500);
      _bridge.pending[id] = function () { clearTimeout(timer); resolve(true); };
      try { bridgeTarget().postMessage({ source: 'linguaflow-page', type: 'bridge-ping', bridgeId: id }, '*'); }
      catch (e) { clearTimeout(timer); resolve(false); }
    });
  }

  function bridgeFetch(url, options) {
    return new Promise(function (resolve, reject) {
      var id = 'req' + (++_bridge.seq) + '_' + Date.now();
      // 600s：桥接承载大模型非流式调用，长文档（PDF 邮件线程最多发送 6 万字符）经
      // Token Plan 等慢网关生成常需数分钟，原先的 120s 会在正常返回前就误判超时。
      // 实测 background SW 在 420s 在途 fetch 下仍存活并完整应答
      // （tests/bridge-long-request.e2e.mjs），故此处只需容纳真实生成耗时。
      var timer = setTimeout(function () { delete _bridge.pending[id]; reject(new Error('桥接请求超时')); }, 600000);
      _bridge.pending[id] = function (res) {
        clearTimeout(timer); delete _bridge.pending[id];
        if (res.error) reject(new Error('代理请求失败：' + res.error));
        else resolve(pfRes(res.text || '', !!res.ok, res.status || 0));
      };
      try {
        bridgeTarget().postMessage({
          source: 'linguaflow-page', type: 'bridge-fetch', bridgeId: id,
          url: url, method: options.method || 'GET', headers: options.headers || {}, body: options.body || ''
        }, '*');
      } catch (e) { clearTimeout(timer); delete _bridge.pending[id]; reject(new Error('桥接不可用')); }
    });
  }

  // 统一响应包装：与 fetch Response 兼容（ok/status/text()/json()），供 proxyFetch 各通道使用
  // 注意：text 是方法（返回 Promise<string>），不是字符串属性
  function pfRes(text, ok, status) {
    return {
      ok: ok, status: status,
      text: function () { return Promise.resolve(text); },
      json: function () { try { return Promise.resolve(JSON.parse(text)); } catch (e) { return Promise.reject(e); } }
    };
  }

  /** 记录跨端同步监听：任一端写入该记录键（chrome.storage 键名）时触发 cb(newValue)
   *  网页：content.js 写 localStorage 后 postMessage record-sync；同时兜底 storage 事件
   *  扩展：chrome.storage.onChanged */
  function onRecordSync(key, cb) {
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (d && d.source === 'linguaflow-extension' && d.type === 'record-sync' && d.key === key && d.value !== undefined) cb(d.value);
    });
    if (isExtension() && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      try {
        chrome.storage.onChanged.addListener(function (changes, area) {
          if (area === 'local' && changes[key] && changes[key].newValue !== undefined) cb(changes[key].newValue);
        });
      } catch (e) {}
    } else {
      window.addEventListener('storage', function (e) {
        if (e.key === key && e.newValue !== null) {
          try { cb(JSON.parse(e.newValue)); } catch (err) {}
        }
      });
    }
  }

  /**
   * 跨域请求通道（导出供各页面复用）：
   * 扩展页面直连（host_permissions 免跨域）；网页先直连，
   * 网络层失败（CORS/断网）时自动尝试扩展代理桥。返回 { ok, status, text(), json() }。
   */
  async function proxyFetch(url, options) {
    options = options || {};
    var ext = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    if (ext) {
      var r0 = await fetch(url, options);
      var t0 = await r0.text();
      return pfRes(t0, r0.ok, r0.status);
    }
    try {
      var r = await fetch(url, options);
      var t = await r.text();
      return pfRes(t, r.ok, r.status);
    } catch (e) {
      if (_bridge.available === null) _bridge.available = await bridgePing();
      if (!_bridge.available) throw new Error('网络请求失败，请检查 Base URL 与网络连接');
      return await bridgeFetch(url, options);
    }
  }

  /**
   * 发送一次 chat-completions 请求，返回 assistant 正文。
   * 参数: { messages, temperature, maxTokens, extraBody }
   * reasoning 模型省略 temperature / max_tokens（与 TaskFlow AiService 一致）；
   * 若某模型拒绝 temperature（400），自动无参重试一次。
   */
  async function chat(opts) {
    var config = getConfig();
    if (!config.baseUrl || !config.apiKey || !config.model) {
      throw new Error('请先配置 API（Base URL / API Key / Model）');
    }
    var reasoning = isReasoningModel(config.model);
    var url = buildUrl(config.baseUrl);

    async function send(includeTemperature) {
      var body = { model: config.model, messages: opts.messages };
      if (!reasoning) {
        if (includeTemperature && opts.temperature != null) body.temperature = opts.temperature;
        if (opts.maxTokens) body.max_tokens = opts.maxTokens;
      }
      if (opts.extraBody) Object.assign(body, opts.extraBody);

      var pr;
      try {
        pr = await proxyFetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': 'Bearer ' + config.apiKey,
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw new Error(/网络请求失败|桥接/.test(e.message) ? e.message : '网络请求失败，请检查 Base URL 与网络连接');
      }
      if (!pr.ok) {
        var prText = await pr.text();
        var detail = '';
        try { var j = JSON.parse(prText); detail = (j.error && j.error.message) || ''; } catch (e) { detail = prText; }
        throw new Error('API 错误 ' + pr.status + (detail ? ': ' + detail.slice(0, 200) : ''));
      }
      var data;
      try { data = JSON.parse(await pr.text()); } catch (e) { throw new Error('API 返回无法解析的 JSON'); }
      var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('AI 返回为空，请检查模型配置');
      }
      return content;
    }

    try {
      return await send(true);
    } catch (err) {
      if (opts.temperature != null && err && err.message && /temperature/i.test(err.message)) {
        return await send(false);
      }
      throw err;
    }
  }

  /* ================= 输出语种配置（AI Parse） ================= */

  // label 供下拉框展示，name 为注入 Prompt 的语种表述；新增语种只需在此追加
  var OUTPUT_LANGS = [
    { code: 'zh', label: '中文', name: 'Simplified Chinese (中文)' },
    { code: 'en', label: '英语', name: 'English' },
    { code: 'ja', label: '日语', name: 'Japanese (日本語)' },
    { code: 'ko', label: '韩语', name: 'Korean (한국어)' },
    { code: 'fr', label: '法语', name: 'French (Français)' },
    { code: 'de', label: '德语', name: 'German (Deutsch)' },
    { code: 'es', label: '西班牙语', name: 'Spanish (Español)' },
    { code: 'ru', label: '俄语', name: 'Russian (Русский)' },
    { code: 'ar', label: '阿拉伯语', name: 'Arabic (العربية)' },
    { code: 'pt', label: '葡萄牙语', name: 'Portuguese (Português)' },
  ];

  /** 按 code 查语种配置；未知/缺省回退中文 */
  function getOutputLang(code) {
    for (var i = 0; i < OUTPUT_LANGS.length; i++) {
      if (OUTPUT_LANGS[i].code === code) return OUTPUT_LANGS[i];
    }
    return OUTPUT_LANGS[0];
  }

  /* ================= AI Parse — 任务抽取 ================= */

  var SYSTEM_PROMPT_TASKS = [
    'You are a task-extraction assistant for a hardware test engineer.',
    'The user pastes raw work notes (meeting notes, test logs, to-do scribbles,',
    'chat excerpts, etc.). Your job: extract every actionable TASK from the notes.',
    '',
    'Rules:',
    '1. Reply with ONLY a JSON object, no prose, no markdown fences.',
    '2. JSON schema:',
    '{"tasks":[{"title":"short imperative title","description":"context, details, measurements, links","priority":"P0|P1|P2|P3","tags":["tag1"],"subSteps":["step 1","step 2"]}]}',
    '3. priority: P0 = critical / blocking line-down, P1 = high / this week,',
    '   P2 = medium / normal, P3 = low / nice-to-have. Default P2.',
    '4. Language: write ALL human-readable fields (title, description, subSteps) in {{LANG}}.',
    '5. title: imperative, <= 60 chars.',
    '6. description: keep concrete facts (values, part numbers, station names).',
    '7. subSteps: only when the notes clearly enumerate steps; else [].',
    '8. tags: 0-3 short lowercase keywords (e.g. "ate", "harness", "pvt").',
    '9. If there is no actionable task, return {"tasks":[]}.',
  ].join('\n');

  var CONTENT_ANALYZE_PROMPT = [
    '# 角色',
    '你是资深技术分析助理，面向硬件/项目工程师（NPI 电动自行车项目）。',
    '',
    '# 任务',
    '按用户给出的【解析要求】对【内容】进行解析与总结；未给出要求时，输出一份结构化要点总结。',
    '',
    '# 铁律',
    '1. 绝不编造：内容中没有的信息禁止生成；信息不足时明确指出缺什么。',
    '2. 数字保真：数值、型号、料号、寄存器名、命令名、日期与原文逐字一致，禁止四舍五入或泛化。',
    '3. 一条一个事实：每个要点只讲一个事实/事件/决策，禁止合并。',
    '4. 结构化：markdown 标题 + 编号/列表分区，禁止平铺长段落。',
    '5. 语言：{{LANG_RULE}}。',
    '',
    '# 输出',
    '仅输出 markdown 结果本身，无额外解释、无代码围栏。',
  ].join('\n');

  var EMAIL_THREAD_PROMPT = [
    '# 角色',
    '你是面向硬件/项目工程师的项目秘书。用户给你客户或合作伙伴的邮件线程（常中英混杂、倒序引用、夹带签名档与保密声明），你负责理清并总结。',
    '',
    '# 铁律（违反即为失败）',
    '1. 绝不编造：没有邮件正文就明确说明缺少内容，绝不凭空生成。',
    '2. 数字保真：所有数值、型号、寄存器名、命令名、日期与原文逐字一致（如 4.19 V、0xF091、CAL_COV 原样保留）。',
    '3. 数值漂移必须标注：同一参数多封邮件中变化时，以最新一封为准，并在风险区标出变更过程。',
    '4. 区分已拍板与未拍板：只有最新邮件明确决定的写"已决定"；讨论未定案的写"未拍板/待澄清"。',
    '5. 标题≠范围：邮件标题涵盖范围与最终实际决定范围不一致时，必须指出差异。',
    '6. 去噪不丢信息：剥离签名档、保密声明、引用标记（>、On ... wrote:），但被引用段落里的实质内容必须纳入时间线。',
    '7. 时间正序：把线程按时间从早到晚重排后再总结。',
    '',
    '# 输出格式（markdown，章节顺序固定）',
    '## 邮件线程详细总结',
    '### 一、主题与背景',
    '- **邮件主题**：`<Subject>`',
    '- **双方**：<甲方（姓名，职位，公司）> ↔ <乙方（姓名，职位，公司）>',
    '- **对象**：<项目/产品/芯片型号等>',
    '- **核心诉求演变**：<最初诉求> → <最终结论>',
    '',
    '### 二、时间线（按时间正序，共 N 封）',
    '| 日期 | 发件人 | 关键内容 |',
    '|---|---|---|',
    '| MM-DD | XXX | 1~3 句：诉求/结论/关键数字 |',
    '（每封一行，纯礼节/催办邮件也要列出）',
    '',
    '### 三、技术要点',
    '1. **<要点一>**：<结论>（无法核对的注明"未验证"）',
    '',
    '### 四、风险与注意点',
    '- **数值已变更**：<旧值> → <新值>，以新值为准',
    '- **范围差异**：<标题/早期讨论范围> vs <实际决定范围>',
    '- **依赖关系**：<谁等谁，先后顺序>',
    '- **未明确的点**：<容差/参数/决策缺口，逐条列出>',
    '',
    '## To Do List',
    '### A. 我方',
    '| # | 优先级 | 事项 | 验收标准 | 依赖 |',
    '|---|---|---|---|---|',
    '| A1 | 🔴 P0 | <动词开头的可执行动作> | <怎样算完成> | <前置项或"无"> |',
    '### B. 对方',
    '| # | 责任人 | 事项 |',
    '（只收录对方明确承诺/认领的事项）',
    '### C. 联合验证（后续节点）',
    '- [ ] <双方共同完成的验证项>',
    '',
    '优先级：P0 = 阻塞交付或有明确期限；P1 = 有依赖需排期；P2 = 记录归档。',
    '仅输出 markdown 结果本身，无额外解释、无代码围栏。',
  ].join('\n');

  /** 任务抽取 system prompt（按语种注入） */
  function tasksPrompt(langCode) {
    return SYSTEM_PROMPT_TASKS.split('{{LANG}}').join(getOutputLang(langCode).name);
  }

  /** 自由分析 system prompt（按语种注入） */
  function analyzePrompt(langCode) {
    var rule = '全文严格使用' + getOutputLang(langCode).name + '输出';
    return CONTENT_ANALYZE_PROMPT.split('{{LANG_RULE}}').join(rule);
  }

  /** 邮件线程 system prompt；非中文输出时追加语言覆盖段（章节结构保持不变） */
  function emailPrompt(langCode) {
    var lang = getOutputLang(langCode);
    if (lang.code === 'zh') return EMAIL_THREAD_PROMPT;
    return EMAIL_THREAD_PROMPT +
      '\n\n# 输出语言（最高优先级）\n' +
      '上文中的中文章节名称仅为结构模板：实际输出必须全部使用' + lang.name +
      '，包括所有章节标题、表头与正文；章节结构与顺序保持不变。';
  }

  function stripFences(s) {
    var t = String(s).trim();
    if (t.startsWith('```')) {
      t = t.replace(/^```[a-zA-Z]*\n?/, '');
      if (t.endsWith('```')) t = t.slice(0, -3);
    }
    return t.trim();
  }

  function stringList(v) {
    if (Array.isArray(v)) {
      return v.map(function (e) { return String(e).trim(); }).filter(function (e) { return e.length > 0; });
    }
    if (typeof v === 'string' && v.trim()) return [v.trim()];
    return [];
  }

  function mapPriority(raw) {
    var p = String(raw || '').toUpperCase().replace(/[^0-3]/g, '');
    if (p === '0' || p === '1' || p === '3') return 'P' + p;
    return 'P2';
  }

  function parseTaskJson(raw) {
    var decoded;
    try { decoded = JSON.parse(stripFences(raw)); } catch (e) { throw new Error('AI 返回无法解析的 JSON，请重试或换用「Analyze」模式'); }
    // 兼容 OpenAI 外层 wrapper: {choices:[{message:{content:"..."}}]}
    if (decoded && Array.isArray(decoded.choices)) {
      var c = decoded.choices[0] && decoded.choices[0].message && decoded.choices[0].message.content;
      if (typeof c === 'string') { try { decoded = JSON.parse(stripFences(c)); } catch (e) {} }
    }
    var list = (decoded && Array.isArray(decoded.tasks)) ? decoded.tasks : (Array.isArray(decoded) ? decoded : []);
    return list
      .filter(function (t) { return t && t.title; })
      .map(function (t) {
        return {
          title: String(t.title || '').trim(),
          description: String(t.description || '').trim(),
          priority: mapPriority(t.priority),
          tags: stringList(t.tags),
          subSteps: stringList(t.subSteps || t.sub_steps || t.steps),
        };
      })
      .filter(function (t) { return t.title.length > 0; });
  }

  /** 经典任务抽取：粘贴原始笔记 → 结构化 JSON 任务列表；lang 为输出语种 code（见 OUTPUT_LANGS） */
  async function parseNotes(notes, lang) {
    var content = await chat({
      temperature: 0.2,
      maxTokens: 4000,
      extraBody: { response_format: { type: 'json_object' } },
      messages: [
        { role: 'system', content: tasksPrompt(lang) },
        { role: 'user', content: String(notes || '') },
      ],
    });
    return parseTaskJson(content);
  }

  /* ================= AI Parse — 自由分析 / 邮件线程 ================= */

  /** 自由分析：instructions 与/或附件 → 结构化 markdown 总结；email=true 走邮件线程 playbook；lang 为输出语种 code */
  async function analyzeContent(opts) {
    var instructions = String(opts.instructions || '').trim();
    var content = String(opts.content || '').trim();
    var user = instructions
      ? '【解析要求】\n' + instructions + '\n\n———\n\n【内容】\n' + content
      : content;
    return chat({
      temperature: 0.3,
      maxTokens: 3000,
      messages: [
        { role: 'system', content: opts.email ? emailPrompt(opts.lang) : analyzePrompt(opts.lang) },
        { role: 'user', content: user },
      ],
    });
  }

  /* ================= AI Prompts — 提示词工程 ================= */

  var PROMPT_ENGINEER_PROMPT = [
    '# 角色',
    '你是资深 AI 提示词工程专家，精通主流模型（Claude/GPT/Gemini 等）的指令遵循特性。',
    '你的唯一任务：把用户给出的粗糙需求，改写成一条专家级、可直接复制使用的提示词。',
    '',
    '# 工作流程',
    '1. 解析输入，提取：任务类型、目标产物、受众、领域、约束条件、输出格式、语言；',
    '2. 判断需求完整度：',
    '   - 仅当缺失【会直接导致产物错误】的关键信息时（如分析任务无数据来源、',
    '     写作任务无受众且无法合理推断），输出最多 3 个澄清问题后停止，等待补充；',
    '   - 软件需求类特例：平台与技术栈缺失时优先追问——这是必然导致产物错误的信息，',
    '     问句不超过 2 个："目标平台？（网页/iOS/Android/Windows桌面/跨端）"',
    '     "有技术栈偏好吗？没有则由我推荐"；其余信息照常推断补全；',
    '   - 其余所有缺失信息一律基于常识补全并标注假设，禁止追问；',
    '3. 按任务类型选用骨架：',
    '   - 软件/应用需求类（网页/Web App/移动端/桌面端通用）：',
    '     一句话定位 → 平台与技术栈 → 用户与使用场景 → 功能清单（编号，逐条可验收）',
    '     → 关键交互与视觉要求 → 数据/存储/集成 → 明确不做的事项 → 验收标准；',
    '   - 编程实现类（技术方案已定的具体开发任务）：',
    '     角色 → 目标 → 技术约束 → 实现要求 → 测试要求 → 验收标准',
    '     → 执行规则（先诊断后动手：改 bug/回归类任务先报根因再修；',
    '        遇阻即停：与现有方案冲突时停下来给选项，不自行换路线）→ 禁止事项；',
    '   - 写作/文案类：角色 → 受众与语气 → 任务 → 结构要求 → 参考示例 → 禁止事项；',
    '   - 分析/决策类：背景 → 问题定义 → 分析框架 → 输出格式 → 判断标准；',
    '   - 其他通用：目标 → 上下文 → 要求 → 输出格式。',
    '4. 按「质量规则」逐条自检后输出最终提示词。',
    '',
    '# 质量规则（生成物必须全部满足）',
    '1. 省 token：零客套——禁用"请你/麻烦/一名优秀的"；一句话说清的不写两句；',
    '   简单任务全稿 <150 字，中等 <400 字，复杂任务也只保留影响产出的信息；',
    '2. 明确：一切可量化处写数值（字数/条数/版本/文件路径/格式），',
    '   禁用"尽量/适当/一些/相关"等模糊词；',
    '3. 结构化：用 markdown 标题或编号分区，每区单一职责，便于执行方 AI 定位指令；',
    '4. 验收内嵌：必须含"完成标准"，让执行方 AI 能自检是否达标；',
    '5. 负面清单：列至少 2 条禁止项（取自该任务类型最常见的跑偏方向）；',
    '6. 假设透明：你补全的信息集中在末尾「⚠ 假设（可修改）」区块，不散落正文；',
    '7. 语言：默认生成中文提示词，用户明示英文场景时除外。',
    '',
    '# 输出格式（严格遵守，不要输出任何额外解释）',
    '### 📋 提示词',
    '（代码块包裹的完整提示词正文）',
    '',
    '### ⚠ 假设（可修改）',
    '- （仅当第 2 步有补全时输出此节）',
    '',
    '### 💡 使用建议',
    '一句话：适配的模型类型与最值得调整的参数。',
  ].join('\n');

  /** 粗糙需求 → 专家级可复制提示词（markdown 输出） */
  async function generatePrompt(requirement) {
    return chat({
      temperature: 0.5,
      maxTokens: 2000,
      messages: [
        { role: 'system', content: PROMPT_ENGINEER_PROMPT },
        { role: 'user', content: '# 用户需求\n' + String(requirement || '') },
      ],
    });
  }

  /** 提取输出中第一个围栏代码块（提示词正文）用于「复制提示词」；无则返回原文 */
  function extractPromptBody(aiOutput) {
    var m = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(String(aiOutput || ''));
    if (!m) return String(aiOutput || '').trim();
    return (m[1] || '').trim();
  }

  /* ================= 辅助工具 ================= */

  /** 邮件启发式检测（与 TaskFlow ai_parse_screen 一致） */
  function looksLikeEmail(text) {
    var s = String(text || '').toLowerCase();
    return (s.indexOf('from:') !== -1 && s.indexOf('subject:') !== -1) ||
      (String(text || '').indexOf('发件人') !== -1 && String(text || '').indexOf('主题') !== -1) ||
      (s.indexOf('on ') !== -1 && s.indexOf('wrote:') !== -1);
  }

  function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(new Error('读取文件失败: ' + file.name)); };
      reader.readAsText(file);
    });
  }

  function downloadText(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function mdToHtml(md, title) {
    var html;
    try { html = global.renderMarkdown ? global.renderMarkdown(md) : String(md); } catch (e) { html = String(md); }
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>' +
      String(title || 'AI Summary') + '</title></head><body>' + html + '</body></html>';
  }

  function describeApiError(err) {
    if (!err) return '未知错误';
    var m = err.message || String(err);
    if (/API 错误|网络请求失败/.test(m)) return m;
    if (/failed to fetch|load failed|networkerror|fetch/i.test(m)) return '网络请求失败，请检查 Base URL 与网络连接';
    return m;
  }

  /* ================= 任务清单写入 ================= */

  function getTodoStorage() {
    return new Promise(function (resolve, reject) {
      if (isExtension()) {
        chrome.storage.local.get(['todo_items'], function (res) {
          resolve({ items: (res && res.todo_items) || [], ext: true });
        });
      } else {
        var items = [];
        try { items = JSON.parse(localStorage.getItem('td_todo_items') || '[]'); } catch (e) { items = []; }
        if (!Array.isArray(items)) items = [];
        resolve({ items: items, ext: false });
      }
    });
  }

  function saveTodoItems(store, items) {
    return new Promise(function (resolve) {
      if (store.ext) { chrome.storage.local.set({ todo_items: items }, resolve); }
      else { try { localStorage.setItem('td_todo_items', JSON.stringify(items)); } catch (e) {} resolve(); }
    });
  }

  function mapPriorityToTodo(p) {
    var s = String(p || '').toUpperCase();
    if (s === 'P0' || s === 'P1') return 'high';
    if (s === 'P3') return 'low';
    return 'mid';
  }

  /**
   * 把 AI Parse 抽取的任务写入任务清单。
   * 标题用 markdown 折叠描述/tags/子步骤（todolist 标题以 renderMarkdown 渲染）。
   * 优先级映射: P0/P1→high, P2→mid, P3→low。
   */
  async function createTodos(tasks) {
    var store = await getTodoStorage();
    var today = new Date().toISOString().split('T')[0];
    var added = 0;
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var parts = [t.title];
      if (t.description) parts.push('\n\n' + t.description);
      if (t.tags && t.tags.length) parts.push('\n\n' + t.tags.map(function (tag) { return '`' + tag + '`'; }).join(' '));
      if (t.subSteps && t.subSteps.length) parts.push('\n\n' + t.subSteps.map(function (s) { return '- [ ] ' + s; }).join('\n'));
      store.items.unshift({
        id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6),
        title: parts.join(''),
        date: today,
        time: '',
        priority: mapPriorityToTodo(t.priority),
        completed: false,
        syncedGoogle: false,
        syncedIcs: false,
        timestamp: Date.now(),
      });
      added++;
    }
    if (store.items.length > 500) store.items = store.items.slice(0, 500);
    await saveTodoItems(store, store.items);
    return added;
  }

  /* ================= 导出 ================= */

  global.AiService = {
    getConfig: getConfig,
    saveConfig: saveConfig,
    initConfigSync: initConfigSync,
    loadState: loadState,
    saveState: saveState,
    chat: chat,
    proxyFetch: proxyFetch,
    onRecordSync: onRecordSync,
    isReasoningModel: isReasoningModel,
    buildUrl: buildUrl,
    OUTPUT_LANGS: OUTPUT_LANGS,
    getOutputLang: getOutputLang,
    parseNotes: parseNotes,
    analyzeContent: analyzeContent,
    generatePrompt: generatePrompt,
    extractPromptBody: extractPromptBody,
    looksLikeEmail: looksLikeEmail,
    readTextFile: readTextFile,
    downloadText: downloadText,
    mdToHtml: mdToHtml,
    describeApiError: describeApiError,
    createTodos: createTodos,
    PROMPTS: {
      tasks: tasksPrompt('zh'),
      analyze: analyzePrompt('zh'),
      emailThread: EMAIL_THREAD_PROMPT,
      promptEngineer: PROMPT_ENGINEER_PROMPT,
    },
  };

})(typeof window !== 'undefined' ? window : this);
