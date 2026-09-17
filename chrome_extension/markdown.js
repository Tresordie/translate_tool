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

      // Fenced code block
      var fence = line.match(RE_FENCE);
      if (fence) {
        var lang = fence[1];
        var code = [];
        i++;
        while (i < n && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++; }
        i++; // skip closing fence
        html.push('<pre><code' + (lang ? ' class="lang-' + escapeHtml(lang) + '"' : '') + '>' +
          escapeHtml(code.join('\n')) + '</code></pre>');
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
})(typeof window !== 'undefined' ? window : this);
