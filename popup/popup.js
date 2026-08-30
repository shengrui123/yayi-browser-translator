const api = globalThis.browser || globalThis.chrome;
const providerNames = { openai: "OpenAI", gemini: "Gemini", deepl: "DeepL", custom: "自定义 API" };
const status = document.getElementById("status");
const translateButton = document.getElementById("translate");

async function activeTab() {
  const tabs = await api.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function sendToPage(message) {
  const tab = await activeTab();
  if (!tab?.id) throw new Error("找不到当前页面");
  return api.tabs.sendMessage(tab.id, message);
}

async function init() {
  const saved = await api.storage.local.get({ provider: "openai", translateSubtitles: true });
  document.getElementById("provider").textContent = `${providerNames[saved.provider] || saved.provider} · 翻译为中文`;
  document.getElementById("subtitles").checked = saved.translateSubtitles !== false;
}

translateButton.addEventListener("click", async () => {
  translateButton.disabled = true;
  translateButton.querySelector("span").textContent = "正在翻译…";
  status.textContent = "";
  try {
    const result = await sendToPage({ type: "TRANSLATE_PAGE" });
    if (!result?.ok) throw new Error(result?.error || "翻译失败");
    window.close();
  } catch (error) {
    status.textContent = error.message.includes("Receiving end") ? "此页面不允许扩展运行，请换一个普通网页" : error.message;
  } finally {
    translateButton.disabled = false;
    translateButton.querySelector("span").textContent = "翻译当前网页";
  }
});

document.getElementById("restore").addEventListener("click", async () => {
  try { await sendToPage({ type: "RESTORE_PAGE" }); window.close(); }
  catch (error) { status.textContent = error.message; }
});

document.getElementById("subtitles").addEventListener("change", async (event) => {
  const enabled = event.target.checked;
  await api.storage.local.set({ translateSubtitles: enabled });
  try { await sendToPage({ type: "TOGGLE_SUBTITLES", enabled }); } catch { /* restricted pages */ }
});

document.getElementById("options").addEventListener("click", () => api.runtime.openOptionsPage());
init().catch((error) => { status.textContent = error.message; });
