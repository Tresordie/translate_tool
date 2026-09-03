// 记录反向同步（v0.25.0）：localStorage 写入 → chrome.storage（扩展侧同步，映射表见 background.js）
        function elRelayRecord(key, value) {
            try {
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
                    chrome.runtime.sendMessage({ action: 'linguaflow:saveRecord', key: key, value: value }, function () {});
                } else {
                    (window.top || window).postMessage({ source: 'linguaflow-page', type: 'save-record', key: key, value: value }, '*');
                }
            } catch (e) {}
        }

// ===== Chrome Extension Storage Adapter =====
        // Safely bridge localStorage <-> chrome.storage.local
        // If anything fails, fall back to native localStorage (page still works)
        (function() {
          try {
            if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

            // Test that chrome.storage.local actually works
            chrome.storage.local.get('__test__', function() {
              if (chrome.runtime.lastError) return;
            });

            // Copy existing localStorage data into chrome.storage for sync
            try {
              var keys = ['apiConfig', 'englishLearningData', 'learningHistory'];
              keys.forEach(function(k) {
                var val = window.localStorage.getItem(k);
                if (val !== null) {
                  var obj = {};
                  obj[k] = val;
                  chrome.storage.local.set(obj);
                }
              });
            } catch(e) {}

            // Listen for changes from other extension pages
            chrome.storage.onChanged.addListener(function(changes) {
              Object.keys(changes).forEach(function(k) {
                if (changes[k].newValue !== undefined) {
                  // chrome.storage 的值可能是对象，必须序列化后写入 localStorage，
                  // 否则存成 "[object Object]" 会毒化共享 origin 的其他模块（JSON.parse 崩溃）
                  try {
                    var nv = changes[k].newValue;
                    window.localStorage.setItem(k, typeof nv === 'string' ? nv : JSON.stringify(nv));
                  } catch(e) {}
                }
              });
            });
          } catch(e) {
            // Any error -> use native localStorage, page still functional
            console.warn('[EnglishLearning] Storage adapter skipped:', e.message);
          }
        })();

        console.log('%c✨ 英语学习助手 v5.0 已加载', 'color: #F59E0B; font-size: 18px; font-weight: bold;');

        const wordEditor = MdEditor.create(document.getElementById('wordInput'), {
          placeholder: '输入英文单词/短语或中文，例如: apple / 苹果 / hello world',
          onInput: updateMdPreview
        });

        // ===== MdEditor helpers =====
        let _mdPreviewOpen = false;
        function toggleMdPreview() {
          _mdPreviewOpen = !_mdPreviewOpen;
          const panel = document.getElementById('mdPreviewPanel');
          const btn = document.getElementById('previewToggleBtn');
          if (_mdPreviewOpen) {
            panel.style.display = 'block';
            if (btn) btn.classList.add('active');
            updateMdPreview();
          } else {
            panel.style.display = 'none';
            if (btn) btn.classList.remove('active');
          }
        }
        function updateMdPreview() {
          if (!_mdPreviewOpen || !wordEditor) return;
          const text = wordEditor.getMarkdown();
          const preview = document.getElementById('mdPreviewContent');
          if (preview) {
            if (text.trim()) {
              preview.innerHTML = renderMarkdown(text);
            } else {
              preview.innerHTML = '<p style="color:var(--el-text-faint);font-style:italic;">输入内容即可实时预览...</p>';
            }
          }
        }

        const presets = {
            deepseek: { url: 'https://api.deepseek.com', model: 'deepseek-v4-pro' },
            openai: { url: 'https://api.openai.com/v1', model: 'gpt-4o' },
            siliconflow: { url: 'https://api.siliconflow.cn/v1', model: 'Pro/deepseek-ai/DeepSeek-V3' },
            ollama: { url: 'http://localhost:11434/v1', model: 'llama2' },
            custom: { url: '', model: '' }
        };

        function usePreset(service) {
            const preset = presets[service];
            document.getElementById('apiUrl').value = preset.url;
            document.getElementById('modelName').value = preset.model;
            
            if (service === 'custom') {
                document.getElementById('apiUrl').focus();
            }
            
            showTestResult('info', `已选择预设，请填写 API Key 后测试连接`);
        }

        async function testApiConnection() {
            const apiUrl = document.getElementById('apiUrl').value.trim();
            const apiKey = document.getElementById('apiKey').value.trim();
            const modelName = document.getElementById('modelName').value.trim();
            const testBtn = document.getElementById('testBtn');
            
            if (!apiUrl || !apiKey || !modelName) {
                showTestResult('error', '请填写完整的API配置信息');
                return;
            }
            
            testBtn.innerHTML = '<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;stroke-width:1.5;fill:none;animation:elSpin 0.8s linear infinite"><circle cx="12" cy="12" r="10" stroke-dasharray="30 70"/></svg> 测试中...';
            testBtn.disabled = true;

            try {
                // URL 归一化 + 推理模型参数自适应：与 AiService.chat() 同一模式（推理模型不发送 max_tokens）
                const _as = window.AiService || {};
                const _url = _as.buildUrl ? _as.buildUrl(apiUrl) : apiUrl.replace(/\/+$/, '') + '/chat/completions';
                const _reasoning = _as.isReasoningModel ? _as.isReasoningModel(modelName) : false;
                const _pf = _as.proxyFetch || fetch;
                const reqBody = { model: modelName, messages: [{ role: 'user', content: 'Hello! Connection test.' }] };
                if (!_reasoning) reqBody.max_tokens = 50;
                const response = await _pf(_url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify(reqBody)
                });

                if (!response.ok) {
                    await response.text();
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                const reply = data.choices[0].message.content;
                
                showTestResult('success', `连接成功！模型: ${data.model || modelName}<br><p>AI回复: ${escapeHtml(reply)}</p><p style="margin-top: 10px;"><strong>配置可以正常使用！</strong></p>`);
                
            } catch (error) {
                showTestResult('error', `连接失败<br><p><strong>错误:</strong> ${escapeHtml(error.message)}</p>`);
            } finally {
                testBtn.innerHTML = '<svg viewBox="0 0 24 24" style="width:18px;height:18px;stroke:currentColor;stroke-width:1.5;fill:none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> 测试连接';
                testBtn.disabled = false;
            }
        }

        function showTestResult(type, message) {
            const testResult = document.getElementById('testResult');
            testResult.className = `el-test-result ${type}`;
            testResult.innerHTML = message;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function saveApiConfig() {
            const apiUrl = document.getElementById('apiUrl').value.trim();
            const apiKey = document.getElementById('apiKey').value.trim();
            const modelName = document.getElementById('modelName').value.trim();
            
            if (!apiUrl || !apiKey || !modelName) {
                showTestResult('error', '请填写完整的API配置信息');
                return;
            }
            
            localStorage.setItem('apiConfig', JSON.stringify({ apiUrl, apiKey, modelName, savedAt: new Date().toISOString() }));
            showTestResult('success', `配置已保存！<br><p>URL: ${apiUrl}</p><p>Model: ${modelName}</p>`);
        }

        function clearApiConfig() {
            if (confirm('确定要清除API配置吗?')) {
                document.getElementById('apiUrl').value = '';
                document.getElementById('apiKey').value = '';
                document.getElementById('modelName').value = '';
                localStorage.removeItem('apiConfig');
                document.getElementById('testResult').style.display = 'none';
                document.querySelectorAll('.el-preset-card').forEach(card => card.classList.remove('active'));
            }
        }

        function loadApiConfig() {
            var config;
            try { config = JSON.parse(localStorage.getItem('apiConfig')); } catch(e) { config = null; }
            if (config) {
                document.getElementById('apiUrl').value = config.apiUrl || '';
                document.getElementById('apiKey').value = config.apiKey || '';
                document.getElementById('modelName').value = config.modelName || '';
            }
        }

        // ===== 插件配置同步（LinguaFlow 扩展广播） =====
        function applySyncedApiConfig(cfg) {
            if (!cfg || !cfg.baseUrl) return;
            const apiUrlEl = document.getElementById('apiUrl');
            const apiKeyEl = document.getElementById('apiKey');
            const modelEl = document.getElementById('modelName');
            if (cfg.baseUrl && apiUrlEl) apiUrlEl.value = cfg.baseUrl;
            if (cfg.apiKey && apiKeyEl) apiKeyEl.value = cfg.apiKey;
            if (cfg.model && modelEl) modelEl.value = cfg.model;
            try {
                localStorage.setItem('apiConfig', JSON.stringify({ apiUrl: cfg.baseUrl, apiKey: cfg.apiKey, modelName: cfg.model, savedAt: new Date().toISOString() }));
            } catch (e) {}
            if (typeof showTestResult === 'function') showTestResult('success', `已同步插件配置（Base URL / API Key / Model）`);
        }
        // 网页环境：content script 通过 postMessage 广播
        window.addEventListener('message', (e) => {
            const d = e.data;
            if (d && d.source === 'linguaflow-extension' && d.config) applySyncedApiConfig(d.config);
        });
        // 扩展环境：直接监听 chrome.storage
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === 'local' && changes.config && changes.config.newValue) {
                    applySyncedApiConfig(changes.config.newValue);
                }
            });
            chrome.storage.local.get(['config'], ({ config: xcfg }) => {
                if (xcfg && xcfg.baseUrl) applySyncedApiConfig(xcfg);
            });
        }

        function toggleSection(sectionId) {
            const content = document.getElementById(`${sectionId}-content`);
            const icon = document.getElementById(`apiConfig-icon`);
            
            if (content.classList.contains('collapsed')) {
                content.classList.remove('collapsed');
                icon.classList.remove('collapsed');
            } else {
                content.classList.add('collapsed');
                icon.classList.add('collapsed');
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            loadApiConfig();
            loadFromStorage();
            displayHistory();
            try { initVoices(); } catch(e) { console.warn('[EL] initVoices:', e.message); }
            try { if (speechSynthesis && speechSynthesis.onvoiceschanged !== undefined) { speechSynthesis.onvoiceschanged = initVoices; } } catch(e) {}
            try {
                if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.get(['apiConfig', 'englishLearningData', 'learningHistory'], function(data) {
                        if (chrome.runtime.lastError) return;
                        var needsReload = false;
                        ['apiConfig', 'englishLearningData', 'learningHistory'].forEach(function(k) {
                            if (data[k] !== undefined && !localStorage.getItem(k)) {
                                localStorage.setItem(k, typeof data[k] === 'string' ? data[k] : JSON.stringify(data[k]));
                                needsReload = true;
                            }
                        });
                        if (needsReload) {
                            loadApiConfig();
                            loadFromStorage();
                            displayHistory();
                        }
                    });
                }
            } catch(e) {}
        });

        function getSelectedLang() {
            const langSelect = document.getElementById('langSelect');
            return langSelect ? langSelect.value : 'en-US';
        }

        function initVoices() {
            const voiceSelect = document.getElementById('voiceSelect');
            const langSelect = document.getElementById('langSelect');
            if (!voiceSelect) return;
            const voices = speechSynthesis.getVoices();
            const currentLang = langSelect ? langSelect.value : 'en-US';
            voiceSelect.innerHTML = '';

            // Filter voices by selected language (match prefix, e.g. 'en' matches 'en-US', 'en-GB')
            const langPrefix = currentLang.split('-')[0];
            const filtered = voices.filter(v => v.lang.startsWith(langPrefix));
            const list = filtered.length > 0 ? filtered : voices;

            list.forEach(voice => {
                const option = document.createElement('option');
                option.value = voice.name;
                option.textContent = `${voice.name} (${voice.lang})`;
                if (voice.lang === currentLang) option.selected = true;
                voiceSelect.appendChild(option);
            });

            // If no voice matched the exact lang, select first one
            if (!voiceSelect.value && voiceSelect.options.length > 0) {
                voiceSelect.selectedIndex = 0;
            }
        }

        function speakWord() {
            const word = wordEditor.getMarkdown().trim();
            if (!word) return;
            stopSpeaking();
            
            const utterance = new SpeechSynthesisUtterance(word);
            const voices = speechSynthesis.getVoices();
            const selectedVoice = voices.find(v => v.name === document.getElementById('voiceSelect').value);
            if (selectedVoice) {
                utterance.voice = selectedVoice;
                utterance.lang = selectedVoice.lang;
            } else {
                utterance.lang = getSelectedLang();
            }
            
            utterance.rate = parseFloat(document.getElementById('rateSlider').value);
            try { speechSynthesis.speak(utterance); } catch(e) { console.warn("[EL] speak:", e.message); }
        }

        function stopSpeaking() {
            try { if (speechSynthesis && speechSynthesis.speaking) speechSynthesis.cancel(); } catch(e) {}
        }

        function speakSlowly() {
            const word = wordEditor.getMarkdown().trim();
            if (!word) return;
            stopSpeaking();
            
            const utterance = new SpeechSynthesisUtterance(word);
            const voices = speechSynthesis.getVoices();
            const selectedVoice = voices.find(v => v.name === document.getElementById('voiceSelect').value);
            if (selectedVoice) {
                utterance.voice = selectedVoice;
                utterance.lang = selectedVoice.lang;
            } else {
                utterance.lang = getSelectedLang();
            }
            
            utterance.rate = 0.6;
            try { speechSynthesis.speak(utterance); } catch(e) { console.warn("[EL] speak:", e.message); }
        }

        document.getElementById('rateSlider').addEventListener('input', function() {
            document.getElementById('rateValue').textContent = parseFloat(this.value).toFixed(1) + 'x';
        });

        // Re-filter voices when language changes
        var langSelectEl = document.getElementById('langSelect');
        if (langSelectEl) {
            langSelectEl.addEventListener('change', function() {
                initVoices();
            });
        }

        function saveToStorage() {
            const data = {
                wordInput: wordEditor.getMarkdown(),
                resultContent: document.getElementById('resultContent').innerHTML,
                resultSectionVisible: document.getElementById('resultSection').style.display !== 'none'
            };
            localStorage.setItem('englishLearningData', JSON.stringify(data));
            elRelayRecord('englishLearningData', data);
        }

        function loadFromStorage() {
            let data = null;
            try { data = JSON.parse(localStorage.getItem('englishLearningData')); } catch(e) { data = null; }
            if (data) {
                wordEditor.setMarkdown(data.wordInput || '');
                if (data.resultSectionVisible && data.resultContent) {
                    document.getElementById('resultContent').innerHTML = data.resultContent;
                    document.getElementById('resultSection').style.display = 'block';
                }
            }
        }

        function getHistory() {
            try {
                const h = JSON.parse(localStorage.getItem('learningHistory') || '[]');
                return Array.isArray(h) ? h : [];
            } catch(e) { return []; }
        }

        function saveHistory(item) {
            const history = getHistory();
            history.unshift(item);
            if (history.length > 50) history.pop();
            localStorage.setItem('learningHistory', JSON.stringify(history));
            elRelayRecord('learningHistory', history);
            displayHistory();
        }

        function deleteHistoryItem(index, event) {
            event.stopPropagation();
            if (confirm('确定要删除这条学习记录吗?')) {
                const history = getHistory();
                history.splice(index, 1);
                localStorage.setItem('learningHistory', JSON.stringify(history));
            elRelayRecord('learningHistory', history);
                displayHistory();
            }
        }

        function clearAllHistory() {
            if (confirm('确定要清空所有学习历史吗?此操作不可撤销！')) {
                localStorage.removeItem('learningHistory');
                displayHistory();
            }
        }

        function displayHistory() {
            const history = getHistory();
            const historyList = document.getElementById('historyList');
            
            if (history.length === 0) {
                historyList.innerHTML = `
                    <div class="el-empty-state">
                        <svg viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                        <div class="el-empty-state-title">暂无学习记录</div>
                        <div class="el-empty-state-desc">开始学习你的第一个单词吧</div>
                    </div>
                `;
                return;
            }

            historyList.innerHTML = history.map((item, index) => `
                <div class="el-history-item" data-index="${index}">
                    <div style="flex: 1;">
                        <div class="el-history-word">${escapeHtml(item.label || item.word)}</div>
                        <div class="el-history-time">${new Date(item.timestamp).toLocaleString('zh-CN')}</div>
                    </div>
                    <div class="el-history-actions">
                        <button class="el-btn-delete-sm" data-del-index="${index}">
                            <svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            删除
                        </button>
                    </div>
                </div>
            `).join('');
        }

        function loadHistory(index) {
            const history = getHistory();
            const item = history[index];
            wordEditor.setMarkdown(item.word);
            // Re-render from raw content if available, else use stored innerHTML
            if (item.rawContent) {
                document.getElementById('resultContent').innerHTML = `<div class="el-result-card"><div class="el-result-card-title"><svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:var(--el-accent);stroke-width:1.5;fill:none"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> 学习结果</div><div class="md-rendered">${renderMarkdown(item.rawContent)}</div></div>`;
            } else {
                document.getElementById('resultContent').innerHTML = item.content;
            }
            document.getElementById('resultSection').style.display = 'block';
            saveToStorage();
        }

        async function learnWord() {
            const word = wordEditor.getMarkdown().trim();
            const apiUrl = document.getElementById('apiUrl').value.trim();
            const apiKey = document.getElementById('apiKey').value.trim();
            const modelName = document.getElementById('modelName').value.trim();

            if (!word) {
                showError('请输入单词或短语');
                return;
            }

            if (!apiUrl || !apiKey || !modelName) {
                showError('请先配置并测试API连接');
                return;
            }

            hideError();
            document.getElementById('loading').style.display = 'block';
            document.getElementById('resultSection').style.display = 'none';

            try {
                // URL 归一化 + 推理模型参数自适应：与 AiService.chat() 同一模式
                const _as = window.AiService || {};
                const _url = _as.buildUrl ? _as.buildUrl(apiUrl) : apiUrl.replace(/\/+$/, '') + '/chat/completions';
                const _reasoning = _as.isReasoningModel ? _as.isReasoningModel(modelName) : false;
                const _pf = _as.proxyFetch || fetch;
                // 短输入（≤4 词）按单词学习；长输入按材料提取关键词汇（v0.25.6）
                const wordCount = word.split(/\s+/).filter(Boolean).length;
                const isPassage = wordCount > 4;
                let material = word;
                if (isPassage && material.length > 15000) material = material.slice(0, 15000) + '\n[...材料过长，已截断...]';
                const SINGLE_SCHEMA = '{"word":"","phonetic_uk":"","phonetic_us":"","part_of_speech":"","chinese_meaning":"","english_definition":"","usage":"","examples":[{"en":"","zh":""}],"synonyms":[],"antonyms":[],"memory_tip":""}';
                const userPrompt = isPassage
                    ? `请从以下英语材料中提取值得学习的关键词汇（按重要性排序，最多 15 个，优先选择较难、专业或在文中关键的词，跳过最常见的基础词）。对每个词汇提供：1.音标(英美) 2.词性 3.中英文释义 4.用法 5.2-3个例句 6.同义词 7.反义词 8.记忆技巧。\n只返回 JSON 数组，不要任何其他文字。格式:\n[${SINGLE_SCHEMA}]\n\n英语材料：\n${material}`
                    : `请为"${word}"提供: 1.音标(英美) 2.词性 3.中英文释义 4.用法 5.3-5个例句 6.同义词 7.反义词 8.记忆技巧。JSON格式: ${SINGLE_SCHEMA}`;
                async function wordReq(includeTemp) {
                    const body = {
                        model: modelName,
                        messages: [
                            { role: 'system', content: isPassage ? '你是专业的英语教学助手，擅长从英语材料中提取关键词汇进行教学讲解。请用JSON格式返回结果。' : '你是专业的英语教学助手，请用JSON格式返回结果。' },
                            { role: 'user', content: userPrompt }
                        ]
                    };
                    if (!_reasoning && includeTemp) body.temperature = 0.7;
                    return await _pf(_url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${apiKey}`
                        },
                        body: JSON.stringify(body)
                    });
                }
                let res = await wordReq(!_reasoning);
                let resText = await res.text();
                // 部分推理模型收到 temperature 仍报 400 → 去参重试一次
                if (!res.ok && !_reasoning && res.status === 400 && /temperature/i.test(resText)) {
                    res = await wordReq(false);
                    resText = await res.text();
                }
                if (!res.ok) throw new Error(`API请求失败: ${res.status}${resText ? ': ' + resText.slice(0, 150) : ''}`);

                const data = JSON.parse(resText);
                const content = data.choices[0].message.content;
                
                let result;
                try {
                    if (isPassage) {
                        // 材料模式：优先 JSON 数组；容错数组被包在对象里（{words:[...]} 等）
                        const arrMatch = content.match(/\[[\s\S]*\]/);
                        if (arrMatch) {
                            const arr = JSON.parse(arrMatch[0]);
                            result = (Array.isArray(arr) && arr.length) ? arr : null;
                        }
                        if (!result) {
                            const objMatch = content.match(/\{[\s\S]*\}/);
                            if (objMatch) {
                                const o = JSON.parse(objMatch[0]);
                                const inner = o && (o.words || o.results || o.list || o.vocabulary);
                                if (Array.isArray(inner) && inner.length) result = inner;
                                else if (o && o.word) result = o;   // 模型只回了单个词也能展示
                            }
                        }
                    } else {
                        const jsonMatch = content.match(/\{[\s\S]*\}/);
                        result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
                    }
                } catch (e) {
                    result = null;
                }

                if (result) {
                    displayResult(result);
                    // 历史列表显示短标签（word 字段保留完整输入，供点击恢复编辑器内容）
                    const label = Array.isArray(result)
                        ? ((result[0] && result[0].word ? result[0].word : '词汇') + ' 等 ' + result.length + ' 词')
                        : word;
                    saveHistory({ word: word, label: label, content: content, timestamp: new Date().toISOString() });
                } else {
                    document.getElementById('resultContent').innerHTML = `<div class="el-result-card"><div class="el-result-card-title"><svg viewBox="0 0 24 24" style="width:20px;height:20px;stroke:var(--el-accent);stroke-width:1.5;fill:none"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg> 学习结果</div><div class="md-rendered">${renderMarkdown(content)}</div></div>`;
                    document.getElementById('resultSection').style.display = 'block';
                    saveHistory({ word, content: content, timestamp: new Date().toISOString() });
                }
                
                saveToStorage();

            } catch (error) {
                showError(`请求失败: ${error.message}`);
            } finally {
                document.getElementById('loading').style.display = 'none';
            }
        }

        function displayResult(result) {
            const items = Array.isArray(result) ? result : [result];
            const isBatch = Array.isArray(result) && items.length > 0;
            // 材料模式：先给一个提取摘要，再逐词渲染完整卡片
            const summary = isBatch ? `
                <div class="el-result-card">
                    <div class="el-result-card-title">
                        <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
                        词汇提取
                    </div>
                    <p>从材料中提取了 <strong>${items.length}</strong> 个关键词汇（按重要性排序）</p>
                </div>` : '';
            const html = summary + items.map((w, i) => renderWordCard(w, isBatch ? (i + 1) + ' / ' + items.length : '')).join('<div style="height:14px"></div>');
            document.getElementById('resultContent').innerHTML = html;
            document.getElementById('resultSection').style.display = 'block';
        }

        function renderWordCard(w, badge) {
            return `
                <div class="el-result-card el-result-word-header">
                    <div class="el-result-card-title">
                        <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        ${escapeHtml(w.word || 'N/A')}
                        ${badge ? `<span style="font-size:0.8em;opacity:0.75;margin-left:8px;">${escapeHtml(badge)}</span>` : ''}
                    </div>
                    <div class="el-phonetic-grid">
                        <div class="el-phonetic-item">
                            <div class="el-phonetic-label">英式音标</div>
                            <div class="el-phonetic-value">${escapeHtml(w.phonetic_uk || 'N/A')}</div>
                        </div>
                        <div class="el-phonetic-item">
                            <div class="el-phonetic-label">美式音标</div>
                            <div class="el-phonetic-value">${escapeHtml(w.phonetic_us || 'N/A')}</div>
                        </div>
                    </div>
                    <p style="margin-top:12px"><strong>词性:</strong> ${escapeHtml(w.part_of_speech || 'N/A')}</p>
                </div>
                <div class="el-result-card">
                    <div class="el-result-card-title">
                        <svg viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                        释义
                    </div>
                    <p><strong>中文:</strong> ${renderMarkdown(w.chinese_meaning || 'N/A')}</p>
                    <p><strong>英文:</strong> ${renderMarkdown(w.english_definition || 'N/A')}</p>
                </div>
                <div class="el-result-card">
                    <div class="el-result-card-title">
                        <svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                        用法
                    </div>
                    <div class="md-rendered">${renderMarkdown(w.usage || 'N/A')}</div>
                </div>
                <div class="el-result-card">
                    <div class="el-result-card-title">
                        <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                        例句
                    </div>
                    ${(w.examples || []).map((ex, i) => `<div style="margin-bottom:12px;"><p><strong>${i+1}.</strong> ${renderMarkdown(ex.en)}</p><p style="padding-left:20px;color:var(--el-text-faint);">${renderMarkdown(ex.zh)}</p></div>`).join('')}
                </div>
                ${w.synonyms && w.synonyms.length ? `<div class="el-result-card"><div class="el-result-card-title"><svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> 同义词</div><p>${w.synonyms.join(', ')}</p></div>` : ''}
                ${w.antonyms && w.antonyms.length ? `<div class="el-result-card"><div class="el-result-card-title"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> 反义词</div><p>${w.antonyms.join(', ')}</p></div>` : ''}
                ${w.memory_tip ? `<div class="el-result-card"><div class="el-result-card-title"><svg viewBox="0 0 24 24"><path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.89-.356-1.751-.988-2.386l-.548-.547z"/></svg> 记忆技巧</div><div class="md-rendered">${renderMarkdown(w.memory_tip)}</div></div>` : ''}
            `;
        }

        // 获取UTC+8时间信息
        function getUTC8Time(date) {
            const utc8Ms = date.getTime() + (date.getTimezoneOffset() * 60000) + (8 * 3600000);
            const utc8Date = new Date(utc8Ms);
            
            const pad = n => String(n).padStart(2, '0');
            const year = utc8Date.getFullYear();
            const month = pad(utc8Date.getMonth() + 1);
            const day = pad(utc8Date.getDate());
            const hours = pad(utc8Date.getHours());
            const minutes = pad(utc8Date.getMinutes());
            const seconds = pad(utc8Date.getSeconds());
            
            const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
            const dateStr = `${year}-${month}-${day}`;
            const display = `${year}-${month}-${day} ${hours}:${minutes}:${seconds} (UTC+8)`;
            
            return { timestamp, dateStr, display, utc8Date };
        }

        function getUTC8DateString(date) {
            return getUTC8Time(date).dateStr;
        }

        function saveContent() {
            console.log('开始保存今天内容...');
            const history = getHistory();
            
            if (history.length === 0) {
                showError('还没有学习内容，请先学习一些单词');
                return;
            }

            const now = new Date();
            const utc8 = getUTC8Time(now);
            
            const todayHistory = history.filter(item => {
                const itemDate = getUTC8DateString(new Date(item.timestamp));
                return itemDate === utc8.dateStr;
            });
            
            if (todayHistory.length === 0) {
                showError('今天还没有学习内容，请先学习一些单词');
                return;
            }

            try {
                const md = generateMarkdown(todayHistory, now);
                const html = generateHTML(todayHistory, now);

                downloadFile(`${utc8.timestamp}-英语学习笔记.md`, md, 'text/markdown');
                
                setTimeout(() => {
                    downloadFile(`${utc8.timestamp}-英语学习笔记.html`, html, 'text/html');
                }, 500);

                const successMsg = `已保存今天(UTC+8) ${todayHistory.length} 个单词\n\n${utc8.timestamp}-英语学习笔记.md\n${utc8.timestamp}-英语学习笔记.html\n\n如果浏览器阻止下载,请允许弹出窗口`;
                
                showSuccess(successMsg);
                
            } catch (error) {
                console.error('保存失败:', error);
                showError(`保存失败: ${error.message}`);
            }
        }

        function showSuccess(message) {
            const errorEl = document.getElementById('errorMessage');
            errorEl.style.background = 'rgba(5, 150, 105, 0.08)';
            errorEl.style.color = '#047857';
            errorEl.style.border = '1px solid rgba(5, 150, 105, 0.2)';
            errorEl.textContent = message;
            errorEl.classList.add('active');
            
            setTimeout(() => {
                errorEl.classList.remove('active');
                errorEl.style.background = '';
                errorEl.style.color = '';
                errorEl.style.border = '';
            }, 10000);
        }

        function htmlToText(html) {
            if (!html) return '';
            const div = document.createElement('div');
            div.innerHTML = html;
            return (div.textContent || div.innerText || '').trim();
        }

        function extractText(content, field) {
            if (!content) return '';
            const re = new RegExp('<strong>\\s*' + field + '\\s*:?</strong>([\\s\\S]*?)</p>', 'i');
            const m = content.match(re);
            if (!m) return '';
            const text = htmlToText(m[1]);
            return text && text !== 'N/A' ? text : '';
        }

        function extractSection(content, field) {
            if (!content) return '';
            const re = new RegExp('<h3[^>]*>' + field + '[\\s\\S]*?</h3>([\\s\\S]*?)(?=<h3|$)', 'i');
            const m = content.match(re);
            if (!m) return '';
            const text = htmlToText(m[1]);
            return text && text !== 'N/A' ? text : '';
        }

        function extractExamples(content) {
            if (!content) return [];
            const examples = [];
            const enRegex = /<p>\s*<strong>\d+\.\s*<\/strong>\s*([\s\S]*?)<\/p>/gi;
            const zhRegex = /<p\s+style="[^"]*"[^>]*>\s*([\s\S]*?)<\/p>/gi;
            const enMatches = [...content.matchAll(enRegex)];
            const zhMatches = [...content.matchAll(zhRegex)];

            const count = Math.max(enMatches.length, zhMatches.length);
            for (let i = 0; i < count; i++) {
                const en = enMatches[i] ? htmlToText(enMatches[i][1]) : '';
                const zh = zhMatches[i] ? htmlToText(zhMatches[i][1]) : '';
                if (en || zh) {
                    examples.push({ en, zh });
                }
            }
            return examples;
        }

        function generateMarkdown(history, date) {
            let md = `# 📚 英语学习笔记\n\n`;
            md += `---\n\n`;
            md += `> 📅 **学习日期**: ${date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}\n>\n`;
            md += `> ⏰ **导出时间**: ${date.toLocaleString('zh-CN')} (UTC: ${date.toISOString()})\n>\n`;
            md += `> 📊 **今日学习**: **${history.length}** 个单词/短语\n>\n`;
            md += `> 💡 **学习建议**: 每天坚持学习10-20个单词,配合复习效果更佳!\n\n---\n\n`;
            
            md += `## 📖 目录\n\n`;
            history.forEach((item, index) => {
                const time = new Date(item.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
                const anchor = item.word.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-');
                md += `${index + 1}. [**${item.word}**](#${anchor}) - _${time}_\n`;
            });
            md += `\n---\n\n`;
            
            history.forEach((item, index) => {
                const anchor = item.word.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '-').replace(/-+/g, '-');
                md += `## ${index + 1}. ${item.word} {#${anchor}}\n\n`;
                
                const content = item.content;
                
                const wordMatch = content.match(/<h3[^>]*>📝\s*([^<]+)<\/h3>/);
                if (wordMatch) {
                    md += `### 📝 基本信息\n\n`;
                }
                
                const phoneticUk = extractText(content, '英式音标');
                const phoneticUs = extractText(content, '美式音标');
                const partOfSpeech = extractText(content, '词性');
                
                if (phoneticUk || phoneticUs || partOfSpeech) {
                    md += `| 项目 | 内容 |\n|------|------|\n`;
                    if (phoneticUk) md += `| 🔊 英式音标 | ${phoneticUk} |\n`;
                    if (phoneticUs) md += `| 🔊 美式音标 | ${phoneticUs} |\n`;
                    if (partOfSpeech) md += `| 🏷️ 词性 | ${partOfSpeech} |\n`;
                    md += `\n`;
                }
                
                const chineseMeaning = extractText(content, '中文');
                const englishDefinition = extractText(content, '英文');
                if (chineseMeaning || englishDefinition) {
                    md += `### 📖 详细释义\n\n`;
                    if (chineseMeaning) md += `**🇨🇳 中文释义**:\n\n${chineseMeaning}\n\n`;
                    if (englishDefinition) md += `**🇬🇧 英文释义**:\n\n${englishDefinition}\n\n`;
                }
                
                const usage = extractSection(content, '用法');
                if (usage) {
                    md += `### 💡 用法说明\n\n${usage}\n\n`;
                }
                
                const examples = extractExamples(content);
                if (examples.length > 0) {
                    md += `### 📚 经典例句\n\n`;
                    examples.forEach((ex, i) => {
                        md += `${i + 1}. **${ex.en}**\n\n   > ${ex.zh}\n\n`;
                    });
                }
                
                const synonyms = extractText(content, '同义词');
                if (synonyms && synonyms !== 'N/A' && synonyms.trim()) {
                    md += `### 🔄 同义词\n\n`;
                    const synList = synonyms.split(/[,，]/).map(s => s.trim()).filter(s => s && s !== 'N/A');
                    if (synList.length > 0) {
                        synList.forEach(syn => { md += `- ${syn}\n`; });
                        md += `\n`;
                    }
                }
                
                const antonyms = extractText(content, '反义词');
                if (antonyms && antonyms !== 'N/A' && antonyms.trim()) {
                    md += `### ⚡ 反义词\n\n`;
                    const antList = antonyms.split(/[,，]/).map(a => a.trim()).filter(a => a && a !== 'N/A');
                    if (antList.length > 0) {
                        antList.forEach(ant => { md += `- ${ant}\n`; });
                        md += `\n`;
                    }
                }
                
                const memoryTip = extractText(content, '记忆技巧');
                if (memoryTip && memoryTip !== 'N/A' && memoryTip.trim()) {
                    md += `### 🧠 记忆技巧\n\n`;
                    md += `> 💭 ${memoryTip}\n\n`;
                }
                
                md += `---\n\n`;
            });
            
            md += `---\n\n`;
            md += `<div align="center">\n\n`;
            md += `✨ **Generated by English Learning Assistant**\n\n`;
            md += `💪 _Keep learning, keep growing!_\n\n`;
            md += `📅 _坚持每天学习,积少成多!_\n\n`;
            md += `</div>\n`;
            
            return md;
        }

        function generateHTML(history, date) {
            const cards = history.map((item, i) => `
                <div class="word-card">
                    <div class="word-header">
                        <h2>${i + 1}. ${item.word}</h2>
                        <span class="time-badge">${new Date(item.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    ${item.content}
                </div>
            `).join('');

            return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>英语学习笔记</title>
<style>body{font-family:'Plus Jakarta Sans','Inter','Noto Sans SC',sans-serif;background:#F8FAFC;padding:40px;color:#1E293B;}.container{max-width:900px;margin:0 auto;background:white;padding:50px;border-radius:20px;box-shadow:0 4px 16px rgba(0,0,0,0.05);}.header{text-align:center;margin-bottom:40px;}h1{color:#0F172A;font-size:36px;font-weight:700;}.word-card{background:#F8FAFC;padding:30px;border-radius:14px;margin:20px 0;border:1px solid rgba(15,23,42,0.08);box-shadow:0 2px 8px rgba(0,0,0,0.04);}.word-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;}.time-badge{background:linear-gradient(135deg,#F59E0B,#D97706);color:white;padding:5px 15px;border-radius:20px;font-weight:600;}</style>
</head><body><div class="container"><div class="header"><h1>📚 英语学习笔记</h1><p style="color:#64748B;">${date.toLocaleDateString('zh-CN')} | ${history.length} 个单词</p></div>${cards}</div></body></html>`;
        }

        function downloadFile(filename, content, type) {
            console.log('下载文件:', filename);
            try {
                const blob = new Blob([content], { type: type + ';charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    console.log('文件下载成功:', filename);
                }, 100);
            } catch (error) {
                console.error('下载文件失败:', error);
                throw error;
            }
        }

        function clearAll() {
            if (confirm('确定要清空所有内容吗?')) {
                wordEditor.clear();
                document.getElementById('resultContent').innerHTML = '';
                document.getElementById('resultSection').style.display = 'none';
                localStorage.removeItem('englishLearningData');
                localStorage.removeItem('learningHistory');
                displayHistory();
                hideError();
            }
        }

        function showError(message) {
            const el = document.getElementById('errorMessage');
            el.textContent = message;
            el.classList.add('active');
            setTimeout(() => hideError(), 5000);
        }

        function hideError() {
            document.getElementById('errorMessage').classList.remove('active');
        }

        wordEditor.container.addEventListener('input', function() {
            saveToStorage();
            document.getElementById('pronunciationPanel').style.display = wordEditor.getMarkdown().trim() ? 'block' : 'none';
        });

        // ===== Event Listeners (CSP compliant - no inline handlers) =====
        (function() {
            var apiConfigHeader = document.getElementById('apiConfigHeader');
            if (apiConfigHeader) apiConfigHeader.addEventListener('click', function() { toggleSection('apiConfig'); });

            document.querySelectorAll('.el-preset-card[data-preset]').forEach(function(card) {
                card.addEventListener('click', function() {
                    var preset = this.getAttribute('data-preset');
                    document.querySelectorAll('.el-preset-card').forEach(function(c) { c.classList.remove('active'); });
                    this.classList.add('active');
                    usePreset(preset);
                });
            });

            var bind = function(id, fn) {
                var el = document.getElementById(id);
                if (el) el.addEventListener('click', fn);
            };
            bind('testBtn', testApiConnection);
            bind('saveApiBtn', saveApiConfig);
            bind('clearApiBtn', clearApiConfig);
            bind('learnWordBtn', learnWord);
            bind('saveContentBtn', saveContent);
            bind('clearAllBtn', clearAll);
            bind('speakWordBtn', speakWord);
            bind('stopSpeakingBtn', stopSpeaking);
            bind('speakSlowlyBtn', speakSlowly);
            bind('clearAllHistoryBtn', clearAllHistory);
            bind('exportHistoryBtn', exportHistory);
            function exportHistory() {
                if (!history.length) return;
                const fname = 'ai-toolbox-english-history-' + new Date().toISOString().slice(0, 10) + '.json';
                if (window.AiService && window.AiService.downloadText) AiService.downloadText(fname, JSON.stringify({ history: history }, null, 2), 'application/json');
            }

            // 记录跨端实时同步（v0.25.0）：他端写入时刷新历史列表
            if (window.AiService && typeof window.AiService.onRecordSync === 'function') {
                window.AiService.onRecordSync('learningHistory', function () { displayHistory(); });
            }

        })();

        // History event delegation (CSP compliant)
        document.getElementById('historyList').addEventListener('click', function(e) {
            var delBtn = e.target.closest('[data-del-index]');
            if (delBtn) {
                e.stopPropagation();
                deleteHistoryItem(parseInt(delBtn.getAttribute('data-del-index')), e);
                return;
            }
            var historyItem = e.target.closest('.el-history-item');
            if (historyItem) {
                loadHistory(parseInt(historyItem.getAttribute('data-index')));
            }
        });
