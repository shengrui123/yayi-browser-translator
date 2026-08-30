if (typeof importScripts === "function") importScripts("config.js");

const api = globalThis.browser || globalThis.chrome;
const DEFAULTS = globalThis.DEFAULT_SETTINGS;
const STYLES = globalThis.STYLE_LABELS;
const cache = new Map();

async function settings() {
  return { ...DEFAULTS, ...(await api.storage.local.get(DEFAULTS)) };
}

function promptFor(texts, cfg) {
  const glossary = cfg.glossary.trim() ? `\n必须遵守以下术语表（每行一条）：\n${cfg.glossary.trim()}` : "";
  return `你是专业翻译家。把输入中的非中文内容翻译为${cfg.targetLanguage}。\n风格：${STYLES[cfg.translationStyle] || STYLES.elegant}。\n规则：\n1. 保留人名、品牌名、代码、URL、数字、占位符和原有换行。\n2. 已是中文的内容原样返回。\n3. 结合上下文消除歧义，不解释、不添加注释。\n4. 只返回 JSON 数组，元素数量和顺序必须与输入完全一致，格式为 [{"id":0,"text":"译文"}]。${glossary}\n\n输入：${JSON.stringify(texts.map((text, id) => ({ id, text })))}`;
}

function parseJsonTranslations(value, expected) {
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

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = { raw }; }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || data?.raw || `${response.status} ${response.statusText}`;
    throw new Error(String(message).slice(0, 500));
  }
  return data;
}

async function openAI(texts, cfg) {
  if (!cfg.openaiKey) throw new Error("请先在设置中填写 OpenAI API Key");
  const data = await fetchJson(`${cfg.openaiBaseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.openaiKey}` },
    body: JSON.stringify({ model: cfg.openaiModel, input: promptFor(texts, cfg), store: false })
  });
  const output = data.output_text || data.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text;
  if (!output) throw new Error("OpenAI 未返回文本结果");
  return parseJsonTranslations(output, texts.length);
}

async function gemini(texts, cfg) {
  if (!cfg.geminiKey) throw new Error("请先在设置中填写 Gemini API Key");
  const url = `${cfg.geminiBaseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`;
  const data = await fetchJson(url, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.geminiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: promptFor(texts, cfg) }] }], generationConfig: { responseMimeType: "application/json" } })
  });
  const output = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!output) throw new Error(data.promptFeedback?.blockReason || "Gemini 未返回文本结果");
  return parseJsonTranslations(output, texts.length);
}

async function deepL(texts, cfg) {
  if (!cfg.deeplKey) throw new Error("请先在设置中填写 DeepL API Key");
  const data = await fetchJson(`${cfg.deeplBaseUrl.replace(/\/$/, "")}/translate`, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${cfg.deeplKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: texts, target_lang: cfg.targetLanguage.includes("繁") ? "ZH-HANT" : "ZH-HANS" })
  });
  return data.translations.map((item) => item.text);
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

async function custom(texts, cfg) {
  if (!cfg.customUrl) throw new Error("请先填写自定义 API URL");
  let extraHeaders;
  try { extraHeaders = JSON.parse(cfg.customHeaders || "{}"); } catch { throw new Error("自定义请求头必须是合法 JSON"); }
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  if (cfg.customKey && !headers.Authorization) headers.Authorization = `Bearer ${cfg.customKey}`;
  const userPrompt = promptFor(texts, cfg);
  const escapeInsideJsonString = (value) => JSON.stringify(String(value)).slice(1, -1);
  let body;
  try {
    const rendered = (cfg.customBodyTemplate || DEFAULTS.customBodyTemplate)
      .replaceAll("{{model}}", escapeInsideJsonString(cfg.customModel || ""))
      .replaceAll("{{prompt}}", escapeInsideJsonString(userPrompt))
      .replaceAll("{{texts}}", JSON.stringify(texts));
    body = JSON.parse(rendered);
  } catch { throw new Error("自定义请求体模板渲染后不是合法 JSON"); }
  const data = await fetchJson(cfg.customUrl, {
    method: "POST", headers,
    body: JSON.stringify(body)
  });
  const output = getPath(data, cfg.customResponsePath) ?? data.translations ?? data.output ?? data;
  if (Array.isArray(output) && output.every((item) => typeof item === "string")) return output;
  return parseJsonTranslations(output, texts.length);
}

async function translate(texts) {
  const cfg = await settings();
  const results = new Array(texts.length);
  const missing = [];
  const missingIndexes = [];
  texts.forEach((text, index) => {
    const key = `${cfg.provider}|${cfg.targetLanguage}|${cfg.translationStyle}|${cfg.glossary}|${text}`;
    if (cache.has(key)) results[index] = cache.get(key);
    else { missing.push(text); missingIndexes.push(index); }
  });
  if (missing.length) {
    const fn = { openai: openAI, gemini, deepl: deepL, custom }[cfg.provider];
    if (!fn) throw new Error(`不支持的服务商：${cfg.provider}`);
    const translated = await fn(missing, cfg);
    translated.forEach((text, i) => {
      const index = missingIndexes[i];
      results[index] = text;
      const key = `${cfg.provider}|${cfg.targetLanguage}|${cfg.translationStyle}|${cfg.glossary}|${texts[index]}`;
      cache.set(key, text);
    });
    if (cache.size > 1500) cache.delete(cache.keys().next().value);
  }
  return results;
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TRANSLATE") {
    translate(message.texts || []).then((translations) => sendResponse({ ok: true, translations })).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type === "GET_SETTINGS") {
    settings().then((value) => sendResponse({ ok: true, settings: value }));
    return true;
  }
  if (message?.type === "OPEN_OPTIONS") {
    Promise.resolve(api.runtime.openOptionsPage())
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

api.runtime.onInstalled.addListener(() => {
  const createMenu = () => api.contextMenus.create({ id: "yayi-translate-selection", title: "翻译所选内容为中文", contexts: ["selection"] });
  if (globalThis.browser) api.contextMenus.removeAll().then(createMenu);
  else api.contextMenus.removeAll(createMenu);
});

api.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "yayi-translate-selection" && tab?.id) api.tabs.sendMessage(tab.id, { type: "TRANSLATE_SELECTION", text: info.selectionText });
});

api.commands?.onCommand.addListener(async (command) => {
  if (command !== "translate-page") return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) api.tabs.sendMessage(tab.id, { type: "TOGGLE_PAGE" });
});
