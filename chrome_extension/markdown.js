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

  global.renderMarkdown = renderMarkdown;
  global.markdownEscapeHtml = escapeHtml;
})(typeof window !== 'undefined' ? window : this);
