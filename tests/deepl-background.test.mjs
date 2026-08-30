import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/background.js", import.meta.url), "utf8");
let messageListener;
let requestedUrl = "";
let optionsOpened = false;

const settings = {
  provider: "deepl",
  deeplKey: "test-key",
  deeplBaseUrl: "https://api-free.deepl.com/v2",
  targetLanguage: "简体中文",
  translationStyle: "elegant",
  glossary: ""
};

const browser = {
  storage: { local: { async get() { return settings; } } },
  runtime: {
    onMessage: { addListener(listener) { messageListener = listener; } },
    onInstalled: { addListener() {} },
    async openOptionsPage() { optionsOpened = true; }
  },
  contextMenus: { create() {}, async removeAll() {}, onClicked: { addListener() {} } },
  commands: { onCommand: { addListener() {} } },
  tabs: { async query() { return []; }, sendMessage() {} }
};

const context = vm.createContext({
  browser,
  DEFAULT_SETTINGS: settings,
  STYLE_LABELS: { elegant: "信达雅" },
  console,
  fetch: async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async text() { return JSON.stringify({ translations: [{ text: "你好" }] }); }
    };
  }
});

vm.runInContext(source, context, { filename: "src/background.js" });
if (typeof messageListener !== "function") throw new Error("后台消息监听器未注册");

const response = await new Promise((resolve) => {
  const keepAlive = messageListener({ type: "TRANSLATE", texts: ["Hello"] }, null, resolve);
  if (keepAlive !== true) throw new Error("异步翻译消息必须保持响应通道开启");
});

if (!response?.ok || response.translations?.[0] !== "你好") throw new Error(`DeepL 翻译回归测试失败：${JSON.stringify(response)}`);
if (requestedUrl !== "https://api-free.deepl.com/v2/translate") throw new Error(`DeepL 请求地址错误：${requestedUrl}`);

const optionsResponse = await new Promise((resolve) => {
  const keepAlive = messageListener({ type: "OPEN_OPTIONS" }, null, resolve);
  if (keepAlive !== true) throw new Error("打开设置消息必须保持响应通道开启");
});
if (!optionsResponse?.ok || !optionsOpened) throw new Error("后台未能打开扩展设置页");

console.log("DeepL 调用与设置页打开测试通过。");
