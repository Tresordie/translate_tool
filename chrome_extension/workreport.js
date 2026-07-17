"use strict";

// ===== Generate Stars (skip if already present) =====
  const starsContainer = document.getElementById('stars');
  if (starsContainer && !starsContainer.querySelector('.star')) {
  for (let i = 0; i < 60; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = Math.random() * 100 + '%';
    star.style.top = Math.random() * 100 + '%';
    star.style.animationDelay = Math.random() * 3 + 's';
    star.style.animationDuration = (2 + Math.random() * 3) + 's';
    star.style.width = star.style.height = (1 + Math.random() * 2) + 'px';
    starsContainer.appendChild(star);
  }
  }

  // ===== Language Name Map =====
  const LANG_NAMES = {
    zh: '中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français',
    de: 'Deutsch', es: 'Español', pt: 'Português', ru: 'Русский', ar: 'العربية',
    it: 'Italiano', nl: 'Nederlands', th: 'ไทย', vi: 'Tiếng Việt', id: 'Indonesia',
    ms: 'Melayu', tr: 'Türkçe', pl: 'Polski', sv: 'Svenska', da: 'Dansk',
    fi: 'Suomi', el: 'Ελληνικά', cs: 'Čeština', ro: 'Română', hu: 'Magyar',
    uk: 'Українська', hi: 'हिन्दी', bn: 'বাংলা', he: 'עברית', fa: 'فارسی',
  };

  // English names for use in non-Chinese prompts (avoids mixing Chinese chars)
  const LANG_NAMES_EN = {
    zh: 'Chinese', en: 'English', ja: 'Japanese', ko: 'Korean', fr: 'French',
    de: 'German', es: 'Spanish', pt: 'Portuguese', ru: 'Russian', ar: 'Arabic',
    it: 'Italian', nl: 'Dutch', th: 'Thai', vi: 'Vietnamese', id: 'Indonesian',
    ms: 'Malay', tr: 'Turkish', pl: 'Polish', sv: 'Swedish', da: 'Danish',
    fi: 'Finnish', el: 'Greek', cs: 'Czech', ro: 'Romanian', hu: 'Hungarian',
    uk: 'Ukrainian', hi: 'Hindi', bn: 'Bengali', he: 'Hebrew', fa: 'Persian',
  };

  // ===== Storage abstraction (extension uses chrome.storage.local, web uses localStorage) =====
  const isExtension = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  const storage = {
    get(keys) {
      return new Promise((resolve) => {
        if (isExtension) {
          chrome.storage.local.get(keys, resolve);
        } else {
          const result = {};
          for (const k of keys) {
            try { result[k] = JSON.parse(localStorage.getItem('wr_' + k) || 'null'); } catch (e) { result[k] = null; }
          }
          resolve(result);
        }
      });
    },
    set(obj) {
      return new Promise((resolve) => {
        if (isExtension) {
          chrome.storage.local.set(obj, resolve);
        } else {
          for (const [k, v] of Object.entries(obj)) {
            localStorage.setItem('wr_' + k, JSON.stringify(v));
          }
          resolve();
        }
      });
    },
    remove(keys) {
      return new Promise((resolve) => {
        if (isExtension) {
          chrome.storage.local.remove(keys, resolve);
        } else {
          for (const k of keys) { localStorage.removeItem('wr_' + k); }
          resolve();
        }
      });
    }
  };

  // ===== State =====
  let config = {};
  let records = [];
  let summaries = [];
  var editingRecordId = null;
  var selectedRecordIds = [];
  let currentFilter = { dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' };

  // ===== DOM refs (with null guard) =====
  const $ = (id) => {
    // Try wr- prefix first (for embedded mode in index.html), then original
    let el = document.getElementById('wr-' + id);
    if (!el) el = document.getElementById(id);
    if (!el) console.error('[WorkReport] Element not found: #' + id);
    return el;
  };

  // ===== Toast =====
  function showToast(msg, type) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast ' + type + ' show';
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => { t.classList.remove('show'); }, 2200);
  }

  // ===== Escape HTML =====
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== Format date/time =====
  function formatDate(ts) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function formatDateTime(ts) {
    return formatDate(ts) + ' ' + formatTime(ts);
  }

  // ===== Settings =====
  function toggleSettings() {
    const panel = $('settingsPanel');
    if (panel) panel.classList.toggle('open');
  }

  function saveSettings() {
    try {
      config.baseUrl = $('baseUrl').value.trim().replace(/\/+$/, '');
      config.apiKey = $('apiKey').value.trim();
      config.model = $('modelName').value.trim();
      config.inputLang = $('inputLang').value;
      config.outputLang = $('outputLang').value;
      storage.set({ work_config: config }).then(() => {
        showToast('配置已保存', 'success');
        const panel = $('settingsPanel');
        if (panel) setTimeout(() => panel.classList.remove('open'), 600);
      });
    } catch (e) {
      console.error('[WorkReport] saveSettings error:', e);
      showToast('保存配置失败', 'error');
    }
  }

  // ===== Auto-save draft =====
  let draftTimer = null;
  function saveDraft() {
    const text = $('workInput').value;
    storage.set({ work_draft: text }).then(() => {
      const dot = $('draftDot');
      dot.classList.add('saved');
      setTimeout(() => dot.classList.remove('saved'), 1500);
    });
  }

  $('workInput').addEventListener('input', () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraft, 300);
    $('draftHint').textContent = '草稿已修改...';
  });

  // Auto-save on blur (focus loss)
  $('workInput').addEventListener('blur', () => {
    saveDraft();
  });

  // ===== Save / Update Record =====
  function saveRecord() {
    const text = $('workInput').value.trim();
    if (!text) {
      showToast('请输入工作内容', 'error');
      return;
    }

    if (editingRecordId) {
      // Update existing record
      var idx = -1;
      for (var i = 0; i < records.length; i++) {
        if (records[i].id === editingRecordId) { idx = i; break; }
      }
      if (idx >= 0) {
        records[idx].content = text;
        records[idx].date = formatDate(Date.now());
        records[idx].time = formatTime(Date.now());
        records[idx].timestamp = Date.now();
        // Move to top
        var updated = records.splice(idx, 1)[0];
        records.unshift(updated);
      }
      storage.set({ work_records: records }).then(() => {
        $('workInput').value = '';
        storage.remove(['work_draft']);
        $('draftHint').textContent = '输入内容自动保存草稿';
        editingRecordId = null;
        updateSaveBtnLabel();
        renderRecords();
        showToast('记录已更新', 'success');
      }).catch(function(e) {
        console.error('[WorkReport] updateRecord failed:', e);
        showToast('更新失败，请重试', 'error');
      });
      return;
    }

    // Create new record
    const now = Date.now();
    const record = {
      id: now.toString(),
      content: text,
      date: formatDate(now),
      time: formatTime(now),
      timestamp: now,
    };

    records.unshift(record);
    if (records.length > 200) records = records.slice(0, 200);

    storage.set({ work_records: records }).then(() => {
      $('workInput').value = '';
      storage.remove(['work_draft']);
      $('draftHint').textContent = '输入内容自动保存草稿';
      renderRecords();
      showToast('记录已保存 — ' + formatDateTime(now), 'success');
    }).catch(function(e) {
      console.error('[WorkReport] saveRecord failed:', e);
      var inp = $('workInput');
      if (inp) inp.value = text;
      showToast('保存失败，请重试', 'error');
    });
  }

  // ===== Edit Record (load into input) =====
  function editRecord(id) {
    for (var i = 0; i < records.length; i++) {
      if (records[i].id === id) {
        var inp = $('workInput');
        if (inp) inp.value = records[i].content;
        editingRecordId = id;
        updateSaveBtnLabel();
        inp.focus();
        showToast('正在编辑记录 — 修改后点击「更新记录」保存', 'success');
        return;
      }
    }
  }

  // ===== Cancel Edit =====
  function cancelEdit() {
    editingRecordId = null;
    var inp = $('workInput');
    if (inp) inp.value = '';
    storage.remove(['work_draft']);
    $('draftHint').textContent = '输入内容自动保存草稿';
    updateSaveBtnLabel();
  }

  // ===== Update Save Button Label =====
  function updateSaveBtnLabel() {
    var btn = $('saveRecordBtn');
    var cancelBtn = $('cancelEditBtn');
    if (editingRecordId) {
      if (btn) btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> 更新记录<span class="kbd" style="background:rgba(255,255,255,0.15);border-color:rgba(255,255,255,0.2);">Ctrl+↵</span>';
      if (cancelBtn) cancelBtn.style.display = 'flex';
    } else {
      if (btn) btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> 保存记录<span class="kbd" style="background:rgba(255,255,255,0.15);border-color:rgba(255,255,255,0.2);">Ctrl+↵</span>';
      if (cancelBtn) cancelBtn.style.display = 'none';
    }
  }

  // ===== Delete Record =====
  function deleteRecord(id) {
    records = records.filter(r => r.id !== id);
    storage.set({ work_records: records }).then(() => {
      renderRecords();
      showToast('记录已删除', 'success');
    });
  }

  // ===== Filter =====
  function getFilteredRecords() {
    let filtered = [...records];

    if (currentFilter.dateFrom) {
      filtered = filtered.filter(r => r.date >= currentFilter.dateFrom);
    }
    if (currentFilter.dateTo) {
      filtered = filtered.filter(r => r.date <= currentFilter.dateTo);
    }
    if (currentFilter.timeFrom) {
      filtered = filtered.filter(r => r.time >= currentFilter.timeFrom);
    }
    if (currentFilter.timeTo) {
      filtered = filtered.filter(r => r.time <= currentFilter.timeTo);
    }

    return filtered;
  }

  function applyFilter() {
    currentFilter.dateFrom = $('filterDateFrom').value;
    currentFilter.dateTo = $('filterDateTo').value;
    currentFilter.timeFrom = $('filterTimeFrom').value;
    currentFilter.timeTo = $('filterTimeTo').value;

    const hasFilter = currentFilter.dateFrom || currentFilter.dateTo ||
                      currentFilter.timeFrom || currentFilter.timeTo;
    $('applyFilterBtn').classList.toggle('active', hasFilter);
    $('clearFilterBtn').style.display = hasFilter ? '' : 'none';

    renderRecords();
  }

  function clearFilter() {
    $('filterDateFrom').value = '';
    $('filterDateTo').value = '';
    $('filterTimeFrom').value = '';
    $('filterTimeTo').value = '';
    currentFilter = { dateFrom: '', dateTo: '', timeFrom: '', timeTo: '' };
    $('applyFilterBtn').classList.remove('active');
    $('clearFilterBtn').style.display = 'none';
    renderRecords();
  }

  // ===== Render Records =====
  function renderRecords() {
    const filtered = getFilteredRecords();
    const list = $('recordsList');
    $('recordsCount').textContent = records.length + ' 条';

    const hasFilter = currentFilter.dateFrom || currentFilter.dateTo ||
                      currentFilter.timeFrom || currentFilter.timeTo;
    $('filteredCount').textContent = hasFilter ? '（筛选结果: ' + filtered.length + ' 条）' : '';

    if (filtered.length === 0) {
      list.innerHTML = '<div class="records-empty">' +
        (records.length === 0 ? '暂无工作记录，在上方输入内容后点击「保存记录」' : '当前筛选条件下无匹配记录') +
        '</div>';
      updateSummaryMeta(0);
      return;
    }

    updateSummaryMeta(filtered.length);
    updateSelectInfo();

    var checkedAttr;
    list.innerHTML = filtered.map(function(r) {
      checkedAttr = selectedRecordIds.indexOf(r.id) >= 0 ? ' checked' : '';
      return '<div class="record-item" data-rid="' + r.id + '">'
        + '<input type="checkbox" class="record-checkbox" data-rid="' + r.id + '"' + checkedAttr + ' title="选择此条">'
        + '<div class="record-time">'
        + '<div class="record-date">' + escapeHtml(r.date) + '</div>'
        + '<div class="record-clock">' + escapeHtml(r.time) + '</div>'
        + '</div>'
        + '<div class="record-content">' + escapeHtml(r.content) + '</div>'
        + '<button class="record-edit" data-rid="' + r.id + '" title="编辑">'
        + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
        + '</button>'
        + '<button class="record-delete" data-id="' + r.id + '" title="删除">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>'
        + '</button>'
        + '</div>';
    }).join('');

    // Checkbox change
    list.querySelectorAll('.record-checkbox').forEach(function(cb) {
      cb.addEventListener('change', function() {
        toggleSelectRecord(cb.dataset.rid);
      });
    });

    // Edit button
    list.querySelectorAll('.record-edit').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        editRecord(btn.dataset.rid);
      });
    });

    // Delete button
    list.querySelectorAll('.record-delete').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        deleteRecord(btn.dataset.id);
      });
    });
  }

  function updateSummaryMeta(count) {
    $('summaryMeta').textContent = count > 0 ? '（共 ' + count + ' 条记录）' : '';
  }

  // ===== Typing effect =====
  function typeText(element, text, speed) {
    speed = speed || 18;
    return new Promise(resolve => {
      element.innerHTML = '';
      element.classList.add('typing-cursor');
      let i = 0;
      const timer = setInterval(() => {
        if (i < text.length) {
          element.textContent += text[i];
          i++;
          element.scrollTop = element.scrollHeight;
        } else {
          clearInterval(timer);
          element.classList.remove('typing-cursor');
          resolve();
        }
      }, speed);
    });
  }

  // ===== Auto-format result =====
  function autoFormatResult(text) {
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    text = text.split('\n').map(line => line.trimEnd()).join('\n');
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.replace(/^\n+/, '').replace(/\n+$/, '');
    text = text.replace(/^([\s]*[-*+])\s{2,}/gm, '$1 ');
    text = text.replace(/^([\s]*\d+\.)\s{2,}/gm, '$1 ');
    text = text.replace(/([。！？；])([^\n\s])/g, '$1 $2');
    text = text.replace(/\s+([。！？，；：、])/g, '$1');
    return text;
  }

  // ===== Summarize =====
  async function doSummarize() {
    var filtered = getFilteredRecords();

    // If any records are manually selected, use only those
    if (selectedRecordIds.length > 0) {
      filtered = filtered.filter(function(r) { return selectedRecordIds.indexOf(r.id) >= 0; });
    }

    if (filtered.length === 0) {
      showToast('当前筛选条件下无工作记录，请调整日期范围', 'error');
      return;
    }

    if (!config.baseUrl || !config.apiKey || !config.model) {
      showToast('请先配置 API 设置', 'error');
      $('settingsPanel').classList.add('open');
      return;
    }

    const inputLang = config.inputLang || 'zh';
    const outputLang = config.outputLang || 'zh';
    // Use English language names in prompts when output is non-Chinese
    // to avoid mixing Chinese chars that trigger LLM code-switching
    const nameMap = (outputLang === 'zh') ? LANG_NAMES : LANG_NAMES_EN;
    const inputLangName = (nameMap[inputLang] || LANG_NAMES_EN[inputLang] || inputLang);
    const outputLangName = (nameMap[outputLang] || LANG_NAMES_EN[outputLang] || outputLang);

    const btn = $('summarizeBtn');
    const resultEl = $('summaryResult');
    const footer = $('summaryFooter');
    const loadingBar = $('loadingBar');

    btn.disabled = true;
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4m0 12v4m-7.07-3.93l2.83-2.83m8.48-8.48l2.83-2.83M2 12h4m12 0h4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83"/></svg> 正在生成总结...';
    resultEl.classList.add('visible');
    resultEl.innerHTML = '';
    resultEl.classList.remove('typing-cursor');
    footer.classList.remove('visible');
    loadingBar.classList.add('active');

    // Build records text
    const recordsText = filtered.map((r, i) => {
      return `[${i + 1}] ${r.date} ${r.time}\n${r.content}`;
    }).join('\n\n---\n\n');

    // Build language-aware prompt components
    const isOutputChinese = outputLang === 'zh';
    const rangeSep = isOutputChinese ? ' 至 ' : ' to ';

    const dateRange = filtered.length > 1
      ? filtered[filtered.length - 1].date + rangeSep + filtered[0].date
      : filtered[0].date;
    const sectionTitle = isOutputChinese ? '工作总结' : 'Work Summary';
    const keyPointsTitle = isOutputChinese ? '要点总结' : 'Key Points';
    const detailTitle = isOutputChinese ? '要点详述' : 'Detailed Breakdown';

    // System prompt — short and direct
    var systemPrompt;
    if (isOutputChinese) {
      systemPrompt = '你是工作汇报总结助手。请阅读以下工作记录，提取关键要点并生成结构化的中文总结。\n\n输出格式：\n## 📋 ' + sectionTitle + ' (' + dateRange + ')\n### 🔑 ' + keyPointsTitle + '\n- [要点]\n### 📝 ' + detailTitle + '\n**1. [标题]** 详细阐述';
    } else {
      // For non-Chinese output: split system+user into a translation workflow
      // that DeepSeek reliably follows
      systemPrompt = 'Role: English-only work summarizer.\nRule: You read ' + inputLangName + ' input but write ONLY in ' + outputLangName + '.\nFormat:\n## 📋 ' + sectionTitle + '\n### 🔑 ' + keyPointsTitle + '\n- point\n### 📝 ' + detailTitle + '\n**1. title** elaboration.';
    }

    // Build user message — for non-Chinese, isolate Chinese records in a clearly-marked block
    var userMsgContent;
    if (isOutputChinese) {
      userMsgContent = '请用' + outputLangName + '总结以下工作记录（' + dateRange + '）：\n\n' + recordsText;
    } else {
      userMsgContent = 'Produce a ' + outputLangName + ' summary of these work records (' + dateRange + ').\n'
        + 'Respond ENTIRELY in ' + outputLangName + '. Do NOT write any ' + inputLangName + '.\n\n'
        + '=== BEGIN INPUT (read in ' + inputLangName + ', respond in ' + outputLangName + ') ===\n'
        + recordsText
        + '\n=== END INPUT ===\n\n'
        + 'Now write the ' + outputLangName + ' summary:';
    }

    try {
      const url = config.baseUrl + '/chat/completions';
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + config.apiKey,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsgContent }
          ],
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || 'HTTP ' + response.status);
      }

      const data = await response.json();
      let result = data.choices?.[0]?.message?.content?.trim() || '';

      if (!result) throw new Error('总结结果为空，请检查模型配置');

      result = autoFormatResult(result);

      loadingBar.classList.remove('active');
      await typeText(resultEl, result);

      footer.classList.add('visible');

      // Save to summary history
      saveSummaryResult(dateRange, result, config.inputLang || 'zh', config.outputLang || 'zh');

      showToast('总结生成完成', 'success');
    } catch (err) {
      loadingBar.classList.remove('active');
      resultEl.innerHTML = '<span style="color:#ef4444;">生成失败: ' + escapeHtml(err.message) + '</span>';
      resultEl.classList.add('visible');
      showToast('总结生成失败: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> 生成总结';
    }
  }

  // ===== Copy Summary =====
  function copySummary() {
    const text = $('summaryResult').textContent;
    if (!text || text.includes('选择日期范围')) {
      showToast('暂无总结内容可复制', 'error');
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => showToast('总结已复制到剪贴板', 'success'),
      () => showToast('复制失败', 'error')
    );
  }

  // ===== Download Summary =====
  function downloadSummary(format) {
    const text = $('summaryResult').textContent;
    if (!text || text.includes('选择日期范围')) {
      showToast('暂无总结内容可下载', 'error');
      return;
    }
    var filename, mime, content;
    if (format === 'md') {
      filename = 'work-summary-' + formatDate(Date.now()) + '.md';
      mime = 'text/markdown;charset=utf-8';
      content = text;
    } else {
      filename = 'work-summary-' + formatDate(Date.now()) + '.html';
      mime = 'text/html;charset=utf-8';

      // Convert summary markdown to HTML
      var htmlBody = markdownToHtml(text);

      content = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8"/>\n'
        + '<title>Work Summary</title>\n'
        + '<style>\n'
        + '  body{font-family:Inter,"Noto Sans SC",sans-serif;background:#0a0a0f;color:#e8eaf0;'
        + 'padding:40px 48px;max-width:960px;margin:0 auto;line-height:1.85;font-size:15px;}\n'
        + '  h2{color:#a78bfa;font-size:1.5rem;border-bottom:1px solid rgba(139,92,246,0.3);padding-bottom:10px;margin:32px 0 16px;}\n'
        + '  h3{color:#22d3ee;font-size:1.15rem;margin:24px 0 10px;}\n'
        + '  h4{color:#c4b5fd;font-size:1rem;margin:18px 0 8px;}\n'
        + '  ul,ol{margin:8px 0 16px 20px;}\n'
        + '  li{margin:6px 0;line-height:1.7;}\n'
        + '  strong{color:#c4b5fd;}\n'
        + '  hr{border:none;border-top:1px solid rgba(139,92,246,0.15);margin:24px 0;}\n'
        + '  p{margin:8px 0;}\n'
        + '  code{background:rgba(139,92,246,0.12);padding:2px 6px;border-radius:4px;font-size:0.9em;}\n'
        + '  a{color:#22d3ee;}\n'
        + '</style>\n</head>\n<body>\n'
        + htmlBody
        + '\n</body>\n</html>';
    }

  // Convert summary markdown text to HTML
  function markdownToHtml(md) {
    // Escape HTML entities first
    var html = md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Split into lines
    var lines = html.split('\n');
    var result = [];
    var inList = null; // 'ul' or 'ol' or null

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      // Blank line — close any open list
      if (trimmed === '') {
        if (inList) { result.push('</' + inList + '>'); inList = null; }
        continue;
      }

      // Horizontal rule
      if (/^---+\s*$/.test(trimmed)) {
        if (inList) { result.push('</' + inList + '>'); inList = null; }
        result.push('<hr>');
        continue;
      }

      // H2: ## heading
      var m = trimmed.match(/^##\s+(.+)/);
      if (m) {
        if (inList) { result.push('</' + inList + '>'); inList = null; }
        result.push('<h2>' + m[1] + '</h2>');
        continue;
      }

      // H3: ### heading
      m = trimmed.match(/^###\s+(.+)/);
      if (m) {
        if (inList) { result.push('</' + inList + '>'); inList = null; }
        result.push('<h3>' + m[1] + '</h3>');
        continue;
      }

      // H4: #### heading
      m = trimmed.match(/^####\s+(.+)/);
      if (m) {
        if (inList) { result.push('</' + inList + '>'); inList = null; }
        result.push('<h4>' + m[1] + '</h4>');
        continue;
      }

      // Unordered list: - item or * item
      m = trimmed.match(/^[-*]\s+(.+)/);
      if (m) {
        if (inList !== 'ul') {
          if (inList) result.push('</' + inList + '>');
          result.push('<ul>');
          inList = 'ul';
        }
        result.push('<li>' + m[1] + '</li>');
        continue;
      }

      // Ordered list: 1. item
      m = trimmed.match(/^\d+\.\s+(.+)/);
      if (m) {
        if (inList !== 'ol') {
          if (inList) result.push('</' + inList + '>');
          result.push('<ol>');
          inList = 'ol';
        }
        result.push('<li>' + m[1] + '</li>');
        continue;
      }

      // End list on non-list line
      if (inList) { result.push('</' + inList + '>'); inList = null; }

      // Bold: **text**
      trimmed = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

      // Inline code: `code`
      trimmed = trimmed.replace(/`(.+?)`/g, '<code>$1</code>');

      // Regular paragraph
      result.push('<p>' + trimmed + '</p>');
    }

    // Close any open list at end
    if (inList) result.push('</' + inList + '>');

    return result.join('\n');
  }
    var blob = new Blob([content], { type: mime });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showToast(format.toUpperCase() + ' 下载完成', 'success');
  }

  // ===== Save Summary to History =====
  function saveSummaryResult(dateRange, resultText, inputLang, outputLang) {
    var now = Date.now();
    summaries.unshift({
      id: now.toString(),
      dateRange: dateRange,
      content: resultText,
      inputLang: inputLang,
      outputLang: outputLang,
      date: formatDate(now),
      time: formatTime(now),
      timestamp: now
    });
    if (summaries.length > 50) summaries = summaries.slice(0, 50);
    storage.set({ work_summaries: summaries }).then(function() {
      renderSummaryHistory();
    });
  }

  // ===== Delete Summary =====
  function deleteSummaryItem(id) {
    summaries = summaries.filter(function(s) { return s.id !== id; });
    storage.set({ work_summaries: summaries }).then(function() {
      renderSummaryHistory();
      showToast('总结已删除', 'success');
    });
  }

  // ===== Clear All Summaries =====
  function clearAllSummaries() {
    if (!confirm('确定要清空所有总结历史吗？此操作不可恢复。')) return;
    summaries = [];
    storage.set({ work_summaries: summaries }).then(function() {
      renderSummaryHistory();
      showToast('所有总结已清空', 'success');
    });
  }

  // ===== Multi-select =====
  function toggleSelectRecord(id) {
    var idx = selectedRecordIds.indexOf(id);
    if (idx >= 0) {
      selectedRecordIds.splice(idx, 1);
    } else {
      selectedRecordIds.push(id);
    }
    updateSelectInfo();
  }

  function toggleSelectAll() {
    var filtered = getFilteredRecords();
    if (selectedRecordIds.length === filtered.length && filtered.length > 0) {
      // All selected → deselect all
      selectedRecordIds = [];
    } else {
      // Select all filtered
      selectedRecordIds = filtered.map(function(r) { return r.id; });
    }
    renderRecords();
  }

  function updateSelectInfo() {
    var el = $('selectInfo');
    if (el) {
      el.textContent = selectedRecordIds.length > 0 ? '（已选 ' + selectedRecordIds.length + ' 条）' : '';
    }
  }

  // ===== Clear All Records =====
  function clearAllRecords() {
    if (!confirm('确定要清空所有工作记录吗？此操作不可恢复。')) return;
    records = [];
    storage.set({ work_records: records }).then(function() {
      renderRecords();
      showToast('所有记录已清空', 'success');
    });
  }

  // ===== Render Summary History =====
  function renderSummaryHistory() {
    var list = $('summaryHistoryList');
    var countEl = $('summaryHistoryCount');
    if (!list) return;
    if (countEl) countEl.textContent = summaries.length + ' 条';
    if (summaries.length === 0) {
      list.innerHTML = '<div class="records-empty">暂无总结历史，生成总结后自动保存</div>';
      return;
    }
    list.innerHTML = summaries.map(function(s) {
      return '<div class="record-item summary-history-item" data-sid="' + s.id + '">'
        + '<div class="record-time">'
        + '<div class="record-date">' + escapeHtml(s.date) + '</div>'
        + '<div class="record-clock">' + escapeHtml(s.time) + '</div>'
        + '</div>'
        + '<div class="record-content">'
        + escapeHtml(s.dateRange) + ' · ' + escapeHtml(LANG_NAMES[s.outputLang] || s.outputLang)
        + '<br><span style="color:var(--text-secondary);font-size:0.8rem;">'
        + escapeHtml(s.content.substring(0, 100)) + '...</span>'
        + '</div>'
        + '<button class="record-delete" title="删除">'
        + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        + '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>'
        + '</svg>'
        + '</button>'
        + '</div>';
    }).join('');

    // Click to load
    list.querySelectorAll('.summary-history-item').forEach(function(item) {
      item.addEventListener('click', function(e) {
        if (e.target.closest('.record-delete')) return;
        var sid = item.dataset.sid;
        var sm = summaries.find(function(s) { return s.id === sid; });
        if (sm) {
          var resultEl = $('summaryResult');
          var footer = $('summaryFooter');
          if (resultEl) {
            resultEl.textContent = sm.content;
            resultEl.classList.add('visible');
          }
          if (footer) footer.classList.add('visible');
          showToast('已加载 ' + sm.date + ' 的总结', 'success');
        }
      });
    });

    // Delete buttons
    list.querySelectorAll('.record-delete').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var item = btn.closest('.summary-history-item');
        if (item) deleteSummaryItem(item.dataset.sid);
      });
    });
  }

  // ===== Event Bindings (synchronous — bound immediately, before init) =====
  (function bindEventsSync() {
    var btn = $('toggleSettings');
    if (btn) btn.addEventListener('click', toggleSettings);
    btn = $('saveSettingsBtn');
    if (btn) btn.addEventListener('click', saveSettings);
    btn = $('saveRecordBtn');
    if (btn) btn.addEventListener('click', saveRecord);
    btn = $('applyFilterBtn');
    if (btn) btn.addEventListener('click', applyFilter);
    btn = $('clearFilterBtn');
    if (btn) btn.addEventListener('click', clearFilter);
    btn = $('summarizeBtn');
    if (btn) btn.addEventListener('click', doSummarize);
    btn = $('copySummaryBtn');
    if (btn) btn.addEventListener('click', copySummary);

    // Download buttons
    btn = $('downloadHtmlBtn');
    if (btn) btn.addEventListener('click', function() { downloadSummary('html'); });
    btn = $('downloadMdBtn');
    if (btn) btn.addEventListener('click', function() { downloadSummary('md'); });

    // Clear all buttons
    btn = $('clearAllRecordsBtn');
    if (btn) btn.addEventListener('click', clearAllRecords);
    btn = $('cancelEditBtn');
    if (btn) btn.addEventListener('click', cancelEdit);
    btn = $('toggleSelectAllBtn');
    if (btn) btn.addEventListener('click', toggleSelectAll);
    btn = $('clearAllSummariesBtn');
    if (btn) btn.addEventListener('click', clearAllSummaries);

    // Language selectors — update config on change
    var inputLangSel = $('inputLang');
    if (inputLangSel) {
      inputLangSel.addEventListener('change', function() {
        config.inputLang = this.value;
        storage.set({ work_config: config });
      });
    }
    var outputLangSel = $('outputLang');
    if (outputLangSel) {
      outputLangSel.addEventListener('change', function() {
        config.outputLang = this.value;
        storage.set({ work_config: config });
      });
    }

    // Keyboard shortcut
    var input = $('workInput');
    if (input) {
      input.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          saveRecord();
        }
      });
    }
  })();

  // ===== Init =====
  async function init() {
    const data = await storage.get(['work_config', 'work_records', 'work_draft', 'work_summary_config']);

    // Load config — first try work-specific config, then fall back to translate config
    let savedConfig = data.work_config;
    if (!savedConfig || !savedConfig.baseUrl) {
      // Try to load from legacy key or the translate config
      const xlateData = await storage.get(['config']);
      if (xlateData.config && xlateData.config.baseUrl) {
        savedConfig = {
          baseUrl: xlateData.config.baseUrl,
          apiKey: xlateData.config.apiKey,
          model: xlateData.config.model,
          inputLang: 'zh',
          outputLang: 'zh',
        };
      }
    }

    if (savedConfig) {
      config = savedConfig;
      if (config.baseUrl) $('baseUrl').value = config.baseUrl;
      if (config.apiKey) $('apiKey').value = config.apiKey;
      if (config.model) $('modelName').value = config.model;
      if (config.inputLang) $('inputLang').value = config.inputLang;
      if (config.outputLang) $('outputLang').value = config.outputLang;
    }

    if (!config.apiKey) {
      const panel = $('settingsPanel');
      if (panel) panel.classList.add('open');
    }

    // Load records
    records = data.work_records || [];
    renderRecords();

    // Load summaries
    summaries = data.work_summaries || [];
    renderSummaryHistory();

    // Restore draft
    if (data.work_draft) {
      const input = $('workInput');
      if (input) input.value = data.work_draft;
    }

    // Init filter clear btn visibility
    const clearBtn = $('clearFilterBtn');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  init().catch(function(e) {
    console.error('[WorkReport] init failed:', e);
  });
