/**
 * markdown.js — Lightweight Markdown renderer (no dependencies)
 * Exposes global function: renderMarkdown(md) -> htmlString
 * Supports: h1-h6, bold, italic, strikethrough, inline code, fenced code blocks,
 *           links, images, ordered/unordered/task lists (nested), blockquotes,
 *           horizontal rules, tables, paragraphs & line breaks.
 * All input is HTML-escaped before injection (XSS-safe).
 */
(function (global) {
  'use strict';

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* ---------- Inline SVG passthrough ----------
   * G-SPEC 视觉套件会输出内联 SVG 封面/示意图，默认全转义会把 SVG 显示成源码文本。
   * 对 <svg>...</svg> 块净化后原样放行：剔除 <script>、on* 事件属性与 javascript: 链接，
   * 其余标签与属性保留（内容来自用户自己的材料 / AI 输出）。
   */
  function sanitizeSvg(s) {
    return String(s)
      .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
      .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s(?:href|xlink:href)\s*=\s*(?:"[^"]*javascript:[^"]*"|'[^']*javascript:[^']*'|javascript:[^\s>]*)/gi, '');
  }

  /* ---------- Raw HTML passthrough（G-SPEC 时间轴骨架等 <style>/<div> 块） ----------
   * 技能时间轴规范要求按骨架原样输出 <style>+<div>；默认全转义会把骨架显示成源码。
   * 放行时净化（剔 <script>/HTML 注释/on* 事件属性/javascript: 链接），并把 <style>
   * 内的选择器加 .md-embed 前缀作用域化（防骨架样式泄漏影响页面其余部分），
   * 整块包一层 <div class="md-embed">——预览与单文件 HTML 导出同样生效。
   */
  function sanitizeHtmlFragment(s) {
    return String(s)
      .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s(?:href|xlink:href|src)\s*=\s*(?:"[^"]*javascript:[^"]*"|'[^']*javascript:[^']*'|javascript:[^\s>]*)/gi, '');
  }

  function scopeCss(css) {
    // 简易作用域化：顶层规则（非 @media/@keyframes）的每个选择器前缀 .md-embed
    return String(css).replace(/(^|\})\s*((?![@\s}])[^{}]+)\{/g, function (m, brace, sel) {
      return brace + sel.split(',').map(function (s) { return '.md-embed ' + s.trim(); }).join(',') + '{';
    });
  }

  /* ---------- Inline formatting (input is already HTML-escaped) ---------- */

  function formatEmphasis(t) {
    // Images: ![alt](url)
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
    // Links: [text](url)
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Bold: **x** / __x__
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    // Italic: *x* / _x_
    t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    t = t.replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1<em>$2</em>');
    // Strikethrough: ~~x~~
    t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return t;
  }

  function renderInline(src) {
    // Protect inline code spans first: `code`
    var parts = String(src).split(/(`[^`]*`)/g);
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.length > 1 && p.charAt(0) === '`' && p.charAt(p.length - 1) === '`') {
        out += '<code>' + p.slice(1, -1) + '</code>';
      } else if (p.length === 2 && p === '``') {
        out += '<code></code>';
      } else {
        out += formatEmphasis(p);
      }
    }
    return out;
  }

  /* ---------- Block helpers ---------- */

  var RE_HEADING = /^(#{1,6})\s+(.*)$/;
  var RE_HR = /^\s*([-*_])\s*(?:\1\s*){2,}$/;
  var RE_QUOTE = /^>\s?/;
  var RE_FENCE = /^```(\w*)\s*$/;
  var RE_LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

  function isTableSep(line) {
    return line.indexOf('|') !== -1 && line.indexOf('-') !== -1 &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(line);
  }

  function splitTableRow(line) {
    line = line.trim();
    if (line.charAt(0) === '|') line = line.slice(1);
    if (line.charAt(line.length - 1) === '|') line = line.slice(0, -1);
    return line.split('|').map(function (c) { return c.trim(); });
  }

  function isBlockStart(line, nextLine) {
    if (RE_HEADING.test(line)) return true;
    if (RE_FENCE.test(line)) return true;
    if (RE_HR.test(line)) return true;
    if (RE_QUOTE.test(line)) return true;
    if (RE_LIST.test(line)) return true;
    if (line.indexOf('|') !== -1 && nextLine !== undefined && isTableSep(nextLine)) return true;
    return false;
  }

  /* ---------- Lists (with nesting) ---------- */

  function buildList(items) {
    var html = '';
    var stack = []; // { indent, tag }

    function closeOne() {
      var t = stack.pop();
      html += '</' + t.tag + '>' + (stack.length ? '</li>' : '');
    }

    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var tag = it.ordered ? 'ol' : 'ul';
      var content;
      var liClass = '';

      // Task list item: - [ ] / - [x]
      var taskM = it.text.match(/^\[([ xX])\]\s+([\s\S]*)$/);
      if (taskM) {
        var checked = taskM[1] !== ' ';
        content = '<input type="checkbox" disabled' + (checked ? ' checked' : '') + '> ' +
          renderInline(escapeHtml(taskM[2]));
        liClass = ' class="task-item"';
      } else {
        content = renderInline(escapeHtml(it.text));
      }
      content = content.replace(/\n/g, '<br>');

      // Close deeper levels
      while (stack.length && it.indent < stack[stack.length - 1].indent) closeOne();

      // Same level but list type changed -> close and reopen
      if (stack.length && it.indent === stack[stack.length - 1].indent &&
          tag !== stack[stack.length - 1].tag) {
        closeOne();
      }

      if (!stack.length || it.indent > stack[stack.length - 1].indent) {
        // Open a new (possibly nested) list inside the parent <li>
        if (stack.length && html.slice(-5) === '</li>') html = html.slice(0, -5);
        html += '<' + tag + '><li' + liClass + '>' + content + '</li>';
        stack.push({ indent: it.indent, tag: tag });
      } else {
        html += '<li' + liClass + '>' + content + '</li>';
      }
    }
    while (stack.length) closeOne();
    return html;
  }

  /* ---------- 时间轴可视化（v0.52.3，移植自 voice_transcription src/lib/ai/timeline.ts） ----------
   * 自动识别两类时间轴数据并渲染为可视化卡片（不再是朴素表格/列表）：
   *   1. 表格：表头含时间列（时间/日期/时间戳/when/date，或首列全为 mm:ss）+ 事件/任务列；
   *   2. 列表：G-SPEC「彩点 emoji + 日期」条目（🟢 2026-11-20 …），≥2 条、≥60% 命中、≥50% 带时间戳。
   * 全部行内样式 + hex 颜色：预览 / 单文件 HTML 导出 / md 导出 / 打印一致；
   * 外层白色面板保证深色预览下可读（参考项目为浅色主题故无面板，此处为适配深色预览的补充）。
   * 颜色语义来自 scenario-templates/timeline.md：绿=完成、红=风险、琥珀=卡点、蓝=推进。
   */

  // 检测输入统一为纯文本：去掉 markdown 行内标记（粗体/斜体/代码/链接/删除线/图片）
  function tlStripInline(s) {
    return String(s == null ? '' : s)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
      .replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1$2')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
  }

  function tlIsTimeText(s) {
    return /时间|日期|时间戳|时间点|when|date/i.test(s) || /^\d{1,2}:\d{2}$/.test(String(s).trim());
  }

  // 表格时间轴识别：时间列 + 事件/任务列（+ 可选状态列）→ 时间轴数据；非时间轴返回 null
  function tlDetectTable(header, rows, rawRows) {
    if (!rows || rows.length < 2 || !header || header.length < 2) return null;
    var timeCol = -1;
    for (var ti = 0; ti < header.length; ti++) { if (tlIsTimeText(header[ti])) { timeCol = ti; break; } }
    if (timeCol === -1) {
      // 兜底：第一列全部是 mm:ss 时间戳（转写稿时间轴表常无表头语义）
      var allTime = rows.every(function (r) { return /^\d{1,2}:\d{2}(\.\d+)?$/.test(String(r[0] || '').trim()); });
      if (!allTime) return null;
      timeCol = 0;
    }
    var used = [timeCol];
    function pick(re) {
      for (var pi = 0; pi < header.length; pi++) {
        if (used.indexOf(pi) === -1 && re.test(header[pi])) return pi;
      }
      return -1;
    }
    var statusCol = pick(/状态|完成情况|进度|结果/i);
    var titleCol = pick(/事件|标题|事项|任务|议题|节点|动作|阶段/i);
    if (titleCol === -1) {
      for (var fi = 0; fi < header.length; fi++) { if (used.indexOf(fi) === -1) { titleCol = fi; break; } }
    }
    if (titleCol === -1) return null;
    used.push(titleCol);
    if (statusCol >= 0) used.push(statusCol);
    var descCol = pick(/内容|说明|详情|描述|要点|备注|结论|负责人|发言人/i);

    var entries = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri];
      // 展示取原始单元格（保留 **加粗**/`代码` 强调），检测匹配仍用剥离纯文本 rows
      var d = (rawRows && rawRows[ri]) ? rawRows[ri] : r;
      var time = String(d[timeCol] || '').trim();
      var title = String(d[titleCol] || '').trim();
      var status = statusCol >= 0 ? String(d[statusCol] || '').trim() : '';
      var descParts = descCol >= 0 ? [d[descCol]] : [];
      for (var ci = 0; ci < header.length; ci++) {
        if (used.indexOf(ci) === -1 && ci !== descCol) descParts.push(d[ci]);
      }
      var seen = [];
      var desc = descParts
        .map(function (s) { return String(s || '').trim(); })
        .filter(function (s, si) {
          var key = tlStripInline(s);
          if (!key || seen.indexOf(key) !== -1) return false;
          seen.push(key);
          return true;
        })
        .join(' · ');
      if (!tlStripInline(time) && !tlStripInline(title)) continue;
      entries.push({ time: time, title: title, desc: desc, status: status });
    }
    entries = entries.slice(0, 40);
    if (entries.length < 2) return null;
    return { entries: entries, style: statusCol >= 0 ? 'task' : 'event' };
  }

  // ——— v0.52.3 彩色时间轴（1:1 参考 voice_transcription 仪表盘的 Gmail 线索时间轴）———
  // 空心彩色圆环节点 + 同色加粗时间戳 + 正文（**要点** 加粗）+ 细竖线 + 四色图例。
  // 主题自适应：行内样式一律 var(--tl-*, 浅色兜底)——导出单文件 HTML（浅色壳）与 md 查看器
  // 吃兜底值自成一体；应用内由 theme.css 在 5 款深色主题下覆盖为深色配色（样张同款），打印回落浅色。
  var TL_BG = 'var(--tl-bg,#ffffff)', TL_LINE = 'var(--tl-line,#cbd5e1)', TL_TITLE = 'var(--tl-title,#0f172a)',
      TL_BODY = 'var(--tl-body,#475569)', TL_MUT = 'var(--tl-mut,#64748b)', TL_STRONG = 'var(--tl-strong,#0b1220)',
      TL_EM = 'var(--tl-em,#475569)', TL_BORDER = 'var(--tl-border,#e2e8f0)', TL_LEGEND = 'var(--tl-legend,#64748b)',
      TL_OK = 'var(--tl-ok,#16a34a)', TL_INFO = 'var(--tl-info,#0284c7)', TL_RISK = 'var(--tl-risk,#dc2626)',
      TL_WARN = 'var(--tl-warn,#b45309)', TL_CHIP_BG = 'var(--tl-chip-bg,rgba(15,23,42,0.04))',
      TL_CHIP_BORDER = 'var(--tl-chip-border,#e2e8f0)', TL_CODE_BG = 'var(--tl-code-bg,rgba(15,23,42,0.05))',
      TL_CODE_BORDER = 'var(--tl-code-border,#e2e8f0)', TL_CODE = 'var(--tl-code,#0f172a)';

  // 展示用文本：转义 HTML 但保留 markdown 行内强调（检测匹配仍走 tlStripInline 纯文本）
  function tlInlineHtml(s) {
    var t = escapeHtml(String(s == null ? '' : s));
    t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<b style="color:' + TL_STRONG + ';font-weight:700;">$1</b>');
    t = t.replace(/__([^_]+)__/g, '<b style="color:' + TL_STRONG + ';font-weight:700;">$1</b>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<i style="color:' + TL_EM + ';">$2</i>');
    t = t.replace(/~~([^~]+)~~/g, '<del style="color:' + TL_MUT + ';">$1</del>');
    t = t.replace(/`([^`]+)`/g, '<code style="background:' + TL_CODE_BG + ';border:1px solid ' + TL_CODE_BORDER + ';padding:0 5px;border-radius:4px;font-size:0.92em;color:' + TL_CODE + ';">$1</code>');
    return t;
  }

  // 事件轴阶段配色（对齐样张语义，主题变量驱动）：完成/推进=绿、风险/升级=红、卡点/停滞=琥珀、中性/进行=蓝
  function tlPhaseColor(text) {
    if (/完成|✅|成功|通过|正常|已解决/.test(text)) return TL_OK;
    if (/失败|风险|⚠|异常|故障|错误|升级|投诉|施压/.test(text)) return TL_RISK;
    if (/卡点|阻塞|停滞|延期|待确认|待补|逾期|pending/i.test(text)) return TL_WARN;
    return TL_INFO;
  }

  // 任务轴状态：✅完成 / 📦归档 / ❌逾期 / ⏳待处理 / 🚧进行中
  function tlTaskStatus(text) {
    if (/完成|✅|已归档|已关闭/.test(text)) return { color: TL_OK, icon: '✅', done: true };
    if (/归档|📦/.test(text)) return { color: TL_MUT, icon: '📦', done: true };
    if (/逾期|失败|❌|超时/.test(text)) return { color: TL_RISK, icon: '❌', done: false };
    if (/卡点|阻塞|停滞|待确认|待补|pending/i.test(text)) return { color: TL_WARN, icon: '⏳', done: false };
    return { color: TL_INFO, icon: '🚧', done: false };
  }

  // 时间轴骨架：细竖线 + 空心圆环节点（左缘对齐，环心压在线上）
  function tlShell(rowsHtml) {
    return '<div style="position:relative;padding-left:28px;">' +
      '<div style="position:absolute;left:9px;top:10px;bottom:14px;width:2px;background:' + TL_LINE + ';border-radius:1px;"></div>' +
      rowsHtml + '</div>';
  }
  function tlRing(color) {
    return '<span style="position:absolute;left:-28px;top:3px;width:15px;height:15px;border-radius:50%;background:' + TL_BG +
      ';border:2.5px solid ' + color + ';display:block;"></span>';
  }

  // 事件时间轴条目：同色加粗时间戳 + 标题同行，正文灰蓝色（行内强调保留）
  function tlEventCard(entries) {
    var rows = entries.map(function (e) {
      var color = e.color || tlPhaseColor(e.title + ' ' + e.desc + ' ' + e.status);
      return '<div style="position:relative;padding:0 0 18px 0;">' +
        tlRing(color) +
        '<div style="font-size:14px;line-height:1.55;">' +
          '<span style="font-weight:700;color:' + color + ';letter-spacing:0.3px;">' + tlInlineHtml(e.time) + '</span>' +
          '<span style="margin-left:10px;font-weight:600;color:' + TL_TITLE + ';">' + tlInlineHtml(e.title) + '</span>' +
        '</div>' +
        (e.desc ? '<div style="color:' + TL_BODY + ';font-size:13px;line-height:1.7;margin-top:3px;">' + tlInlineHtml(e.desc) + '</div>' : '') +
        '</div>';
    }).join('');
    return tlShell(rows);
  }

  // 任务时间轴条目：圆环节点 + 时间戳 + 标题（完成置灰划线）+ 状态 chip
  function tlTaskCard(entries) {
    var rows = entries.map(function (e) {
      var st = tlTaskStatus(e.status || e.title + ' ' + e.desc);
      return '<div style="position:relative;padding:0 0 18px 0;">' +
        tlRing(st.color) +
        '<div style="font-size:14px;line-height:1.55;">' +
          (e.time ? '<span style="font-weight:700;color:' + st.color + ';letter-spacing:0.3px;">' + tlInlineHtml(e.time) + '</span>' : '') +
          '<span style="' + (e.time ? 'margin-left:10px;' : '') + 'font-weight:600;color:' + (st.done ? TL_MUT : TL_TITLE) + ';' +
            (st.done ? 'text-decoration:line-through;' : '') + '">' + tlInlineHtml(e.title) + '</span>' +
          '<span style="margin-left:8px;font-size:11px;font-weight:600;color:' + st.color +
            ';background:' + TL_CHIP_BG + ';border:1px solid ' + TL_CHIP_BORDER + ';border-radius:4px;padding:1px 7px;vertical-align:1px;text-decoration:none;">' +
            st.icon + ' ' + escapeHtml(e.status || (st.done ? '完成' : '进行中')) + '</span>' +
        '</div>' +
        (e.desc ? '<div style="color:' + TL_BODY + ';font-size:13px;line-height:1.7;margin-top:3px;">' + tlInlineHtml(e.desc) + '</div>' : '') +
        '</div>';
    }).join('');
    return tlShell(rows);
  }

  // 面板包裹 + 图例行：颜色全走 --tl-* 变量（浅色兜底，深色主题由 theme.css 覆盖，打印回落浅色）
  function tlRender(data) {
    var card = data.style === 'task' ? tlTaskCard(data.entries) : tlEventCard(data.entries);
    var legend = '<div style="font-size:12px;color:' + TL_LEGEND + ';line-height:1.6;margin:0 0 12px;">' +
      '<span style="color:' + TL_OK + ';">●</span> 完成/推进&ensp;<span style="color:' + TL_INFO + ';">●</span> 进行中/中性&ensp;' +
      '<span style="color:' + TL_RISK + ';">●</span> 风险/升级&ensp;<span style="color:' + TL_WARN + ';">●</span> 卡点/停滞</div>';
    return '<div class="md-timeline" style="background:' + TL_BG + ';border:1px solid ' + TL_BORDER + ';border-radius:12px;padding:16px 18px 0;margin:12px 0;">' +
      legend + card + '</div>';
  }

  // G-SPEC 时间轴列表识别：行首日期支持 mm/dd、yyyy-mm-dd、mm月dd日（可带 hh:mm）或 mm:ss，
  // 且后接空白/标点才算（避免误吞 "3.5 版本发布" 这类数字开头条目）
  var TL_DATE_LEAD = /^(?:\d{1,2}\/\d{1,2}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}月\d{1,2}日)(?:\s+\d{1,2}:\d{2})?(?=[\s：:，,、．.）)\-—])|^\d{1,2}:\d{2}(?=[\s：:，,、．.）)\-—])/u;
  var TL_DOT_LEAD = /^[\u{1F534}\u{1F7E0}\u{1F7E1}\u{1F7E2}\u{1F535}\u{1F7E3}\u{1F7E4}\u{26AA}\u{26AB}\u{2B55}\u{2705}\u{274C}\u{2757}\u{2753}\u{1F6A7}\u{1F4E6}]\s*/u;

  // 列表 → 时间轴数据：≥2 条命中且命中率 ≥60%；任务类 emoji 占多数 → 任务轴，否则事件轴
  function tlParseList(items) {
    if (!items || items.length < 2) return null;
    var taskLike = 0;
    var parsed = [];
    for (var k = 0; k < items.length; k++) {
      var rawText = String(items[k].text || '').trim();
      // 先剥行首彩点 emoji 再匹配日期（🟢 2026-11-20 …）；任务类 emoji 按原文统计（含行首 ✅）
      var text = rawText.replace(TL_DOT_LEAD, '').trim();
      var dateMatch = text.match(TL_DATE_LEAD);
      if (!dateMatch) continue;
      if (/[✅❌🚧📦]/u.test(rawText)) taskLike++;
      var body = text.slice(dateMatch[0].length).replace(/^[\s：:，,、．.\-—]+/, '');
      // 展示正文优先取原始 markdown（保留 **加粗**），日期前缀/彩点剥法与剥离版一致；取不到回退纯文本
      var dispBody = '';
      var rawRough = items[k].raw != null ? String(items[k].raw).trim().replace(TL_DOT_LEAD, '') : '';
      var rd = rawRough ? TL_DATE_LEAD.exec(rawRough) : null;
      if (rd) dispBody = rawRough.slice(rd[0].length).replace(/^[\s：:，,、．.\-—]+/, '');
      var strong = items[k].strong;
      var title, desc;
      if (strong && text.indexOf(strong) === 0) {
        // strong 只包时间戳（**14:00–14:20** 议题…）：标题退化为正文首段，时间戳进日期胶囊
        if (dateMatch[0].trim() === String(strong).trim()) {
          title = body.split(/[；;：:，,。]/).filter(Boolean)[0] || body;
          desc = body;
        } else {
          title = strong;
          desc = body;
        }
      } else {
        title = body.split(/[；;：:，,。]/).filter(Boolean)[0] || body;
        desc = body;
      }
      parsed.push({
        time: dateMatch[0].trim(),
        title: String(title).trim(),
        desc: String(dispBody || desc).trim(),
        status: text,
        color: tlTaskStatus(text).color
      });
    }
    if (parsed.length < 2 || parsed.length < items.length * 0.6) return null;
    return {
      entries: parsed.slice(0, 40),
      style: taskLike * 2 >= items.length ? 'task' : 'event'
    };
  }

  /* ---------- md 导出时间轴升级（参考 voice_transcription exporters.upgradeMarkdownFigures） ----------
   * 导出 .md 时把时间轴表格/列表就地替换为行内样式卡片 HTML（Typora/VSCode/Obsidian 等可直接渲染）；
   * 代码围栏与既有 raw HTML 块（含 tl-* 骨架）原样保留，普通内容一字不动。
   */
  function upgradeMarkdownTimeline(md) {
    if (md === null || md === undefined) return '';
    var lines = String(md).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    var out = [];
    var listLines = [];
    var inFence = false;
    var n = lines.length;
    var i = 0;

    function flushList() {
      if (!listLines.length) return;
      var src = listLines;
      listLines = [];
      var itemLines = src.filter(function (l) { return l.trim() !== ''; });
      if (itemLines.length >= 2) {
        var items = itemLines.map(function (l) {
          var raw = l.replace(/^\s*(?:[-*+•▸►]|\d+[.)])\s+/, '');
          var sm = /\*\*([^*]+)\*\*/.exec(raw);
          return { text: tlStripInline(raw), raw: raw, strong: sm ? sm[1] : undefined };
        });
        var data = tlParseList(items);
        if (data) {
          out.push('', tlRender(data), '');
          return;
        }
      }
      for (var fk = 0; fk < src.length; fk++) out.push(src[fk]);
    }

    while (i < n) {
      var line = lines[i];
      // 代码围栏：整块原样保留
      if (/^\s*```/.test(line)) {
        flushList();
        inFence = !inFence;
        out.push(line);
        i++;
        continue;
      }
      if (inFence) { out.push(line); i++; continue; }
      // raw HTML 块（style/div/svg/注释，含既有时间轴骨架）：原样保留，不重复升级
      if (/^\s*<(style|div|svg)\b/i.test(line) || /^\s*<!--/.test(line)) {
        flushList();
        var isStyle = /^\s*<style\b/i.test(line);
        var isSvg = /^\s*<svg[\s>]/i.test(line);
        var isComment = /^\s*<!--/.test(line);
        var depth = 0;
        while (i < n) {
          var bl = lines[i];
          out.push(bl);
          if (isComment) { if (/-->/.test(bl)) { i++; break; } }
          else if (isStyle) { if (/<\/style\s*>/i.test(bl)) { i++; break; } }
          else if (isSvg) { if (/<\/svg\s*>/i.test(bl)) { i++; break; } }
          else {
            var ot = bl.match(/<div\b/gi); depth += ot ? ot.length : 0;
            var ct = bl.match(/<\/div>/gi); depth -= ct ? ct.length : 0;
            if (depth <= 0) { i++; break; }
          }
          i++;
        }
        continue;
      }
      // 表格块：时间轴表格 → 卡片，其余原样
      if (line.indexOf('|') !== -1 && i + 1 < n && isTableSep(lines[i + 1])) {
        flushList();
        var tHeader = splitTableRow(line);
        var tStart = i;
        i += 2;
        var tRows = [];
        while (i < n && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') {
          tRows.push(splitTableRow(lines[i]));
          i++;
        }
        var tData = tlDetectTable(tHeader.map(tlStripInline), tRows.map(function (r) { return r.map(tlStripInline); }), tRows);
        if (tData) {
          out.push('', tlRender(tData), '');
        } else {
          for (var tk = tStart; tk < i; tk++) out.push(lines[tk]);
        }
        continue;
      }
      // 列表行（含 •▸► 符号）
      if (/^\s*(?:[-*+•▸►]|\d+[.)])\s+\S/.test(line)) { listLines.push(line); i++; continue; }
      // 缩进续行并入上一条列表项
      if (listLines.length && /^\s+\S/.test(line)) {
        listLines[listLines.length - 1] += ' ' + line.trim();
        i++;
        continue;
      }
      // 空行：后续仍是列表项则继续累积（与 renderMarkdown 的列表解析一致）
      if (line.trim() === '' && listLines.length) {
        var j = i + 1;
        while (j < n && lines[j].trim() === '') j++;
        if (j < n && /^\s*(?:[-*+•▸►]|\d+[.)])\s+\S/.test(lines[j])) { listLines.push(line); i++; continue; }
      }
      flushList();
      out.push(line);
      i++;
    }
    flushList();
    return out.join('\n');
  }

  /* ---------- Main renderer ---------- */

  function renderMarkdown(md) {
    if (md === null || md === undefined) return '';
    md = String(md).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    var lines = md.split('\n');
    var html = [];
    var i = 0;
    var n = lines.length;

    while (i < n) {
      var line = lines[i];

      // Blank line
      if (line.trim() === '') { i++; continue; }

      // Inline SVG block（G-SPEC 封面/示意图）：净化后原样渲染，不转义
      if (/^\s*<svg[\s>]/i.test(line)) {
        var svgBuf = [];
        while (i < n) {
          svgBuf.push(lines[i]);
          if (/<\/svg\s*>/i.test(lines[i])) { i++; break; }
          i++;
        }
        html.push(sanitizeSvg(svgBuf.join('\n')));
        continue;
      }

      // 独立 HTML 注释（骨架自带的用法说明）：静默跳过
      if (/^\s*<!--/.test(line)) {
        while (i < n && !/-->/.test(lines[i])) i++;
        i++;
        continue;
      }

      // Raw HTML block（G-SPEC 时间轴骨架等 <style>/<div>）：净化放行 + 样式作用域化
      if (/^\s*<(style|div)\b/i.test(line)) {
        var isStyleBlk = /^\s*<style\b/i.test(line);
        var htmlBuf = [];
        var depth = 0;
        while (i < n) {
          var hline = lines[i];
          htmlBuf.push(hline);
          if (isStyleBlk) {
            if (/<\/style\s*>/i.test(hline)) { i++; break; }
          } else {
            var openTags = hline.match(/<div\b/gi); depth += openTags ? openTags.length : 0;
            var closeTags = hline.match(/<\/div>/gi); depth -= closeTags ? closeTags.length : 0;
            if (depth <= 0) { i++; break; }
          }
          i++;
        }
        var frag = sanitizeHtmlFragment(htmlBuf.join('\n'));
        if (isStyleBlk) {
          frag = frag.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, function (m0, attrs, css) {
            return '<style' + attrs + '>' + scopeCss(css) + '</style>';
          });
        }
        html.push('<div class="md-embed">' + frag + '</div>');
        continue;
      }

      // Fenced code block
      var fence = line.match(RE_FENCE);
      if (fence) {
        var lang = fence[1];
        var code = [];
        i++;
        while (i < n && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++; // skip closing fence
        // ```svg / ```xml 围栏内的 SVG 同样放行渲染（模型常把封面 SVG 包进围栏）
        var codeText = code.join('\n');
        if ((lang === 'svg' || lang === 'xml') && /^\s*<svg[\s>]/i.test(codeText)) {
          html.push(sanitizeSvg(codeText));
          continue;
        }
        // ```html 围栏内的时间轴骨架（tl-* 类）放行渲染（模型有时把骨架包进围栏）
        if (lang === 'html' && /class="tl-/.test(codeText)) {
          var tlFrag = sanitizeHtmlFragment(codeText).replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, function (m0, attrs, css) {
            return '<style' + attrs + '>' + scopeCss(css) + '</style>';
          });
          html.push('<div class="md-embed">' + tlFrag + '</div>');
          continue;
        }
        html.push('<pre><code' + (lang ? ' class="lang-' + escapeHtml(lang) + '"' : '') + '>' +
          escapeHtml(codeText) + '</code></pre>');
        continue;
      }

      // Heading
      var h = line.match(RE_HEADING);
      if (h) {
        var level = h[1].length;
        html.push('<h' + level + '>' + renderInline(escapeHtml(h[2].trim())) + '</h' + level + '>');
        i++;
        continue;
      }

      // Horizontal rule
      if (RE_HR.test(line)) { html.push('<hr>'); i++; continue; }

      // Blockquote (recursive)
      if (RE_QUOTE.test(line)) {
        var quote = [];
        while (i < n && RE_QUOTE.test(lines[i])) {
          quote.push(lines[i].replace(RE_QUOTE, ''));
          i++;
        }
        html.push('<blockquote>' + renderMarkdown(quote.join('\n')) + '</blockquote>');
        continue;
      }

      // Table
      if (line.indexOf('|') !== -1 && i + 1 < n && isTableSep(lines[i + 1])) {
        var headers = splitTableRow(line);
        var aligns = splitTableRow(lines[i + 1]).map(function (c) {
          var l = c.charAt(0) === ':';
          var r = c.length > 0 && c.charAt(c.length - 1) === ':';
          return (l && r) ? 'center' : (r ? 'right' : (l ? 'left' : ''));
        });
        i += 2;
        var rows = [];
        while (i < n && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') {
          rows.push(splitTableRow(lines[i]));
          i++;
        }
        // v0.52.3：时间轴表格 → 可视化卡片（参考 voice_transcription richRender 的时间轴表格升级）
        var tlData = tlDetectTable(headers.map(tlStripInline), rows.map(function (r) { return r.map(tlStripInline); }), rows);
        if (tlData) { html.push(tlRender(tlData)); continue; }
        var t = '<table><thead><tr>';
        for (var hi = 0; hi < headers.length; hi++) {
          t += '<th' + (aligns[hi] ? ' style="text-align:' + aligns[hi] + '"' : '') + '>' +
            renderInline(escapeHtml(headers[hi])) + '</th>';
        }
        t += '</tr></thead><tbody>';
        for (var ri = 0; ri < rows.length; ri++) {
          t += '<tr>';
          for (var ci = 0; ci < headers.length; ci++) {
            t += '<td' + (aligns[ci] ? ' style="text-align:' + aligns[ci] + '"' : '') + '>' +
              renderInline(escapeHtml(rows[ri][ci] || '')) + '</td>';
          }
          t += '</tr>';
        }
        t += '</tbody></table>';
        html.push(t);
        continue;
      }

      // List block
      if (RE_LIST.test(line)) {
        var items = [];
        while (i < n) {
          var lm = lines[i].match(RE_LIST);
          if (lm) {
            items.push({
              indent: lm[1].replace(/\t/g, '  ').length,
              ordered: /\d/.test(lm[2]),
              text: lm[3]
            });
            i++;
          } else if (lines[i].trim() === '') {
            // Blank line: continue only if a list item follows
            if (i + 1 < n && RE_LIST.test(lines[i + 1])) { i++; } else { break; }
          } else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
            // Continuation of previous item
            items[items.length - 1].text += '\n' + lines[i].trim();
            i++;
          } else {
            break;
          }
        }
        // v0.52.3：G-SPEC「彩点 emoji + 日期」列表 → 时间轴卡片（仅平铺列表尝试；嵌套列表保持原渲染）
        if (items.length >= 2 && items.every(function (it) { return it.indent === items[0].indent; })) {
          var tlItems = items.map(function (it) {
            var sm = it.text.match(/\*\*([^*]+)\*\*/);
            return { text: tlStripInline(it.text), raw: it.text, strong: sm ? sm[1] : undefined };
          });
          var tlListData = tlParseList(tlItems);
          if (tlListData) { html.push(tlRender(tlListData)); continue; }
        }
        html.push(buildList(items));
        continue;
      }

      // Paragraph: gather consecutive plain lines
      var para = [line];
      i++;
      while (i < n && lines[i].trim() !== '' && !isBlockStart(lines[i], lines[i + 1])) {
        para.push(lines[i]);
        i++;
      }
      html.push('<p>' + renderInline(escapeHtml(para.join('\n'))).replace(/\n/g, '<br>') + '</p>');
    }

    return html.join('\n');
  }

  /* ---------- WeChat plain-text conversion ----------
   * 微信不渲染 Markdown：按预览的视觉层级转成纯文本——标题加层级符号
   * （h1→【】、h2→■），表格转成文本表格：窄表按列宽对齐（CJK/emoji 记 2 列宽），
   * 宽表转「▪ 首列值 + 键：值」块，避免长单元格把列撑爆导致错行。
   * emoji 全程按字符串处理（不拆四字节代理对），仅移除微信会显示成方框/分离字符
   * 的隐藏字符：变体选择符 U+FE0E/U+FE0F、零宽连接符 U+200D、键帽包围符 U+20E3。
   */
  function markdownToWechat(md) {
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var keepSpace = []; // 与 out 对齐：true = 表格/代码行，保留内部空格（对齐依赖）
    var inFence = false;

    // 加粗：微信聊天不支持任何文字样式，ASCII 用 Unicode 粗体近似还原预览里的加粗
    var BOLD_MAP = (function () {
      var map = {};
      for (var i = 0; i < 26; i++) {
        map[String.fromCharCode(65 + i)] = String.fromCodePoint(0x1D5D4 + i); // 𝗔-𝗭
        map[String.fromCharCode(97 + i)] = String.fromCodePoint(0x1D5EE + i); // 𝗮-𝘇
      }
      for (var d = 0; d < 10; d++) map[String.fromCharCode(48 + d)] = String.fromCodePoint(0x1D7EC + d); // 𝟬-𝟵
      return map;
    })();

    function boldify(text) {
      return String(text).replace(/[A-Za-z0-9]/g, function (ch) { return BOLD_MAP[ch] || ch; });
    }

    // GitHub 风格告警标注 → 图标（> [!warning] 标题）
    var CALLOUT_ICONS = {
      note: 'ℹ', info: 'ℹ', tip: '💡', hint: '💡', important: '❗',
      warning: '⚠', caution: '⚠', danger: '🚨', error: '🚨', success: '✅',
      question: '❓', example: '📌', quote: '💬'
    };

    function inline(t) {
      return String(t)
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '$1 $2')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1（$2）')
        .replace(/\*\*([^*]+)\*\*/g, function (mm, s) { return boldify(s); })
        .replace(/__([^_]+)__/g, function (mm, s) { return boldify(s); })
        .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
        .replace(/(^|[^\w_])_([^_\n]+)_(?![\w_])/g, '$1$2')
        .replace(/~~([^~]+)~~/g, '$1')
        .replace(/`([^`]+)`/g, '$1');
    }

    // 显示宽度：CJK/全角/常见 emoji 记 2，其余记 1
    // （SMP 中的数学字母/Unicode 粗体按普通字母宽度，CJK 扩展与 emoji 仍记 2）
    function isWide(cp) {
      if (cp >= 0x20000 && cp <= 0x3FFFF) return true;   // CJK 扩展 B+
      if (cp >= 0x1F000 && cp <= 0x1FBFF) return true;   // emoji 与符号
      if (cp >= 0x10000) return false;                    // 数学字母等窄字符
      return (cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF) ||
        (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF) ||
        (cp >= 0xFE30 && cp <= 0xFE4F) || (cp >= 0xFF00 && cp <= 0xFF60) ||
        (cp >= 0xFFE0 && cp <= 0xFFE6) || (cp >= 0x2600 && cp <= 0x27BF);
    }

    function strWidth(s) {
      var w = 0;
      for (var i = 0; i < s.length; ) {
        var cp = s.codePointAt(i);
        var n = cp >= 0x10000 ? 2 : 1;
        w += isWide(cp) ? 2 : 1;
        i += n;
      }
      return w;
    }

    // 断行单元：英文/数字成词，CJK 与 emoji 可单字断行，空格独立
    function wrapTokens(text) {
      var tokens = [];
      var buf = '';
      var s = String(text);
      for (var i = 0; i < s.length; ) {
        var cp = s.codePointAt(i);
        var n = cp >= 0x10000 ? 2 : 1;
        var ch = s.substr(i, n);
        i += n;
        if (/\s/.test(ch)) {
          if (buf) { tokens.push(buf); buf = ''; }
          tokens.push(' ');
        } else if (isWide(cp)) {
          if (buf) { tokens.push(buf); buf = ''; }
          tokens.push(ch);
        } else {
          buf += ch;
        }
      }
      if (buf) tokens.push(buf);
      return tokens;
    }

    // 按显示宽度折行（超宽的单词按字符硬切），保证每行不超过 width 列
    function wrapText(text, width) {
      var tokens = wrapTokens(text);
      var lines = [];
      var cur = '';
      var curW = 0;
      for (var i = 0; i < tokens.length; i++) {
        var t = tokens[i];
        if (t === ' ') {
          if (cur === '') continue;
          if (curW + 1 > width) { lines.push(cur); cur = ''; curW = 0; continue; }
          cur += ' '; curW += 1;
          continue;
        }
        var tw = strWidth(t);
        if (curW + tw <= width) { cur += t; curW += tw; continue; }
        if (cur !== '') { lines.push(cur); cur = ''; curW = 0; }
        if (tw <= width) { cur = t; curW = tw; continue; }
        var chars = Array.from(t);
        var piece = '';
        var pieceW = 0;
        for (var k = 0; k < chars.length; k++) {
          var cw = strWidth(chars[k]);
          if (pieceW + cw > width && piece) { lines.push(piece); piece = ''; pieceW = 0; }
          piece += chars[k]; pieceW += cw;
        }
        cur = piece; curW = pieceW;
      }
      if (cur !== '') lines.push(cur);
      return lines.length ? lines : [''];
    }

    function spaces(n) { return n > 0 ? Array(n + 1).join(' ') : ''; }

    function padCell(s, width, align) {
      var gap = width - strWidth(s);
      if (gap <= 0) return s;
      if (align === 'right') return spaces(gap) + s;
      if (align === 'center') {
        var left = Math.floor(gap / 2);
        return spaces(left) + s + spaces(gap - left);
      }
      return s + spaces(gap);
    }

    // 表格 → 文本表格。列宽超出预算时压缩列宽并把单元格折行，保持表格形态；
    // 列数过多（>6）时文本表格已不可读，退回「▪ 首列值 + 键：值」块
    var TABLE_MAX_WIDTH = 60;
    var TABLE_MIN_COL = 4;
    var TABLE_MAX_COLS = 6;

    function renderTable(headers, rows, aligns) {
      var nCol = headers.length;
      var widths = [];
      var ci, r;
      for (ci = 0; ci < nCol; ci++) widths.push(strWidth(headers[ci] || ''));
      for (r = 0; r < rows.length; r++) {
        for (ci = 0; ci < nCol; ci++) {
          var w = strWidth(rows[r][ci] || '');
          if (w > widths[ci]) widths[ci] = w;
        }
      }

      if (nCol > TABLE_MAX_COLS) {
        var blocks = [];
        for (r = 0; r < rows.length; r++) {
          var b = ['▪ ' + (rows[r][0] || '')];
          for (ci = 1; ci < nCol; ci++) {
            var v = rows[r][ci] || '';
            if (v !== '') b.push('  ' + (headers[ci] || '') + '：' + v);
          }
          blocks.push(b.join('\n'));
        }
        return blocks.join('\n\n');
      }

      var budget = TABLE_MAX_WIDTH - (nCol - 1) * 2;
      var total = widths.reduce(function (a, b) { return a + b; }, 0);
      while (total > budget) {
        var idx = -1;
        var widest = TABLE_MIN_COL;
        for (ci = 0; ci < nCol; ci++) {
          if (widths[ci] > widest) { widest = widths[ci]; idx = ci; }
        }
        if (idx === -1) break;
        widths[idx]--;
        total--;
      }

      var grid = [];
      function pushRow(cells) {
        var wrapped = cells.map(function (c, i) { return wrapText(c || '', widths[i]); });
        var height = 0;
        for (var k = 0; k < wrapped.length; k++) {
          if (wrapped[k].length > height) height = wrapped[k].length;
        }
        for (var ln = 0; ln < height; ln++) {
          var line = [];
          for (var c = 0; c < nCol; c++) {
            line.push(padCell(wrapped[c][ln] || '', widths[c], aligns[c]));
          }
          grid.push(line.join('  '));
        }
      }

      pushRow(headers);
      var sep = [];
      for (ci = 0; ci < nCol; ci++) sep.push(Array(widths[ci] + 1).join('─'));
      grid.push(sep.join('  '));
      for (r = 0; r < rows.length; r++) pushRow(rows[r]);
      return grid.join('\n');
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m;

      // 代码围栏标记丢弃，正文原样保留（保留缩进，与预览一致）
      if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
      if (inFence) { out.push(line); keepSpace.push(true); continue; }

      // 表格块：表头行 + 分隔行 + 数据行（与 renderMarkdown 的解析一致）
      if (line.indexOf('|') !== -1 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        var headers = splitTableRow(line).map(function (c) { return inline(c); });
        var aligns = splitTableRow(lines[i + 1]).map(function (c) {
          var l = c.charAt(0) === ':';
          var rr = c.length > 0 && c.charAt(c.length - 1) === ':';
          return (l && rr) ? 'center' : (rr ? 'right' : (l ? 'left' : ''));
        });
        i += 2;
        var rows = [];
        while (i < lines.length && lines[i].indexOf('|') !== -1 && lines[i].trim() !== '') {
          rows.push(splitTableRow(lines[i]).map(function (c) { return inline(c); }));
          i++;
        }
        out.push(renderTable(headers, rows, aligns));
        keepSpace.push(true);
        continue;
      }

      // 水平线
      if (/^\s*([-*_])\s*(?:\1\s*){2,}$/.test(line)) { out.push('————————'); keepSpace.push(false); continue; }

      // 引用块：整块保留（▎ 前缀），块内列表符号与层级照旧；> [!warning] 等标注转图标
      if (/^\s*>/.test(line)) {
        var quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, '').replace(/\s+$/, ''));
          i++;
        }
        i--; // 补偿 for 自增
        var icon = '';
        if (quote.length) {
          var callout = quote[0].match(/^\[!(\w+)\]\s*(.*)$/);
          if (callout) {
            icon = CALLOUT_ICONS[callout[1].toLowerCase()] || '📌';
            quote[0] = callout[2];
          }
        }
        var qlines = [];
        for (var qi = 0; qi < quote.length; qi++) {
          var q = quote[qi];
          if (q === '') { qlines.push(''); continue; }
          var qul = q.match(/^[-*+]\s+(.*)$/);
          var qol = q.match(/^(\d+)[.)]\s+(.*)$/);
          var qbody = qul ? '• ' + inline(qul[1]) : (qol ? qol[1] + '. ' + inline(qol[2]) : inline(q));
          qlines.push('▎ ' + (qi === 0 && icon ? icon + ' ' : '') + qbody);
        }
        out.push(qlines.join('\n'));
        keepSpace.push(false);
        continue;
      }

      // 标题：h1 →【标题】，h2 → ■，h3 → ▍，h4-h6 → ▸；emoji 原样保留
      m = line.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
      if (m) {
        var htxt = inline(m[2].trim());
        var lvl = m[1].length;
        out.push(lvl === 1 ? '【' + htxt + '】' : (lvl === 2 ? '■ ' + htxt : (lvl === 3 ? '▍ ' + htxt : '▸ ' + htxt)));
        keepSpace.push(false);
        continue;
      }

      // 加粗编号：**1. 标题** 详述 → "1. 标题：详述"
      m = line.match(/^\s*\*\*\s*(\d+)[.)]\s*([^*]+?)\s*\*\*\s*(.*)$/);
      if (m) { out.push(m[1] + '. ' + m[2] + (m[3] ? '：' + m[3] : '')); keepSpace.push(false); continue; }

      // 无序列表（- * +，含任务列表与缩进层级）
      m = line.match(/^(\s*)([-*+])\s+(.*)$/);
      if (m) {
        var indent = '  '.repeat(Math.floor(m[1].replace(/\t/g, '  ').length / 2));
        var body = m[3];
        var task = body.match(/^\[([ xX])\]\s*([\s\S]*)$/);
        var marker = '• ';
        if (task) { marker = (task[1] === ' ') ? '☐ ' : '☑ '; body = task[2]; }
        out.push(indent + marker + inline(body));
        keepSpace.push(false);
        continue;
      }

      // 有序列表
      m = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
      if (m) {
        var indent2 = '  '.repeat(Math.floor(m[1].replace(/\t/g, '  ').length / 2));
        out.push(indent2 + m[2] + '. ' + inline(m[3]));
        keepSpace.push(false);
        continue;
      }

      // 孤立的表格分隔行（无表头）直接丢弃
      if (line.indexOf('|') !== -1 && /^\s*\|?[\s:|-]+\|?\s*$/.test(line)) continue;

      out.push(inline(line));
      keepSpace.push(false);
    }

    // 逐行清理：普通行压缩多余空格，表格/代码行只去行尾空白（保住对齐与缩进）
    return out.map(function (ln, k) {
      ln = String(ln).replace(/[ \t]+$/gm, '');
      if (!keepSpace[k]) ln = ln.replace(/(\S)[ \t]{2,}/g, '$1 ');
      return ln;
    }).join('\n')
      .replace(/[\uFE0E\uFE0F\u200D\u20E3]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\n+$/g, '');
  }

  global.renderMarkdown = renderMarkdown;
  global.markdownEscapeHtml = escapeHtml;
  global.markdownToWechat = markdownToWechat;
  global.upgradeMarkdownTimeline = upgradeMarkdownTimeline;
})(typeof window !== 'undefined' ? window : this);
