// ==UserScript==
// @name         雅译 · 网页与字幕翻译
// @namespace    https://github.com/shengrui123/yayi-browser-translator
// @version      0.1.2
// @description  将网页和视频字幕翻译成自然、准确的中文，支持 OpenAI、Gemini、DeepL 与自定义 API。
// @author       雅译
// @homepageURL  https://shengrui123.github.io/yayi-browser-translator/
// @supportURL   https://github.com/shengrui123/yayi-browser-translator/issues
// @updateURL    https://raw.githubusercontent.com/shengrui123/yayi-browser-translator/main/userscript/yayi.user.js
// @downloadURL  https://raw.githubusercontent.com/shengrui123/yayi-browser-translator/main/userscript/yayi.user.js
// @match        http://*/*
// @match        https://*/*
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.openai.com
// @connect      generativelanguage.googleapis.com
// @connect      api-free.deepl.com
// @connect      api.deepl.com
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(() => {
  "use strict";

  const DEFAULTS = {
    provider: "openai",
    openaiKey: "",
    openaiModel: "gpt-5.6-luna",
    openaiBaseUrl: "https://api.openai.com/v1",
    geminiKey: "",
    geminiModel: "gemini-3.7-flash",
    geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    deeplKey: "",
    deeplBaseUrl: "https://api-free.deepl.com/v2",
    customUrl: "",
    customKey: "",
    customModel: "",
    customHeaders: "{}",
    customBodyTemplate: "{\"model\":\"{{model}}\",\"messages\":[{\"role\":\"user\",\"content\":\"{{prompt}}\"}]}",
    customResponsePath: "choices.0.message.content",
    translationStyle: "elegant",
    targetLanguage: "简体中文",
    glossary: "",
    bilingual: false,
    translateSubtitles: true,
    floatingButtonSide: "right",
    floatingButtonY: 0.38,
    batchSize: 16,
    minTextLength: 2
  };
  const STYLE_LABELS = {
    faithful: "准确直译：忠实原意、术语一致，不增不减",
    natural: "自然意译：符合现代中文表达习惯，清晰流畅",
    elegant: "信达雅：准确为先，在不改变原意的前提下自然、凝练、有文采"
  };
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE", "KBD", "SAMP", "SVG", "MATH"]);
  const CAPTION_SELECTORS = [
    ".ytp-caption-segment", ".caption-window", "[class*='subtitle']", "[class*='caption']",
    "[data-testid*='subtitle']", "[data-testid*='caption']", ".vjs-text-track-display",
    ".jw-text-track-display", ".plyr__captions", ".shaka-text-container"
  ];
  const originalText = new Map();
  const translatedText = new WeakMap();
  const subtitleCache = new Map();
  const translationCache = new Map();
  let cfg = loadSettings();
  let translating = false;
  let subtitleEnabled = cfg.translateSubtitles !== false;
  let overlaySource = "";
  let overlayTimer = 0;
  let floatingSwitcher = null;

  GM_addStyle(`
    #yayi-toast,#yayi-settings,#yayi-selection-card,#yayi-subtitle-overlay{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;box-sizing:border-box;z-index:2147483647}
    #yayi-toast{position:fixed;right:22px;top:22px;max-width:360px;padding:12px 16px;border:1px solid #ffffff20;border-radius:10px;background:#173f32;color:#fff;box-shadow:0 14px 40px #0004;font-size:13px;opacity:0;transform:translateY(-8px);transition:.2s;pointer-events:none}
    #yayi-toast.yayi-show{opacity:1;transform:none}#yayi-toast.yayi-error{background:#8d332d}#yayi-toast.yayi-success{background:#215a45}
    #yayi-subtitle-overlay{position:fixed;white-space:pre-line;padding:9px 15px;border-radius:8px;background:#101814df;color:#fff;text-align:center;font-size:clamp(15px,2vw,24px);font-weight:650;line-height:1.45;text-shadow:0 2px 4px #000;pointer-events:none}
    #yayi-selection-card{position:fixed;right:22px;bottom:22px;width:min(390px,calc(100vw - 44px));padding:20px;border:1px solid #d9d4c8;border-radius:14px;background:#fbf9f3;color:#17231d;box-shadow:0 20px 60px #0003}
    #yayi-selection-card button{position:absolute;right:12px;top:8px;border:0;background:transparent;color:#68726c;font-size:23px;cursor:pointer}.yayi-card-title{margin-bottom:12px;color:#215a45;font-weight:800;letter-spacing:.15em}.yayi-card-source{max-height:90px;overflow:auto;color:#717a74;font-size:12px;line-height:1.6}.yayi-card-result{margin-top:11px;padding-top:11px;border-top:1px solid #dedbd2;font-size:15px;line-height:1.75;white-space:pre-wrap}
    #yayi-settings{position:fixed;inset:0;display:grid;place-items:center;padding:18px;background:#08140f99}
    #yayi-settings .yayi-panel{width:min(720px,100%);max-height:min(820px,92vh);overflow:auto;border-radius:17px;background:#f7f4eb;color:#17231d;box-shadow:0 30px 90px #0007}
    #yayi-settings header{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid #d9d4c8;background:#f7f4eb;z-index:1}#yayi-settings h2{margin:0;font:600 22px Georgia,"Songti SC",serif}#yayi-settings header button{border:0;background:transparent;font-size:25px;cursor:pointer}
    #yayi-settings form{display:grid;grid-template-columns:1fr 1fr;gap:15px;padding:23px}#yayi-settings label{display:grid;gap:6px;color:#59635d;font-size:12px}#yayi-settings label.wide{grid-column:1/-1}#yayi-settings input,#yayi-settings select,#yayi-settings textarea{width:100%;padding:10px 11px;border:1px solid #cfcabf;border-radius:8px;background:#fff;color:#17231d;font:13px inherit}#yayi-settings textarea{min-height:74px;resize:vertical}#yayi-settings .check{display:flex;align-items:center;gap:8px}#yayi-settings .check input{width:auto}#yayi-settings footer{grid-column:1/-1;display:flex;align-items:center;justify-content:flex-end;gap:10px;padding-top:8px}#yayi-settings footer button{padding:11px 18px;border:0;border-radius:8px;background:#173f32;color:#fff;font-weight:700;cursor:pointer}#yayi-settings footer button:first-child{background:#dedbd2;color:#17231d}
    #yayi-floating-switcher{all:initial;position:fixed;z-index:2147483646;top:38vh;display:block;box-sizing:border-box;color:#17231d;font:13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;filter:drop-shadow(0 10px 24px #0618123d);touch-action:none}#yayi-floating-switcher,#yayi-floating-switcher *{box-sizing:border-box}#yayi-floating-switcher.yayi-side-left{left:0}#yayi-floating-switcher.yayi-side-right{right:0}
    #yayi-floating-switcher .yayi-floating-trigger{all:initial;display:grid;place-items:center;gap:2px;width:46px;height:72px;padding:0;border:1px solid #ffffff29;background:linear-gradient(155deg,#286f55,#173f32);color:#fff;cursor:grab;user-select:none;touch-action:none;box-shadow:inset 0 1px 0 #ffffff1f}#yayi-floating-switcher.yayi-side-left .yayi-floating-trigger{border-left:0;border-radius:0 13px 13px 0}#yayi-floating-switcher.yayi-side-right .yayi-floating-trigger{border-right:0;border-radius:13px 0 0 13px}#yayi-floating-switcher .yayi-floating-trigger b{font:700 22px/1 Georgia,"Songti SC",serif}#yayi-floating-switcher .yayi-floating-trigger small{min-width:22px;padding:2px 4px;border-radius:99px;background:#ffffff24;color:#dceae4;font-size:8px;font-weight:700;line-height:1;text-align:center}
    #yayi-floating-switcher .yayi-provider-menu{position:absolute;top:0;display:none;width:244px;overflow:hidden;margin:0;padding:8px;border:1px solid #173f3221;border-radius:15px;background:#fbf9f3fa;box-shadow:0 20px 60px #06181238;backdrop-filter:blur(18px)}#yayi-floating-switcher.yayi-side-left .yayi-provider-menu{left:55px}#yayi-floating-switcher.yayi-side-right .yayi-provider-menu{right:55px}#yayi-floating-switcher.yayi-menu-up .yayi-provider-menu{top:auto;bottom:0}#yayi-floating-switcher.yayi-menu-open .yayi-provider-menu{display:grid;gap:4px}#yayi-floating-switcher .yayi-provider-menu>button{all:initial;display:flex;align-items:center;justify-content:space-between;min-height:48px;padding:8px 10px;border:0;border-radius:9px;background:transparent;color:#17231d;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}#yayi-floating-switcher .yayi-provider-menu>button:hover{background:#e9eee8}#yayi-floating-switcher .yayi-provider-menu>button span{display:grid;gap:3px;text-align:left}#yayi-floating-switcher .yayi-provider-menu>button b{font-size:12px}#yayi-floating-switcher .yayi-provider-menu>button small{max-width:168px;overflow:hidden;color:#7a857f;font-size:10px;text-overflow:ellipsis;white-space:nowrap}#yayi-floating-switcher .yayi-provider-menu>button i{width:9px;height:9px;border:1px solid #aeb8b2;border-radius:50%}#yayi-floating-switcher .yayi-provider-menu>button.active{background:#e2ebe5}#yayi-floating-switcher .yayi-provider-menu>button.active i{border:3px solid #286f55}#yayi-floating-switcher .yayi-provider-menu .yayi-provider-settings{min-height:38px;margin-top:4px;border-top:1px solid #dce1dd;border-radius:0;color:#426052;font-size:10px}
    @media(max-width:620px){#yayi-settings form{grid-template-columns:1fr}#yayi-settings label.wide,#yayi-settings footer{grid-column:1}}
    @media(max-width:420px){#yayi-floating-switcher .yayi-provider-menu{width:min(244px,calc(100vw - 66px))}}
  `);

  function loadSettings() {
    const saved = GM_getValue("settings", {});
    return { ...DEFAULTS, ...(saved && typeof saved === "object" ? saved : {}) };
  }

  function saveSettings(value) {
    cfg = { ...DEFAULTS, ...value };
    subtitleEnabled = cfg.translateSubtitles !== false;
    GM_setValue("settings", cfg);
    updateFloatingSwitcher();
  }

  function promptFor(texts) {
    const glossary = cfg.glossary.trim() ? `\n必须遵守以下术语表（每行一条）：\n${cfg.glossary.trim()}` : "";
    return `你是专业翻译家。把输入中的非中文内容翻译为${cfg.targetLanguage}。\n风格：${STYLE_LABELS[cfg.translationStyle] || STYLE_LABELS.elegant}。\n规则：\n1. 保留人名、品牌名、代码、URL、数字、占位符和原有换行。\n2. 已是中文的内容原样返回。\n3. 结合上下文消除歧义，不解释、不添加注释。\n4. 只返回 JSON 数组，元素数量和顺序必须与输入完全一致，格式为 [{"id":0,"text":"译文"}]。${glossary}\n\n输入：${JSON.stringify(texts.map((text, id) => ({ id, text })))}`;
  }

  function request(url, { method = "POST", headers = {}, body } = {}) {
    return new Promise((resolve, reject) => GM_xmlhttpRequest({
      method, url, headers, data: body, timeout: 60000,
      onload(response) {
        let data;
        try { data = JSON.parse(response.responseText); } catch { data = { raw: response.responseText }; }
        if (response.status < 200 || response.status >= 300) {
          reject(new Error(String(data?.error?.message || data?.message || data?.raw || `HTTP ${response.status}`).slice(0, 500)));
        } else resolve(data);
      },
      onerror: () => reject(new Error("网络请求失败，请检查 API 地址与油猴连接权限")),
      ontimeout: () => reject(new Error("API 请求超时"))
    }));
  }

  function parseTranslations(value, expected) {
    if (typeof value !== "string") value = JSON.stringify(value);
    const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    let parsed;
    try { parsed = JSON.parse(cleaned); } catch {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("API 未返回可识别的 JSON 译文");
      parsed = JSON.parse(match[0]);
    }
    if (!Array.isArray(parsed) || parsed.length !== expected) throw new Error("API 返回的译文数量与原文不一致");
    return parsed.map((item) => typeof item === "string" ? item : String(item.text ?? ""));
  }

  function getPath(value, path) {
    return path.split(".").reduce((current, key) => current?.[key], value);
  }

  async function callProvider(texts) {
    const prompt = promptFor(texts);
    if (cfg.provider === "openai") {
      if (!cfg.openaiKey) throw new Error("请先在雅译设置中填写 OpenAI API Key");
      const data = await request(`${cfg.openaiBaseUrl.replace(/\/$/, "")}/responses`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.openaiKey}` },
        body: JSON.stringify({ model: cfg.openaiModel, input: prompt, store: false })
      });
      const output = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
      if (!output) throw new Error("OpenAI 未返回文本结果");
      return parseTranslations(output, texts.length);
    }
    if (cfg.provider === "gemini") {
      if (!cfg.geminiKey) throw new Error("请先在雅译设置中填写 Gemini API Key");
      const data = await request(`${cfg.geminiBaseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`, {
        headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.geminiKey },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } })
      });
      const output = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
      if (!output) throw new Error(data.promptFeedback?.blockReason || "Gemini 未返回文本结果");
      return parseTranslations(output, texts.length);
    }
    if (cfg.provider === "deepl") {
      if (!cfg.deeplKey) throw new Error("请先在雅译设置中填写 DeepL API Key");
      const data = await request(`${cfg.deeplBaseUrl.replace(/\/$/, "")}/translate`, {
        headers: { Authorization: `DeepL-Auth-Key ${cfg.deeplKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text: texts, target_lang: cfg.targetLanguage.includes("繁") ? "ZH-HANT" : "ZH-HANS" })
      });
      return data.translations.map((item) => item.text);
    }
    if (cfg.provider === "custom") {
      if (!cfg.customUrl) throw new Error("请先填写自定义 API URL");
      let headers;
      try { headers = { "Content-Type": "application/json", ...JSON.parse(cfg.customHeaders || "{}") }; } catch { throw new Error("自定义请求头必须是合法 JSON"); }
      if (cfg.customKey && !headers.Authorization) headers.Authorization = `Bearer ${cfg.customKey}`;
      const escapeJson = (value) => JSON.stringify(String(value)).slice(1, -1);
      let body;
      try {
        body = JSON.parse((cfg.customBodyTemplate || DEFAULTS.customBodyTemplate)
          .replaceAll("{{model}}", escapeJson(cfg.customModel || ""))
          .replaceAll("{{prompt}}", escapeJson(prompt))
          .replaceAll("{{texts}}", JSON.stringify(texts)));
      } catch { throw new Error("自定义请求体模板渲染后不是合法 JSON"); }
      const data = await request(cfg.customUrl, { headers, body: JSON.stringify(body) });
      const output = getPath(data, cfg.customResponsePath) ?? data.translations ?? data.output ?? data;
      if (Array.isArray(output) && output.every((item) => typeof item === "string")) return output;
      return parseTranslations(output, texts.length);
    }
    throw new Error(`不支持的服务商：${cfg.provider}`);
  }

  async function translate(texts) {
    const output = new Array(texts.length);
    const missing = [];
    const indexes = [];
    texts.forEach((text, index) => {
      const key = `${cfg.provider}|${cfg.targetLanguage}|${cfg.translationStyle}|${cfg.glossary}|${text}`;
      if (translationCache.has(key)) output[index] = translationCache.get(key);
      else { missing.push(text); indexes.push(index); }
    });
    if (missing.length) {
      const translated = await callProvider(missing);
      translated.forEach((text, position) => {
        const index = indexes[position];
        output[index] = text;
        translationCache.set(`${cfg.provider}|${cfg.targetLanguage}|${cfg.translationStyle}|${cfg.glossary}|${texts[index]}`, text);
      });
      if (translationCache.size > 1500) translationCache.delete(translationCache.keys().next().value);
    }
    return output;
  }

  function containsForeignText(text) {
    const compact = text.replace(/[\s\d\p{P}\p{S}]/gu, "");
    if (!compact || compact.length < (Number(cfg.minTextLength) || 2)) return false;
    const chinese = (compact.match(/[\u3400-\u9fff]/g) || []).length;
    return chinese / compact.length < 0.65 && /[\p{L}]/u.test(compact);
  }

  function collectTextNodes() {
    const nodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName) || parent.isContentEditable || parent.closest("[data-yayi-ignore]")) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return NodeFilter.FILTER_REJECT;
        if (!containsForeignText(node.nodeValue || "") || translatedText.get(node) === node.nodeValue) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function splitWhitespace(text) {
    const leading = text.match(/^\s*/)?.[0] || "";
    const trailing = text.match(/\s*$/)?.[0] || "";
    return { leading, core: text.slice(leading.length, text.length - trailing.length), trailing };
  }

  async function translatePage() {
    if (translating) return;
    translating = true;
    toast("正在识别并翻译可见文字…");
    try {
      const nodes = collectTextNodes();
      if (!nodes.length) return toast("没有发现需要翻译的文字");
      const batchSize = Math.max(1, Math.min(Number(cfg.batchSize) || 16, 40));
      for (let i = 0; i < nodes.length; i += batchSize) {
        const group = nodes.slice(i, i + batchSize);
        const parts = group.map((node) => splitWhitespace(node.nodeValue || ""));
        const translated = await translate(parts.map((part) => part.core));
        group.forEach((node, index) => {
          if (!node.isConnected) return;
          if (!originalText.has(node)) originalText.set(node, node.nodeValue);
          const value = `${parts[index].leading}${translated[index]}${parts[index].trailing}`;
          node.nodeValue = cfg.bilingual ? `${originalText.get(node)}\n${value}` : value;
          translatedText.set(node, node.nodeValue);
        });
        toast(`翻译中 ${Math.min(i + batchSize, nodes.length)}/${nodes.length}`);
      }
      toast(`已翻译 ${nodes.length} 段文字`, "success");
    } catch (error) { toast(error.message, "error", 5000); }
    finally { translating = false; }
  }

  function restorePage() {
    let count = 0;
    for (const [node, value] of originalText) if (node.isConnected) { node.nodeValue = value; count += 1; }
    originalText.clear();
    toast(`已还原 ${count} 段文字`);
  }

  function toast(message, type = "info", duration = 2600) {
    let element = document.getElementById("yayi-toast");
    if (!element) {
      element = document.createElement("div");
      element.id = "yayi-toast";
      element.dataset.yayiIgnore = "true";
      document.documentElement.appendChild(element);
    }
    element.className = `yayi-show yayi-${type}`;
    element.textContent = message;
    clearTimeout(Number(element.dataset.timer));
    element.dataset.timer = String(setTimeout(() => element.classList.remove("yayi-show"), duration));
  }

  async function translateSelection() {
    const source = getSelection()?.toString().trim();
    if (!source) return toast("请先选中需要翻译的文字");
    showSelection(source, "正在翻译…");
    try { showSelection(source, (await translate([source]))[0]); }
    catch (error) { showSelection(source, `翻译失败：${error.message}`); }
  }

  function showSelection(source, result) {
    document.getElementById("yayi-selection-card")?.remove();
    const card = document.createElement("section");
    card.id = "yayi-selection-card";
    card.dataset.yayiIgnore = "true";
    card.innerHTML = '<button type="button" aria-label="关闭">×</button><div class="yayi-card-title">雅译</div><div class="yayi-card-source"></div><div class="yayi-card-result"></div>';
    card.querySelector(".yayi-card-source").textContent = source;
    card.querySelector(".yayi-card-result").textContent = result;
    card.querySelector("button").addEventListener("click", () => card.remove());
    document.documentElement.appendChild(card);
  }

  function ensureOverlay() {
    let overlay = document.getElementById("yayi-subtitle-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "yayi-subtitle-overlay";
      overlay.dataset.yayiIgnore = "true";
      overlay.hidden = true;
      document.documentElement.appendChild(overlay);
    }
    return overlay;
  }

  function positionOverlay(video) {
    if (!video?.isConnected) return;
    const rect = video.getBoundingClientRect();
    const overlay = ensureOverlay();
    overlay.style.left = `${Math.max(12, rect.left + rect.width * 0.08)}px`;
    overlay.style.width = `${Math.max(180, rect.width * 0.84)}px`;
    overlay.style.bottom = `${Math.max(24, innerHeight - rect.bottom + rect.height * 0.08)}px`;
  }

  async function showSubtitle(source, video) {
    const normalized = source.replace(/\s+/g, " ").trim();
    if (!subtitleEnabled || !containsForeignText(normalized) || normalized === overlaySource) return;
    overlaySource = normalized;
    const overlay = ensureOverlay();
    positionOverlay(video || document.querySelector("video"));
    overlay.hidden = false;
    overlay.textContent = "翻译中…";
    try {
      let value = subtitleCache.get(normalized);
      if (!value) {
        value = (await translate([normalized]))[0];
        subtitleCache.set(normalized, value);
        if (subtitleCache.size > 500) subtitleCache.delete(subtitleCache.keys().next().value);
      }
      if (overlaySource !== normalized) return;
      overlay.textContent = cfg.bilingual ? `${normalized}\n${value}` : value;
      clearTimeout(overlayTimer);
      overlayTimer = setTimeout(() => { if (overlaySource === normalized) overlay.hidden = true; }, 8000);
    } catch (error) { overlay.textContent = `字幕翻译失败：${error.message}`; }
  }

  function attachVideo(video) {
    if (video.dataset.yayiAttached) return;
    video.dataset.yayiAttached = "true";
    const bindTracks = () => {
      for (const track of video.textTracks || []) {
        if (track.__yayiAttached) continue;
        track.__yayiAttached = true;
        track.addEventListener("cuechange", () => {
          const text = Array.from(track.activeCues || []).map((cue) => cue.text).join("\n");
          if (text) showSubtitle(text, video);
        });
      }
    };
    bindTracks();
    video.addEventListener("loadedmetadata", bindTracks);
    video.addEventListener("timeupdate", () => { bindTracks(); positionOverlay(video); });
  }

  function scanVideos(root = document) {
    if (root instanceof HTMLVideoElement) attachVideo(root);
    root.querySelectorAll?.("video").forEach(attachVideo);
  }

  function captionTextFrom(element) {
    const selectors = CAPTION_SELECTORS.join(",");
    if (!element?.matches?.(selectors)) element = element?.closest?.(selectors);
    if (!element || element.closest("#yayi-subtitle-overlay")) return "";
    const text = element.innerText?.trim() || "";
    return text.length <= 500 ? text : "";
  }

  function observeSubtitles() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          scanVideos(node);
          const caption = captionTextFrom(node);
          if (caption) showSubtitle(caption, document.querySelector("video"));
        }
        const target = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
        const caption = captionTextFrom(target);
        if (caption) showSubtitle(caption, document.querySelector("video"));
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  const PROVIDERS = {
    openai: { name: "OpenAI", badge: "AI", model: () => cfg.openaiModel || "OpenAI" },
    gemini: { name: "Gemini", badge: "G", model: () => cfg.geminiModel || "Gemini" },
    deepl: { name: "DeepL", badge: "D", model: () => "DeepL" },
    custom: { name: "自定义 API", badge: "API", model: () => cfg.customModel || "兼容接口" }
  };

  function clampFloatingTop(top, height = 72) {
    return Math.max(8, Math.min(top, Math.max(8, innerHeight - height - 8)));
  }

  function floatingTopFromSettings(height = 72) {
    const available = Math.max(1, innerHeight - height - 16);
    const value = Number(cfg.floatingButtonY);
    const ratio = Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0.38;
    return 8 + available * ratio;
  }

  function updateFloatingSwitcher() {
    if (!floatingSwitcher?.isConnected) return;
    const provider = PROVIDERS[cfg.provider] || PROVIDERS.openai;
    const trigger = floatingSwitcher.querySelector(".yayi-floating-trigger");
    trigger.querySelector("small").textContent = provider.badge;
    trigger.setAttribute("aria-label", `当前翻译服务：${provider.name}。点击切换，拖动可调整位置`);
    floatingSwitcher.querySelectorAll("[data-provider]").forEach((button) => {
      const selected = button.dataset.provider === cfg.provider;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-checked", String(selected));
      button.querySelector("small").textContent = PROVIDERS[button.dataset.provider].model();
    });
  }

  function placeFloatingSwitcher(side = cfg.floatingButtonSide, top = floatingTopFromSettings()) {
    if (!floatingSwitcher?.isConnected) return;
    const normalizedSide = side === "left" ? "left" : "right";
    floatingSwitcher.classList.toggle("yayi-side-left", normalizedSide === "left");
    floatingSwitcher.classList.toggle("yayi-side-right", normalizedSide === "right");
    floatingSwitcher.style.left = "";
    floatingSwitcher.style.right = "";
    floatingSwitcher.style.top = `${clampFloatingTop(top, floatingSwitcher.offsetHeight || 72)}px`;
  }

  function closeFloatingMenu() {
    if (!floatingSwitcher?.isConnected) return;
    floatingSwitcher.classList.remove("yayi-menu-open");
    floatingSwitcher.querySelector(".yayi-floating-trigger").setAttribute("aria-expanded", "false");
  }

  function initFloatingSwitcher() {
    if (window !== top || floatingSwitcher?.isConnected) return;
    const root = document.createElement("aside");
    root.id = "yayi-floating-switcher";
    root.dataset.yayiIgnore = "true";
    root.className = cfg.floatingButtonSide === "left" ? "yayi-side-left" : "yayi-side-right";
    root.innerHTML = `<button class="yayi-floating-trigger" type="button" aria-haspopup="true" aria-expanded="false"><b>译</b><small></small></button><div class="yayi-provider-menu" role="radiogroup" aria-label="切换翻译服务">
      ${Object.entries(PROVIDERS).map(([key, item]) => `<button type="button" role="radio" data-provider="${key}"><span><b>${item.name}</b><small></small></span><i></i></button>`).join("")}
      <button class="yayi-provider-settings" type="button">打开完整设置 <span>↗</span></button>
    </div>`;
    document.documentElement.appendChild(root);
    floatingSwitcher = root;
    placeFloatingSwitcher();
    updateFloatingSwitcher();

    const trigger = root.querySelector(".yayi-floating-trigger");
    let pointer = null;
    let dragged = false;
    trigger.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      closeFloatingMenu();
      const rect = root.getBoundingClientRect();
      pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      dragged = false;
      root.style.left = `${rect.left}px`;
      root.style.right = "auto";
    });
    addEventListener("pointermove", (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 5) dragged = true;
      const width = root.offsetWidth || 46;
      const height = root.offsetHeight || 72;
      root.style.left = `${Math.max(0, Math.min(event.clientX - pointer.offsetX, innerWidth - width))}px`;
      root.style.top = `${clampFloatingTop(event.clientY - pointer.offsetY, height)}px`;
    });
    const finishDrag = (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const rect = root.getBoundingClientRect();
      const side = rect.left + rect.width / 2 < innerWidth / 2 ? "left" : "right";
      const available = Math.max(1, innerHeight - rect.height - 16);
      const ratio = Math.max(0, Math.min((rect.top - 8) / available, 1));
      pointer = null;
      cfg.floatingButtonSide = side;
      cfg.floatingButtonY = ratio;
      placeFloatingSwitcher(side, rect.top);
      GM_setValue("settings", cfg);
    };
    addEventListener("pointerup", finishDrag);
    addEventListener("pointercancel", finishDrag);
    trigger.addEventListener("click", () => {
      if (dragged) { dragged = false; return; }
      const open = !root.classList.contains("yayi-menu-open");
      root.classList.toggle("yayi-menu-up", root.getBoundingClientRect().top > innerHeight / 2);
      root.classList.toggle("yayi-menu-open", open);
      trigger.setAttribute("aria-expanded", String(open));
    });
    root.querySelectorAll("[data-provider]").forEach((button) => button.addEventListener("click", () => {
      const provider = button.dataset.provider;
      saveSettings({ ...cfg, provider });
      closeFloatingMenu();
      toast(`已切换至 ${PROVIDERS[provider].name}`, "success");
    }));
    root.querySelector(".yayi-provider-settings").addEventListener("click", () => { closeFloatingMenu(); openSettings(); });
    addEventListener("resize", () => placeFloatingSwitcher(), { passive: true });
    addEventListener("pointerdown", (event) => { if (!root.contains(event.target)) closeFloatingMenu(); }, { passive: true });
  }

  function openSettings() {
    document.getElementById("yayi-settings")?.remove();
    const dialog = document.createElement("section");
    dialog.id = "yayi-settings";
    dialog.dataset.yayiIgnore = "true";
    dialog.innerHTML = `<div class="yayi-panel"><header><h2>雅译设置</h2><button type="button" aria-label="关闭">×</button></header><form>
      <label>翻译服务<select name="provider"><option value="openai">OpenAI</option><option value="gemini">Gemini</option><option value="deepl">DeepL</option><option value="custom">自定义 API</option></select></label>
      <label>翻译风格<select name="translationStyle"><option value="faithful">准确直译</option><option value="natural">自然意译</option><option value="elegant">信达雅</option></select></label>
      <label>OpenAI API Key<input name="openaiKey" type="password" autocomplete="off"></label><label>OpenAI 模型<input name="openaiModel"></label>
      <label class="wide">OpenAI Base URL<input name="openaiBaseUrl" type="url"></label>
      <label>Gemini API Key<input name="geminiKey" type="password" autocomplete="off"></label><label>Gemini 模型<input name="geminiModel"></label>
      <label class="wide">Gemini Base URL<input name="geminiBaseUrl" type="url"></label>
      <label>DeepL API Key<input name="deeplKey" type="password" autocomplete="off"></label><label>DeepL Base URL<input name="deeplBaseUrl" type="url"></label>
      <label class="wide">自定义 API URL<input name="customUrl" type="url" placeholder="https://api.example.com/v1/chat/completions"></label>
      <label>自定义 API Key<input name="customKey" type="password" autocomplete="off"></label><label>自定义模型<input name="customModel"></label>
      <label class="wide">自定义请求头 JSON<textarea name="customHeaders"></textarea></label>
      <label class="wide">自定义请求体模板<textarea name="customBodyTemplate"></textarea></label>
      <label class="wide">响应文本路径<input name="customResponsePath"></label>
      <label class="wide">术语表<textarea name="glossary" placeholder="每行一条，例如：agent = 智能体"></textarea></label>
      <label class="check"><input name="bilingual" type="checkbox"> 保留原文，双语显示</label><label class="check"><input name="translateSubtitles" type="checkbox"> 自动翻译视频字幕</label>
      <label>每批文本段数<input name="batchSize" type="number" min="1" max="40"></label><label>最短识别长度<input name="minTextLength" type="number" min="1" max="20"></label>
      <footer><button type="button" data-action="test">测试连接</button><button type="submit">保存设置</button></footer>
    </form></div>`;
    const form = dialog.querySelector("form");
    for (const [key, value] of Object.entries(cfg)) {
      const field = form.elements.namedItem(key);
      if (!field) continue;
      if (field.type === "checkbox") field.checked = Boolean(value); else field.value = value;
    }
    const close = () => dialog.remove();
    const readForm = () => {
      const data = new FormData(form);
      const value = { ...cfg };
      for (const key of Object.keys(DEFAULTS)) {
        const field = form.elements.namedItem(key);
        if (!field) continue;
        if (field.type === "checkbox") value[key] = field.checked;
        else if (field.type === "number") value[key] = Number(data.get(key));
        else value[key] = String(data.get(key) ?? "").trim();
      }
      try { JSON.parse(value.customHeaders || "{}"); } catch { throw new Error("自定义请求头必须是合法 JSON"); }
      return value;
    };
    dialog.querySelector("header button").addEventListener("click", close);
    dialog.addEventListener("click", (event) => { if (event.target === dialog) close(); });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      try { saveSettings(readForm()); } catch (error) { return toast(error.message, "error"); }
      close();
      toast("设置已保存", "success");
    });
    form.querySelector('[data-action="test"]').addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        saveSettings(readForm());
        toast(`连接成功：${(await translate(["The world becomes closer through language."]))[0]}`, "success", 5000);
      } catch (error) { toast(error.message, "error", 5000); }
      finally { button.disabled = false; }
    });
    document.documentElement.appendChild(dialog);
  }

  GM_registerMenuCommand("翻译当前网页", translatePage);
  GM_registerMenuCommand("还原当前网页", restorePage);
  GM_registerMenuCommand("翻译选中文字", translateSelection);
  GM_registerMenuCommand("设置 API 与翻译风格", openSettings);
  GM_registerMenuCommand("切换字幕翻译", () => {
    subtitleEnabled = !subtitleEnabled;
    cfg.translateSubtitles = subtitleEnabled;
    saveSettings(cfg);
    if (!subtitleEnabled) ensureOverlay().hidden = true;
    toast(`字幕翻译已${subtitleEnabled ? "开启" : "关闭"}`);
  });
  addEventListener("keydown", (event) => {
    if (event.altKey && event.shiftKey && event.code === "KeyT") {
      event.preventDefault();
      originalText.size ? restorePage() : translatePage();
    }
  });
  addEventListener("resize", () => positionOverlay(document.querySelector("video")), { passive: true });
  initFloatingSwitcher();
  scanVideos();
  observeSubtitles();
})();
