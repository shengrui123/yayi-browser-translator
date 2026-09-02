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
  let translationRun = 0;
  let subtitleEnabled = true;
  let overlay = null;
  let overlayVideo = null;
  let overlaySource = "";
  let overlayTimer = 0;
  let floatingSwitcher = null;

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
    if (parent.closest("[data-yayi-ignore], #yayi-subtitle-overlay, #yayi-selection-card, #yayi-toast, #yayi-floating-switcher")) return false;
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

  async function translateBatch(nodes, runId) {
    const parts = nodes.map((node) => splitWhitespace(node.nodeValue || ""));
    const response = await send({ type: "TRANSLATE", texts: parts.map((part) => part.core) });
    if (!response?.ok) throw new Error(response?.error || "翻译失败");
    if (runId !== translationRun) return false;
    nodes.forEach((node, index) => {
      if (!node.isConnected) return;
      if (!originalText.has(node)) originalText.set(node, node.nodeValue);
      const translated = `${parts[index].leading}${response.translations[index]}${parts[index].trailing}`;
      node.nodeValue = cfg.bilingual ? `${originalText.get(node)}\n${translated}` : translated;
      translatedText.set(node, node.nodeValue);
    });
    return true;
  }

  async function translatePage() {
    if (translating) return;
    const runId = ++translationRun;
    translating = true;
    updateFloatingSwitcher();
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
        if (!await translateBatch(nodes.slice(i, i + size), runId)) return;
        toast(`翻译中 ${Math.min(i + size, nodes.length)}/${nodes.length}`, "loading");
      }
      pageTranslated = true;
      toast(`已翻译 ${nodes.length} 段文字`, "success");
    } catch (error) {
      toast(error.message, "error", 5000);
      throw error;
    } finally {
      if (runId === translationRun) translating = false;
      updateFloatingSwitcher();
    }
  }

  function restorePage() {
    let count = 0;
    for (const [node, original] of originalText) {
      if (node.isConnected) { node.nodeValue = original; count += 1; }
    }
    originalText.clear();
    pageTranslated = false;
    updateFloatingSwitcher();
    toast(`已还原 ${count} 段文字`);
  }

  async function togglePageTranslation() {
    if (translating || pageTranslated || originalText.size) {
      translationRun += 1;
      translating = false;
      restorePage();
      return;
    }
    await translatePage();
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
    overlay.innerHTML = '<span class="yayi-subtitle-text"></span>';
    overlay.hidden = true;
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function positionOverlay(video) {
    const element = ensureOverlay();
    if (!video?.isConnected) return false;
    const rect = video.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 30) {
      element.hidden = true;
      return false;
    }
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.top}px`;
    element.style.width = `${rect.width}px`;
    element.style.height = `${rect.height}px`;
    element.style.paddingBottom = `${Math.max(8, rect.height * 0.075)}px`;
    return true;
  }

  async function showSubtitle(source, video) {
    const normalized = source.replace(/\s+/g, " ").trim();
    if (!subtitleEnabled || !containsForeignText(normalized) || normalized === overlaySource) return;
    overlaySource = normalized;
    const element = ensureOverlay();
    const textElement = element.querySelector(".yayi-subtitle-text");
    overlayVideo = video || document.querySelector("video");
    if (!positionOverlay(overlayVideo)) return;
    element.hidden = false;
    textElement.textContent = "翻译中…";
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
      textElement.textContent = cfg.bilingual ? `${normalized}\n${translated}` : translated;
      clearTimeout(overlayTimer);
      overlayTimer = setTimeout(() => { if (overlaySource === normalized) element.hidden = true; }, 8000);
    } catch (error) {
      textElement.textContent = `字幕翻译失败：${error.message}`;
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
    const refresh = () => { bindTracks(); if (overlayVideo === video) positionOverlay(video); };
    video.addEventListener("loadedmetadata", refresh);
    video.addEventListener("play", refresh);
    video.addEventListener("timeupdate", refresh);
    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(() => { if (overlayVideo === video) positionOverlay(video); });
      resizeObserver.observe(video);
      video.__yayiResizeObserver = resizeObserver;
    }
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

  const PROVIDERS = {
    openai: { name: "OpenAI", badge: "AI", model: () => cfg.openaiModel || "OpenAI" },
    gemini: { name: "Gemini", badge: "G", model: () => cfg.geminiModel || "Gemini" },
    deepl: { name: "DeepL", badge: "D", model: () => "DeepL" },
    custom: { name: "自定义 API", badge: "API", model: () => cfg.customModel || "兼容接口" }
  };

  function clampFloatingTop(top, height = 58) {
    return Math.max(8, Math.min(top, Math.max(8, innerHeight - height - 8)));
  }

  function floatingTopFromSettings(height = 58) {
    const available = Math.max(1, innerHeight - height - 16);
    const value = Number(cfg.floatingButtonY);
    const ratio = Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0.38;
    return 8 + available * ratio;
  }

  function updateFloatingSwitcher() {
    if (!floatingSwitcher?.isConnected) return;
    const provider = PROVIDERS[cfg.provider] || PROVIDERS.openai;
    const trigger = floatingSwitcher.querySelector(".yayi-floating-trigger");
    trigger.querySelector("b").textContent = "译";
    trigger.querySelector("small").textContent = provider.badge;
    const active = translating || pageTranslated || originalText.size > 0;
    floatingSwitcher.classList.toggle("yayi-page-translated", active);
    floatingSwitcher.classList.toggle("yayi-translating", translating);
    trigger.setAttribute("aria-label", `${active ? "取消翻译并恢复原文" : "翻译当前网页"}。当前服务：${provider.name}；悬浮打开设置，拖动可调整位置`);
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
    floatingSwitcher.style.top = `${clampFloatingTop(top, floatingSwitcher.offsetHeight || 58)}px`;
  }

  function openFloatingMenu() {
    if (!floatingSwitcher?.isConnected || floatingSwitcher.classList.contains("yayi-dragging")) return;
    floatingSwitcher.classList.toggle("yayi-menu-up", floatingSwitcher.getBoundingClientRect().top > innerHeight / 2);
    floatingSwitcher.classList.add("yayi-menu-open");
    floatingSwitcher.querySelector(".yayi-floating-trigger").setAttribute("aria-expanded", "true");
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
    let closeTimer = 0;
    const scheduleClose = () => {
      clearTimeout(closeTimer);
      closeTimer = setTimeout(closeFloatingMenu, 140);
    };
    root.addEventListener("pointerenter", () => { clearTimeout(closeTimer); openFloatingMenu(); });
    root.addEventListener("pointerleave", scheduleClose);
    root.addEventListener("focusin", () => { clearTimeout(closeTimer); openFloatingMenu(); });
    root.addEventListener("focusout", (event) => { if (!root.contains(event.relatedTarget)) scheduleClose(); });
    trigger.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = root.getBoundingClientRect();
      pointer = { id: event.pointerId, startX: event.clientX, startY: event.clientY, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      dragged = false;
      root.classList.add("yayi-dragging");
      root.style.left = `${rect.left}px`;
      root.style.right = "auto";
    });
    addEventListener("pointermove", (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 5 && !dragged) {
        dragged = true;
        closeFloatingMenu();
      }
      const width = root.offsetWidth || 58;
      const height = root.offsetHeight || 58;
      root.style.left = `${Math.max(0, Math.min(event.clientX - pointer.offsetX, innerWidth - width))}px`;
      root.style.top = `${clampFloatingTop(event.clientY - pointer.offsetY, height)}px`;
    });
    const finishDrag = async (event) => {
      if (!pointer || event.pointerId !== pointer.id) return;
      const rect = root.getBoundingClientRect();
      const side = rect.left + rect.width / 2 < innerWidth / 2 ? "left" : "right";
      const available = Math.max(1, innerHeight - rect.height - 16);
      const ratio = Math.max(0, Math.min((rect.top - 8) / available, 1));
      pointer = null;
      root.classList.remove("yayi-dragging");
      cfg.floatingButtonSide = side;
      cfg.floatingButtonY = ratio;
      placeFloatingSwitcher(side, rect.top);
      try { await api.storage.local.set({ floatingButtonSide: side, floatingButtonY: ratio }); } catch { /* restricted storage */ }
    };
    addEventListener("pointerup", finishDrag);
    addEventListener("pointercancel", finishDrag);
    trigger.addEventListener("click", async () => {
      if (dragged) { dragged = false; return; }
      try { await togglePageTranslation(); } catch { /* error already shown */ }
      openFloatingMenu();
    });
    root.querySelectorAll("[data-provider]").forEach((button) => button.addEventListener("click", async () => {
      const provider = button.dataset.provider;
      cfg.provider = provider;
      await api.storage.local.set({ provider });
      updateFloatingSwitcher();
      closeFloatingMenu();
      toast(`已切换至 ${PROVIDERS[provider].name}`, "success");
    }));
    root.querySelector(".yayi-provider-settings").addEventListener("click", async () => {
      closeFloatingMenu();
      try {
        const response = await send({ type: "OPEN_OPTIONS" });
        if (!response?.ok) throw new Error(response?.error || "打开设置失败");
      } catch (error) { toast(`无法打开设置：${error.message}`, "error", 5000); }
    });
    addEventListener("resize", () => placeFloatingSwitcher(), { passive: true });
    addEventListener("pointerdown", (event) => { if (!root.contains(event.target)) closeFloatingMenu(); }, { passive: true });
    api.storage.onChanged?.addListener((changes, area) => {
      if (area !== "local") return;
      for (const [key, change] of Object.entries(changes)) cfg[key] = change.newValue;
      updateFloatingSwitcher();
      if (changes.floatingButtonSide || changes.floatingButtonY) placeFloatingSwitcher();
    });
  }

  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const run = async () => {
      if (message.type === "TRANSLATE_PAGE") await translatePage();
      else if (message.type === "RESTORE_PAGE") restorePage();
      else if (message.type === "TOGGLE_PAGE") await togglePageTranslation();
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
      initFloatingSwitcher();
      const refreshSubtitlePosition = () => positionOverlay(overlayVideo || document.querySelector("video"));
      addEventListener("resize", refreshSubtitlePosition, { passive: true });
      addEventListener("scroll", refreshSubtitlePosition, { passive: true, capture: true });
      document.addEventListener("fullscreenchange", () => requestAnimationFrame(refreshSubtitlePosition));
      if (cfg.autoTranslate && window === top) translatePage();
    } catch (error) { console.warn("[雅译] 初始化失败", error); }
  }

  init();
})();
