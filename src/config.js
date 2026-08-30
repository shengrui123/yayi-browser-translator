const DEFAULT_SETTINGS = Object.freeze({
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
  autoTranslate: false,
  translateSubtitles: true,
  floatingButtonSide: "right",
  floatingButtonY: 0.38,
  batchSize: 18,
  minTextLength: 2
});

const STYLE_LABELS = Object.freeze({
  faithful: "准确直译：忠实原意、术语一致，不增不减",
  natural: "自然意译：符合现代中文表达习惯，清晰流畅",
  elegant: "信达雅：准确为先，在不改变原意的前提下自然、凝练、有文采"
});

globalThis.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
globalThis.STYLE_LABELS = STYLE_LABELS;
