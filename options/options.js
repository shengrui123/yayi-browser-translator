const api = globalThis.browser || globalThis.chrome;
const ids = Object.keys(DEFAULT_SETTINGS).filter((key) => document.getElementById(key));
const message = document.getElementById("message");

function selectedProvider() {
  return document.querySelector("input[name='provider']:checked")?.value || "openai";
}

function showProvider(provider) {
  document.querySelectorAll(".provider-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.provider === provider));
}

function collect() {
  const value = { provider: selectedProvider() };
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element.type === "checkbox") value[id] = element.checked;
    else if (element.type === "number") value[id] = Number(element.value);
    else value[id] = element.value.trim();
  }
  return value;
}

function validate(value) {
  if (value.provider === "custom") {
    if (!value.customUrl) throw new Error("请填写自定义 API 请求 URL");
    new URL(value.customUrl);
    JSON.parse(value.customHeaders || "{}");
    if (!value.customBodyTemplate.includes("{{prompt}}") && !value.customBodyTemplate.includes("{{texts}}")) throw new Error("自定义请求体模板需要包含 {{prompt}} 或 {{texts}} 占位符");
  }
  if (value.batchSize < 1 || value.batchSize > 40) throw new Error("每批文本段数应为 1–40");
}

async function save(showSuccess = true) {
  const value = collect();
  validate(value);
  await api.storage.local.set(value);
  if (showSuccess) setMessage("设置已保存");
}

function setMessage(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}

async function init() {
  const saved = { ...DEFAULT_SETTINGS, ...(await api.storage.local.get(DEFAULT_SETTINGS)) };
  document.querySelector(`input[name='provider'][value='${saved.provider}']`).checked = true;
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element.type === "checkbox") element.checked = Boolean(saved[id]);
    else element.value = saved[id];
  }
  showProvider(saved.provider);
}

document.getElementById("providers").addEventListener("change", (event) => {
  if (event.target.name === "provider") showProvider(event.target.value);
});

document.getElementById("save").addEventListener("click", async () => {
  try { await save(); } catch (error) { setMessage(error.message, true); }
});

document.getElementById("test").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setMessage("正在连接并测试翻译…");
  try {
    await save(false);
    const result = await api.runtime.sendMessage({ type: "TRANSLATE", texts: ["The quick brown fox jumps over the lazy dog."] });
    if (!result?.ok) throw new Error(result?.error || "测试失败");
    setMessage(`连接成功：${result.translations[0]}`);
  } catch (error) { setMessage(error.message, true); }
  finally { button.disabled = false; }
});

init().catch((error) => setMessage(error.message, true));
