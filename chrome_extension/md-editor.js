/**
 * md-editor.js — Textarea-based Markdown editor (raw input + live preview, no dependencies)
 *
 * Requires: markdown.js (global renderMarkdown) — used by page preview panels
 *
 * Usage:
 *   const editor = MdEditor.create(containerEl, {
 *     initialMarkdown: '# hello',     // optional
 *     placeholder: 'Type here...',    // optional
 *     onInput: (md) => { ... }        // optional, called on every change
 *   });
 *   editor.getMarkdown()   // -> raw markdown string
 *   editor.setMarkdown(md) // replace content
 *   editor.clear()
 *   editor.focus()
 *   editor.container       // the underlying <textarea> element
 *
 * Behavior:
 *   - Native <textarea> for raw Markdown input: full mouse-drag selection,
 *     Ctrl+A select-all, and standard editing behavior.
 *   - The page's preview panel renders the same text with renderMarkdown,
 *     so input content and preview format always match.
 *   - Tab inserts two spaces (list nesting); Shift+Tab outdents.
 *   - IME-safe (Chinese input etc.).
 */
(function (global) {
  'use strict';

  function create(container, options) {
    options = options || {};
    var onInput = options.onInput || function () {};
    var placeholder = options.placeholder || '';

    /* ---------- Replace container div with a native textarea ---------- */
    var ta = document.createElement('textarea');
    // Copy attributes (id / class / style / data-*) so page CSS still applies
    for (var i = 0; i < container.attributes.length; i++) {
      var a = container.attributes[i];
      try { ta.setAttribute(a.name, a.value); } catch (e) {}
    }
    ta.classList.add('md-editor-container');
    ta.setAttribute('spellcheck', 'false');
    ta.setAttribute('wrap', 'soft');
    if (placeholder) ta.setAttribute('placeholder', placeholder);
    ta.value = (options.initialMarkdown || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    container.parentNode.replaceChild(ta, container);

    /* ---------- Helpers ---------- */

    function fireInput() {
      onInput(ta.value);
    }

    /* Insert text at cursor (undo-friendly when possible) */
    function insertAtCursor(text) {
      var ok = false;
      try { ok = document.execCommand('insertText', false, text); } catch (e) {}
      if (!ok) {
        var s = ta.selectionStart, e = ta.selectionEnd;
        ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
        ta.selectionStart = ta.selectionEnd = s + text.length;
      }
    }

    /* ---------- Events ---------- */

    ta.addEventListener('input', function () {
      fireInput();
    });

    ta.addEventListener('keydown', function (e) {
      if (e.isComposing) return;

      // Tab / Shift+Tab: indent / outdent
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        var s = ta.selectionStart, ePos = ta.selectionEnd, v = ta.value;

        // No selection & plain Tab: insert two spaces at caret
        if (s === ePos && !e.shiftKey) {
          insertAtCursor('  ');
          fireInput();
          return;
        }

        // Multi-line (de)indent
        var ls = v.lastIndexOf('\n', s - 1) + 1;
        var le = v.indexOf('\n', ePos);
        if (le === -1) le = v.length;
        var block = v.slice(ls, le);
        var lines = block.split('\n');
        var out = e.shiftKey
          ? lines.map(function (ln) { return ln.replace(/^ {1,2}/, ''); })
          : lines.map(function (ln) { return '  ' + ln; });
        var newBlock = out.join('\n');
        ta.value = v.slice(0, ls) + newBlock + v.slice(le);
        ta.selectionStart = ls;
        ta.selectionEnd = ls + newBlock.length;
        fireInput();
        return;
      }
    });

    /* ---------- Public API ---------- */

    function getMarkdown() {
      return ta.value;
    }

    function setMarkdown(md) {
      ta.value = (md || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }

    function clear() {
      ta.value = '';
    }

    function focus() {
      ta.focus();
      var len = ta.value.length;
      try { ta.setSelectionRange(len, len); } catch (e) {}
    }

    return {
      container: ta,
      getMarkdown: getMarkdown,
      setMarkdown: setMarkdown,
      clear: clear,
      focus: focus
    };
  }

  global.MdEditor = { create: create };
})(typeof window !== 'undefined' ? window : this);
