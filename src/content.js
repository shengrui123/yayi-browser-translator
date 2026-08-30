(() => {
  const api = globalThis.browser || globalThis.chrome;
  const originalText = new Map();
  const translatedText = new WeakMap();
  const subtitleCache = new Map();
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE", "KBD", "SAMP", "SVG", "MATH"]);
  const CAPTION_SELECTORS = [
    ".ytp-caption-segment", ".caption-window", "[class*='subtitle']", "[class*='caption']",
    "[data-testid*='subtitle']", "[data-testid*='caption']", ".vjs-text-track-display",
    ".jw-text-track-display", ".plyr__captions", ".shaka-text-container"
  ];
  let cfg = null;
  let pageTranslated = false;
  let translating = false;
  let subtitleEnabled = true;
  let overlay = null;
  let overlaySource = "";
  let overlayTimer = 0;

  function send(message) {
    if (globalThis.browser) return globalThis.browser.runtime.sendMessage(message);
    return new Promise((resolve, reject) => {
      try {
        api.runtime.sendMessage(message, (response) => {
          const error = api.runtime.lastError;
          if (error) reject(new Error(error.message)); else resolve(response);
        });
      } catch (error) { reject(error); }
    });
  }

  function containsForeignText(text) {
    const compact = text.replace(/[\s\d\p{P}\p{S}]/gu, "");
    if (!compact || compact.length < (cfg?.minTextLength || 2)) return false;
    const chinese = (compact.match(/[\u3400-\u9fff]/g) || []).length;
    return chinese / compact.length < 0.65 && /[\p{L}]/u.test(compact);
  }

  function isVisible(node) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName) || parent.isContentEditable) return false;
    if (parent.closest("[data-yayi-ignore], #yayi-subtitle-overlay, #yayi-selection-card, #yayi-toast")) return false;
    const style = getComputedStyle(parent);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function collectTextNodes(root = document.body) {
    if (!root) return [];
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!isVisible(node) || !containsForeignText(node.nodeValue || "")) return NodeFilter.FILTER_REJECT;
        if (translatedText.has(node) && translatedText.get(node) === node.nodeValue) return NodeFilter.FILTER_REJECT;
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

  async function translateBatch(nodes) {
    const parts = nodes.map((node) => splitWhitespace(node.nodeValue || ""));
    const response = await send({ type: "TRANSLATE", texts: parts.map((part) => part.core) });
    if (!response?.ok) throw new Error(response?.error || "翻译失败");
    nodes.forEach((node, index) => {
      if (!node.isConnected) return;
      if (!originalText.has(node)) originalText.set(node, node.nodeValue);
      const translated = `${parts[index].leading}${response.translations[index]}${parts[index].trailing}`;
      node.nodeValue = cfg.bilingual ? `${originalText.get(node)}\n${translated}` : translated;
      translatedText.set(node, node.nodeValue);
    });
  }

  async function translatePage() {
    if (translating) return;
    translating = true;
    toast("正在识别并翻译可见文字…", "loading");
    try {
      const nodes = collectTextNodes();
      if (!nodes.length) {
        pageTranslated = originalText.size > 0;
        toast("没有发现需要翻译的文字");
        return;
      }
      const size = Math.max(1, Math.min(Number(cfg.batchSize) || 18, 40));
      for (let i = 0; i < nodes.length; i += size) {
        await translateBatch(nodes.slice(i, i + size));
        toast(`翻译中 ${Math.min(i + size, nodes.length)}/${nodes.length}`, "loading");
      }
      pageTranslated = true;
      toast(`已翻译 ${nodes.length} 段文字`, "success");
    } catch (error) {
      toast(error.message, "error", 5000);
      throw error;
    } finally { translating = false; }
  }

  function restorePage() {
    let count = 0;
    for (const [node, original] of originalText) {
      if (node.isConnected) { node.nodeValue = original; count += 1; }
    }
    originalText.clear();
    pageTranslated = false;
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
    element.className = `yayi-${type} yayi-show`;
    element.textContent = message;
    clearTimeout(Number(element.dataset.timer));
    if (type !== "loading") element.dataset.timer = String(setTimeout(() => element.classList.remove("yayi-show"), duration));
  }

  async function translateSelection(text) {
    if (!text?.trim()) return;
    showSelectionCard(text, "正在翻译…", true);
    try {
      const response = await send({ type: "TRANSLATE", texts: [text.trim()] });
      if (!response?.ok) throw new Error(response?.error || "翻译失败");
      showSelectionCard(text, response.translations[0]);
    } catch (error) { showSelectionCard(text, `翻译失败：${error.message}`); }
  }

  function showSelectionCard(source, translation, loading = false) {
    document.getElementById("yayi-selection-card")?.remove();
    const card = document.createElement("section");
    card.id = "yayi-selection-card";
    card.dataset.yayiIgnore = "true";
    card.innerHTML = `<button type="button" aria-label="关闭">×</button><div class="yayi-card-title">雅译</div><div class="yayi-card-source"></div><div class="yayi-card-result"></div>`;
    card.querySelector(".yayi-card-source").textContent = source;
    card.querySelector(".yayi-card-result").textContent = translation;
    if (loading) card.querySelector(".yayi-card-result").classList.add("yayi-pulse");
    card.querySelector("button").addEventListener("click", () => card.remove());
    document.documentElement.appendChild(card);
  }

  function ensureOverlay() {
    if (overlay?.isConnected) return overlay;
    overlay = document.createElement("div");
    overlay.id = "yayi-subtitle-overlay";
    overlay.dataset.yayiIgnore = "true";
    overlay.hidden = true;
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function positionOverlay(video) {
    const element = ensureOverlay();
    if (!video?.isConnected) return;
    const rect = video.getBoundingClientRect();
    element.style.left = `${Math.max(12, rect.left + rect.width * 0.08)}px`;
    element.style.width = `${Math.max(180, rect.width * 0.84)}px`;
    element.style.bottom = `${Math.max(24, innerHeight - rect.bottom + rect.height * 0.08)}px`;
  }

  async function showSubtitle(source, video) {
    const normalized = source.replace(/\s+/g, " ").trim();
    if (!subtitleEnabled || !containsForeignText(normalized) || normalized === overlaySource) return;
    overlaySource = normalized;
    const element = ensureOverlay();
    positionOverlay(video || document.querySelector("video"));
    element.hidden = false;
    element.textContent = "翻译中…";
    try {
      let translated = subtitleCache.get(normalized);
      if (!translated) {
        const response = await send({ type: "TRANSLATE", texts: [normalized] });
        if (!response?.ok) throw new Error(response?.error || "字幕翻译失败");
        translated = response.translations[0];
        subtitleCache.set(normalized, translated);
        if (subtitleCache.size > 500) subtitleCache.delete(subtitleCache.keys().next().value);
      }
      if (overlaySource !== normalized) return;
      element.textContent = cfg.bilingual ? `${normalized}\n${translated}` : translated;
      clearTimeout(overlayTimer);
      overlayTimer = setTimeout(() => { if (overlaySource === normalized) element.hidden = true; }, 8000);
    } catch (error) {
      element.textContent = `字幕翻译失败：${error.message}`;
    }
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
    video.addEventListener("play", bindTracks);
    video.addEventListener("timeupdate", () => { bindTracks(); positionOverlay(video); });
  }

  function scanVideos(root = document) {
    if (root instanceof HTMLVideoElement) attachVideo(root);
    root.querySelectorAll?.("video").forEach(attachVideo);
  }

  function captionTextFrom(element) {
    if (!element?.matches?.(CAPTION_SELECTORS.join(","))) element = element?.closest?.(CAPTION_SELECTORS.join(","));
    if (!element || element.closest("#yayi-subtitle-overlay")) return "";
    const text = element.innerText?.trim() || "";
    return text.length <= 500 ? text : "";
  }

  function observeDynamicContent() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          scanVideos(node);
          const caption = captionTextFrom(node);
          if (caption) showSubtitle(caption, node.closest?.("video") || document.querySelector("video"));
        }
        const caption = captionTextFrom(mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement);
        if (caption) showSubtitle(caption, document.querySelector("video"));
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const run = async () => {
      if (message.type === "TRANSLATE_PAGE") await translatePage();
      else if (message.type === "RESTORE_PAGE") restorePage();
      else if (message.type === "TOGGLE_PAGE") pageTranslated ? restorePage() : await translatePage();
      else if (message.type === "TRANSLATE_SELECTION") await translateSelection(message.text || getSelection()?.toString());
      else if (message.type === "TOGGLE_SUBTITLES") {
        subtitleEnabled = Boolean(message.enabled);
        if (!subtitleEnabled && overlay) overlay.hidden = true;
      }
      return { ok: true, pageTranslated, translating, subtitleEnabled };
    };
    run().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  async function init() {
    try {
      const response = await send({ type: "GET_SETTINGS" });
      cfg = response?.settings || { batchSize: 18, minTextLength: 2, bilingual: false, translateSubtitles: true };
      subtitleEnabled = cfg.translateSubtitles !== false;
      scanVideos();
      observeDynamicContent();
      addEventListener("resize", () => positionOverlay(document.querySelector("video")), { passive: true });
      if (cfg.autoTranslate && window === top) translatePage();
    } catch (error) { console.warn("[雅译] 初始化失败", error); }
  }

  init();
})();
