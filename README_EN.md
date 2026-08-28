# LinguaFlow · AI Smart Translation

> An online translation tool powered by LLM APIs, available as a web app and Chrome extension, supporting 30+ languages with text selection translation.

![Version](https://img.shields.io/badge/version-0.16.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

**Language**: [中文](README.md) | English

---

## ✨ Features

### Web Version

- **30+ Languages** — Chinese, English, Japanese, Korean, French, German, Spanish, Russian, Arabic, and more
- **Flexible API** — Compatible with any OpenAI Chat Completions API provider (OpenAI, DeepSeek, Qwen, etc.)
- **Deep Context-Aware Translation** — AI performs a 5-step deep analysis before translating (domain identification → text type assessment → tone analysis → audience profiling → intent understanding) for significantly more accurate translations
- **Original Format Preservation** — Fully preserves Markdown, HTML, code blocks, and other original formats with auto-formatting after translation
- **Chrome Extension Fullscreen Mode** — New "fullscreen button" in popup top-right corner, opens full translation page in new tab (no height limit)
- **Dynamic Popup Height** — Max height set to `screen.availHeight`, can drag to screen bottom
- **12 Catppuccin Themes with One-Click Switching** — Latte / Frappé / Macchiato / Mocha flavors × Blue/Mauve/Pink/Green/Teal accent variants, each theme an independent color world (base/mantle/crust layered backgrounds, subtext/overlay text ladder, warm-cool contrast secondary accents) via floating grouped panel, glassmorphism texture, default Mocha Blue
- **Typing Effect** — Translation results appear character by character for a smooth experience
- **Translation History** — Auto-saves up to 20 recent translations with one-click recall
- **Quick Actions** — Swap languages, paste from clipboard, clear, and copy results
- **Keyboard Shortcut** — `Ctrl + Enter` to translate instantly
- **Privacy First** — All settings and history stored locally in browser localStorage
- **Responsive Design** — Works seamlessly on desktop and mobile devices
- **Work Report** — Built-in work report generator with AI one-click summary, history management, and date filtering
- **Task List** — Built-in task manager with add/complete/delete, priority levels, progress tracking, Markdown batch import/export (with checkbox syntax), Apple Reminders one-click import (URL Scheme + AppleScript file fallback), Google Calendar sync, and .ics calendar download
- **English Learning Assistant** — Built-in English learning module with word study, AI definitions, text-to-speech, learning history, and note export
- **Email Summary** — New 5th tab: paste email threads or upload local files (.txt/.md/.eml/.pdf); AI produces a professional four-section detailed summary (subject & background / timeline table / technical key points / risks & caveats) plus a responsibility-based To Do List (P0/P1/P2 priorities), with 30-language output, HTML/Markdown download, and history review & editing
  - **PDF Parsing** — Built-in pdf.js local parsing (up to 200MB) with automatic handling of huge files: reading progress indicator, early stop at text budget / page cap, per-page memory release
  - **Auto-Truncation for Oversized Content** — Over 60,000 characters, automatically keeps head & tail, omits and marks the middle — no manual splitting needed
- **Page Reuse Architecture** — Work Report, Task List, English Learning, and Email Summary tabs embed standalone pages via iframe, sharing the same codebase with Chrome extension
- **Zero Dependencies** — Pure HTML + CSS + JavaScript, no installation required

### Chrome Extension

- **Text Selection Translation** — Select text on any webpage, a translation icon appears automatically
- **Popup Translation Panel** — Click the toolbar icon for quick text translation
- **Right-click Menu** — Select text and right-click to choose "LinguaFlow Translate"
- **12 Catppuccin Theme Switching** — Shares the theme.css system with the web version, vibrant colors + glassmorphism texture
- **Deep Context-Aware Translation** — AI performs 5-step context analysis (domain/text type/tone/audience/intent) for precise translations
- **Resizable Popup** — Drag any edge or corner to freely resize the popup (320–800px wide, 300–780px tall), size auto-saved
- **Uninterrupted Translation** — Translation continues in background Service Worker even if popup closes; results auto-restored on reopen
- **Translation History** — Auto-saves up to 20 recent translations with individual deletion and clear-all
- **Original Format Preservation** — Supports Markdown, HTML format input with auto-formatting
- **Toggle Switch** — Enable/disable text selection translation in settings
- **Language Preference Memory** — Automatically saves source and target language choices
- **Email Summary Entry** — New envelope icon in popup header opens the Email Summary page in a new tab (full parity with web version, including PDF upload and 30-language output)
- **Side Panel** — Chrome 114+ dedicated side panel bundling all 5 modules (Smart Translation / Work Report / Task List / English Learning / Email Summary) with one-click tab switching and lazy-loaded iframes; open it via the popup's Side Panel button, the `Alt+Shift+L` shortcut, or the "Open LinguaFlow in Side Panel" context-menu item

## 📸 Preview

<p align="center">
  <img src="preview.png" alt="LinguaFlow Screenshot" width="800" />
</p>

## 🚀 Quick Start

### How to Use

1. Open `index.html` in any modern browser
2. Click the **"API 设置" (API Settings)** button in the top-right corner
3. Fill in the configuration:

| Field | Description | Example |
|-------|-------------|---------|
| **Base URL** | LLM API endpoint | `https://api.openai.com/v1` |
| **API Key** | Your API key | `sk-xxxxxxxxxxxxxxxx` |
| **Model** | Model name | `gpt-4o` / `deepseek-v4-pro` |

4. Click **"保存配置" (Save)**
5. Select source and target languages, enter text, and click **"开始翻译" (Translate)**

### Supported API Providers

| Provider | Base URL | Model Examples |
|----------|----------|----------------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-v4-pro` |
| Qwen (Alibaba) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Zhipu AI | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| Moonshot | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |

> Any service compatible with the OpenAI `/chat/completions` endpoint will work.

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl` + `Enter` | Start translation |

## 🛠️ Tech Stack

- Pure HTML + CSS + JavaScript (zero framework dependencies)
- Google Fonts (Inter + Noto Sans SC)
- OpenAI-compatible Chat Completions API

## 📁 Project Structure

```
translation_tool/
├── index.html              # Web app (translation main page)
├── workreport.html         # Work report page (standalone, shared with extension)
├── workreport.js           # Work report core logic (IIFE encapsulated)
├── english_learning.html    # English learning assistant page (standalone, shared)
├── todolist.html            # Task list page (standalone, with Markdown/AppleScript features)
├── todolist.js              # Task list core logic (IIFE encapsulated)
├── install_url_scheme.sh     # Apple Reminders URL Scheme bridge installer
├── theme.css               # Shared theme system (12 Catppuccin theme variables + glass cards/noise/ambient glow styles)
├── theme.js                # Theme switcher / iframe theme sync / starfield / MD preview binding
├── markdown.js             # Markdown renderer
├── md-editor.js            # Markdown editor component
├── email_summary.html      # Email summary page (standalone, shared with extension)
├── email_summary.js        # Email summary core logic (SKILL prompt / AI calls / PDF parsing / history)
├── pdf.min.js              # pdf.js 3.11.174 (PDF text extraction, bundled locally)
├── pdf.worker.min.js       # pdf.js worker
├── ai_summary_prompt.md    # Work report AI summary prompt documentation
├── preview.png             # Web version screenshot
├── chrome_extension/       # Chrome browser extension
│   ├── manifest.json       # Extension config
│   ├── popup.html          # Popup UI
│   ├── popup.css           # Popup styles
│   ├── popup.js            # Popup logic
│   ├── sidepanel.html      # Side Panel UI (Chrome 114+)
│   ├── sidepanel.css       # Side Panel styles
│   ├── sidepanel.js        # Side Panel logic (tab switching / config sync)
│   ├── fullpage.html       # Fullscreen translation page
│   ├── fullpage.js         # Fullscreen page logic
│   ├── content.js          # Text selection translation
│   ├── content.css         # Tooltip styles
│   ├── background.js       # Service worker
│   ├── workreport.html     # Chrome extension work report page
│   ├── workreport.js       # Chrome extension work report logic
│   ├── english_learning.html # English learning assistant page
│   ├── english_learning.js   # English learning logic (external JS, CSP compliant)
│   ├── todolist.html       # Task list page
│   ├── todolist.js         # Task list logic
│   ├── email_summary.html  # Email summary page
│   ├── email_summary.js    # Email summary logic
│   ├── pdf.min.js          # pdf.js (PDF parsing, bundled locally for MV3 CSP)
│   ├── pdf.worker.min.js   # pdf.js worker
│   ├── install_url_scheme.sh     # URL Scheme bridge installer
│   ├── native_host.py      # Chrome Native Messaging host (optional)
│   ├── native_host_manifest.json  # Native Messaging manifest template
│   ├── install_native_host.sh     # Native Messaging install script
│   ├── icons/              # Extension icons
│   └── _locales/           # i18n files
├── vibe_images/            # Icon source files
├── README.md               # Chinese documentation
└── README_EN.md            # English documentation
```

## 🧩 Chrome Extension

In addition to the web version, this project includes a **Chrome browser extension** with **text selection translation**.

### Extension Features

- **Popup Translation Panel** — Click the toolbar icon for quick text translation
- **Text Selection Translation** — Select text on any webpage, a translation icon appears automatically
- **Right-click Menu** — Select text and right-click to choose "LinguaFlow Translate"
- **12 Catppuccin Themes + Textured UI** — Shares the theme system with the web version: vibrant colors, glassmorphism cards, noise background and depth shadows
- **Resizable Popup** — Drag any edge or corner to resize (320–800px wide, 300–780px tall), auto-saved
- **Uninterrupted Translation** — Background Service Worker continues translating even after popup closes; results auto-restored
- **Translation History** — Auto-saves up to 20 entries with individual deletion and clear-all
- **Deep Context-Aware Translation** — 5-step analysis workflow for precise, natural translations
- **30+ Languages** — Same language support as the web version
- **Typing Effect** — Translation results appear character by character
- **Toggle Switch** — Enable/disable text selection translation in settings

### Installation

1. Copy the `chrome_extension` folder to your local machine
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** in the top-right corner
4. Click **"Load unpacked"**
5. Select the `chrome_extension` folder
6. Click the LinguaFlow icon in the toolbar and configure your API to get started

### How to Use Text Selection Translation

1. Select text on any webpage with your mouse
2. A purple translation icon appears near the selection
3. Click the icon to see the translation in a floating tooltip
4. Copy the result with one click

### How to Use the Side Panel (Chrome 114+)

1. Click the LinguaFlow toolbar icon, then click the **Side Panel** button in the popup header (or press `Alt+Shift+L`, or right-click → "Open LinguaFlow in Side Panel")
2. The side panel opens on the right edge of the window with 5 tabs: **Smart Translation / Work Report / Task List / English Learning / Email Summary**
3. Click any tab to switch modules instantly — each module is lazily loaded on first open to keep startup fast
4. Configure your API in the popup's **Settings** panel (gear icon) — all modules sync the config in real time
5. The side panel theme follows the shared Catppuccin theme system automatically

## 📋 Browser Compatibility

- Chrome 90+
- Edge 90+
- Firefox 88+
- Safari 15+

## 📝 Changelog

### v0.16.0 (2026-08-28)

- **Chrome Side Panel** — A dedicated Chrome 114+ side panel bundling all 5 modules (Smart Translation / Work Report / Task List / English Learning / Email Summary) in one view with one-click tab switching and lazy-loaded iframes
  - **Open via popup button** — New Side Panel button in the popup header
  - **Keyboard shortcut** — `Alt+Shift+L` opens the side panel from any tab
  - **Context menu** — Right-click → "Open LinguaFlow in Side Panel" works on any page
  - **Shared architecture** — Reuses the existing sub-pages as iframes, inherits the Catppuccin theme system, and syncs API config (Base URL / API Key / Model) in real time with the popup
  - **Requirements** — Chrome 114+ (`minimum_chrome_version`)

### v0.15.0 (2026-08-22)

- **Full-site Visual Refactor (Premium UI)** — High-end visual upgrade across all 5 pages (Translate / Work Report / Task List / English Learning / Email Summary) while fully preserving page structure, content, and business logic
  - **Deep layered dark background** — Near-black layered gradient `#0A090D → #161323`, breaking away from flat black or plain solid colors; Glow Mesh ambient washes + subtle noise texture over core visual areas
  - **Glassmorphism upgrade** — Cards use semi-transparent base `rgba(255,255,255,0.03~0.04)` + 1px highlight border + `backdrop-blur(30px) saturate(1.6)`, with a soft top-edge light reflection
  - **Typography reshaping** — Google Fonts: Syne / Plus Jakarta Sans for headings, Inter for body; gradient title text, larger heading/body contrast, refined tracking & line-height for breathing room
  - **Motion & interaction quality** — Fixed the missing `--transition` variable; unified 300ms `ease-out` micro-interactions site-wide; buttons/cards lift slightly (-2~-4px) on hover with edge glow + deepened outer shadow
  - **De-finessed details** — Layered soft ambient shadows, unified icon style with consistent spacing & alignment
  - **Responsive preserved** — Mobile tab-nav wraps/folds adaptively; latte light themes get a graceful light-glass treatment with no readability loss
- **Dark-theme de-glare** — Per user feedback, reduced overly bright/reflective buttons & cards in dark themes: dark-veil over the washed-out gradient on primary buttons, removed white top highlights, removed hover `brightness` boost (kept slight saturation only), softened the gloss sweep band, and toned down the card top-edge highlight

### v0.14.0 (2026-08-22)

- **Theme system rebuilt as Catppuccin-only (v2)** — Classic 6 themes removed, fully replaced by 12 official Catppuccin themes, default Mocha Blue
  - **Latte (light)**: Blue #1e66f5 / Mauve #8839ef / Pink #ea76cb
  - **Frappé (muted dark)**: Blue #8caaee / Mauve #ca9ee6 / Green #a6d189
  - **Macchiato (dark)**: Blue #8aadf4 / Mauve #c6a0f6 / Teal #8bd5ca
  - **Mocha (darkest)**: Blue #89b4fa / Mauve #cba6f7 / Green #a6e3a1
  - Each theme an independent color world: base/mantle/crust layered backgrounds, subtext/overlay text ladder, sky/mauve/teal/peach warm-cool contrast accents; glass/shadows/gradients/alpha layers derived from the official palette; star/orb/noise intensity auto-adapted per flavor lightness
- **Texture polish v2** — All 12 themes upgraded: gradient canvas depth (replacing flat background), hue-tinted card shadows (replacing pure black), 5-layer multi-hue ambient washes (with secondary accents), tricolor starfield, hairline border accent segment, button hover gradient flow + glow, header dual glow, themed text selection, glowing focus ring, subtle scanline texture
- **Four-group theme panel** — Latte/Frappé/Macchiato/Mocha sections with scrollable adaptive-height panel; 12 swatches
- **Theme system synced** — theme.css/theme.js updated in both web version and Chrome extension; iframe sub-pages and Popup follow automatically

### v0.13.0 (2026-08-08)

- **Six-Theme Palette Rebuild (Color Worlds v2)** — Every theme reconstructed as an independent color world, retiring the homogenized soft pastels
  - Hue-tinted neutrals: backgrounds/text/shadows all shift with the theme hue — no generic gray
  - Deepened primaries (pigment feel); secondary accent (accent2) with deliberate hue spacing (e.g. Terracotta × misty slate-blue warm-cool contrast)
  - Four-stop title gradients: tail blends into the secondary accent hue — each theme's headline glow is unique
  - Six primaries: Celadon #2e9c8b / Ink #8b87f0 / Porcelain #4f63d8 / Terracotta #cc6742 / Sakura #d4698e / Deep Sea #4799e2; swatch palette updated in sync
- **Production Hardening** — Friendly error diagnostics on every AI surface (translation/work report/email summary/extension fullscreen/popup): 401/403 (invalid key), 404 (wrong URL/model), 429 (rate limit/balance), 5xx, CORS/offline all report the problem and a recovery path instead of raw errors
- **Destructive-Action Guards** — History clear-all gains a confirmation dialog; model placeholder corrected to the real `deepseek-chat`
- **Polish Pass** — Translation waiting state replaced with shimmer skeletons (no more blank clear); empty states de-italicized with lifted contrast; popup micro-text 9/10px raised to 11px; hardcoded error color switched to semantic `var(--red)`
- **Accessibility & Motion Restraint** — Button :focus-visible rings, prefers-reduced-motion disables loop animations, unified :active press feedback site-wide

### v0.12.0 (2026-08-07)

- **New Email Summary Module** — Added 5th tab to the web version; Chrome extension popup gains an envelope icon entry (opens in a new tab)
  - AI summarizes email threads following the email-thread-summarizer SKILL spec: four-section detailed summary (subject & background / timeline table / technical key points / risks & caveats) plus a responsibility-based To Do List (our side / counterpart / joint verification, P0/P1/P2 priorities)
  - Input methods: paste email threads manually, or upload local files (.txt/.md/.eml/.log/.pdf, etc.)
  - Summary output language selectable from 30 world languages
  - Results support copy and HTML/Markdown file download (fully preserving tables/quotes/task lists)
  - Summary history auto-saved (up to 30 entries) with review, Markdown editing, and deletion
- **PDF Email File Support** — Built-in pdf.js 3.11.174 local parsing (both web and extension)
  - File size cap 200MB with real-time reading progress
  - Automatic handling of huge files: early stop at 120k-character text budget or 500-page cap with explicit annotation, per-page memory release
  - Scanned/image-only PDFs auto-detected with OCR hint
- **Oversized Content Auto-Handling** — Content over 60,000 characters automatically keeps the first 60% + last 40%, omitting and marking the middle; the editor retains the full text — no manual splitting needed
- **Translation History Enhancement** — Translation history now displays both source text and translation; clicking a record restores both (web version + extension fullscreen page)

### v0.11.0 (2026-08-07)

- **Multi-Theme System Upgrade** — Added 6 themes with one-click switching (Ocean/Fresh/Dark/Light/Warm/Sakura) via floating button; iframe sub-pages auto-sync parent theme
- **Visual Style Redesign: Vibrant + Textured** — Medium-to-high saturation vibrant palette, glassmorphism cards (translucent + backdrop-blur + top sheen), SVG noise background, triple-layer radial ambient glow, multi-layer depth shadows, hairline gradient borders, gradient title glow
- **Extension & Main Site Unified** — chrome_extension pages aligned with root pages on 20px radius, container widths, and theme texture; popup upgraded with noise background + layered shadows + themed gradient button
- **Work Report HTML Export Fix** — AI summary HTML export now converts from raw Markdown (rawText), matching on-screen rendering exactly with headings/lists/bold support
- **Cross-Environment Consistency** — Markdown preview buttons use "bind when no inline onclick" mechanism, so extension pages behave identically under chrome-extension:// and file://
- **Restrained Animations** — Removed always-on neon animations (gradientShift/borderGlow), kept subtle fadeUp/orb-float effects
- **Popup Form Optimization** — Increased default min-height, fully expanded translation area, more generous default popup size

### v0.10.0 (2026-07-14)

- **Task List Markdown Support** — Added Markdown batch import and export
  - Supports standard `- [ ]` / `- [x]` checkbox syntax parsing
  - Auto-detects optional markers during import: `@date`, `@time`, `#priority`
  - One-click export current task list as Markdown, copied to clipboard
  - Auto-deduplication — tasks with same title + date won't be imported twice
- **Apple Reminders One-Click Import** — Click "🍎 提醒" to import reminders instantly
  - **URL Scheme channel**: After one-time bridge install, clicking the button triggers AppleScript directly — reminders appear instantly (with macOS notification)
  - **AppleScript file fallback**: Simultaneously downloads `.applescript` file as backup, openable in Script Editor
  - **One-command bridge install**: Run `./install_url_scheme.sh` to register the `linguaflow-reminders://` protocol
  - Auto-creates reminders with due dates and high/medium/low priority mapping
- **Task List UI Overhaul** — Full CSS/HTML refactor with visual upgrades
  - CSS variables organized into logical sections with semantic comments
  - Enlarged input bar paddings, dark-adapted date/time pickers, custom dropdown arrows
  - Unified toolbar button sizing + enhanced colors (cyan ics / blue Google / purple MD / red Apple) with hover glow
  - Task card hover micro-animation, completed-state green background, sync badge labels
  - Refined filter pills, dark settings panel background, redesigned empty state
  - All inline styles extracted to CSS classes

### v0.9.0 (2026-07-09)

- **New English Learning Assistant** — Added "English Learning" module to both web and Chrome extension
  - AI Word Study: LLM-powered phonetics, definitions, examples, synonyms/antonyms, and memory tips
  - Text-to-Speech: Web Speech API integration with multiple voice selection and speed control
  - Learning History: auto-saves study records with individual deletion and clear-all
  - Note Export: export today's learning content in Markdown and HTML formats
  - Preset API Configs: DeepSeek / OpenAI / Ollama / SiliconFlow / Custom
- **Chrome Extension MV3 CSP Compliance** — Extracted English learning JS to external file `english_learning.js`, resolving MV3 default CSP restriction on inline `<script>` blocks
  - `english_learning.html` loads via `<script src="english_learning.js">`
  - `manifest.json` added `host_permissions: ["<all_urls>"]` for cross-origin API requests
- **DeepSeek Default Model Update** — Default model updated from `deepseek-chat` to `deepseek-v4-pro`

### v0.8.0 (2026-07-09)

- **New Work Report Module** — Added "Work Report" tab to the web version with full report generation and management
  - AI One-Click Summary: leverages LLM to generate intelligent summaries of work reports
  - History Management: save, delete, and clear work report records
  - Date Filtering: filter reports by month, week, or day
  - Summary History: review and manage past AI-generated summaries
- **New Task List Module** — Added "Task List" tab to the web version for lightweight task management
  - CRUD Operations: add, complete, and delete tasks
  - Priority Levels: assign different priorities to tasks
  - Progress Tracking: visual overview of task completion status
- **Page Reuse Architecture** — Work Report tab embeds a standalone `workreport.html` page via iframe, sharing the same HTML/CSS/JS codebase with Chrome extension for feature parity between web and extension
- **JavaScript Module Encapsulation** — Both `workreport.js` and `todolist.js` are wrapped in IIFE (Immediately Invoked Function Expression) to prevent global variable conflicts
  - Fixed `let config` duplicate declaration conflict between `index.html` inline script and `workreport.js` (`Identifier 'config' has already been declared`)
  - IIFE scope isolation completely resolves variable pollution issues when multiple JS modules coexist
- **Regex Fix** — Fixed JS syntax error in `autoFormatResult` where `\n` escape sequences in `/([^\n])\n(#{1,6}\s)/g` regex were expanded into literal newlines
- **Non-Blocking Google Fonts** — Optimized Google Fonts loading strategy to prevent page render blocking, resolving slow page load issues
- **UI Fix** — Cleaned up macOS emoji rendering issue where the task list empty state emoji displayed as an oversized colorful icon

### v0.7.1 (2026-07-07)

- **Fullscreen Page Fixes** — Fixed the Chrome extension fullscreen mode (fullpage.html) where the API Settings button was unresponsive and language dropdowns were empty
  - Fixed corrupted regex in `fullpage.js` `autoFormatResult` function (`\n` escape sequences were replaced with literal newlines, causing JS syntax error)
  - Replaced all inline event handlers (`onclick`/`oninput`) with `addEventListener` in fullpage, complying with Chrome Extension CSP policy
  - History list now uses event delegation instead of inline `onclick` handlers
  - Migrated fullpage storage from `localStorage` to `chrome.storage.local` for consistent config/history sharing with Popup

### v0.7 (2026-06-25)

- **Chrome Extension Fullscreen Mode** — New "fullscreen button" in popup top-right corner, opens full translation page in new tab (no height limit)
- **Dynamic Popup Height** — Max height set to `screen.availHeight`, can drag to screen bottom
- **Extension Resource Path Fix** — Use `chrome.runtime.getURL()` to correctly access internal HTML files

### v0.6 (2026-06-25)

- **Web Version Dark AI-Themed UI** — Complete visual overhaul to dark theme, unified with Chrome extension
  - Dark cards replace original glassmorphism white background
  - Neon purple/cyan gradient color system
  - 32px grid texture background + rotating glow orb animation
  - All components (inputs, selects, buttons) dark-themed with neon glow interactions
  - Translate button upgraded with purple→cyan gradient + dual glow shadow
  - History cards, settings panel, and language bar fully dark-adapted
- **Deep Context-Aware Translation** — All translation modules (web, popup, text selection, background service) upgraded to 5-step analysis workflow
  - Step 1: Domain & topic identification (tech, medicine, legal, literature, casual, news, academic, etc.)
  - Step 2: Text type & tone assessment (formal, informal, humorous, serious, persuasive, instructional, etc.)
  - Step 3: Audience & key concept analysis (terminology, idioms, cultural references)
  - Step 4: Intent understanding (inform, persuade, entertain, instruct, warn)
  - Step 5: Context-aware translation based on analysis, preserving author's voice and style

### v0.5 (2026-06-25)

- **Chrome Extension Dark AI-Themed UI** — New dark theme with neon purple/cyan gradients, grid texture background, rounded popup design
- **AI-Style Effects** — Logo breathing indicator, translate button glow border, header sweep animation
- **Resizable Popup** — Drag any of 8 directions (edges + corners) to freely resize, size auto-saved and restored
- **Background Translation Persistence** — Translation continues in background Service Worker when popup loses focus; auto-restores results on reopen
- **Chrome Extension Translation History** — Popup gains history section with individual deletion and clear-all
- Resize height limit increased from 600px to 780px

### v0.4 (2026-06-25)

- **Context-Aware Translation** — AI automatically analyzes text context, tone, and intent before translating for more accurate and natural results
- **Original Format Preservation** — Fully preserves Markdown, HTML, code blocks, and other original format inputs
- **Auto-Formatting** — Automatically cleans up extra blank lines, normalizes list indentation, fixes punctuation spacing, and more after translation
- **Format Repair** — Automatically fixes broken formatting from source text to ensure clean, well-organized output
- All translation modules (web version, popup, text selection, background service) upgraded in sync

### v0.3 (2026-06-12)

- **Individual history deletion** — Hover over a history item to reveal a trash icon for single-entry deletion
- **Web version auto-save draft** — Input text is auto-cached to localStorage, recoverable after accidental tab close
- **Chrome extension popup state persistence** — Input text auto-cached, content preserved when popup closes and reopens
- Translation results auto-saved to draft after completion
- Clear button now also clears draft cache

### v0.2 (2026-06-12)

- Added **Chrome browser extension** with text selection translation
- Text selection translation: select text on any webpage, auto-popup translation icon with floating tooltip
- Right-click context menu translation
- Popup translation panel via toolbar icon
- Toggle switch for enabling/disabling text selection translation
- Automatic language preference memory

### v0.1 (2026-06-11)

- Initial release
- Support for 30+ languages
- Glassmorphism UI with animated starry background
- Typing effect for translation output
- Translation history (up to 20 entries)
- Responsive layout with mobile support

## 📄 License

MIT License
