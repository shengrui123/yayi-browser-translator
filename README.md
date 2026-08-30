# 雅译 · 浏览器翻译

一套无构建依赖的网页与字幕翻译工具，将网页和播放器已有字幕翻译为中文。支持 Chrome、Edge、Firefox 扩展，以及可直接安装的 Tampermonkey 油猴脚本。

## 下载网站

项目包含一套位于 `docs/` 的响应式下载官网，并通过 `.github/workflows/pages.yml` 自动构建插件包、发布到 GitHub Pages。网站会识别 Chrome、Edge、Firefox 或 Safari，并优先展示对应的扩展或油猴脚本版本。

仓库根目录的 `vercel.json` 同时支持 Vercel：构建命令为 `sh scripts/build.sh`，静态输出目录为 `docs`。Vercel 项目无需再设置为默认的 `public` 目录。

本地预览：

```bash
sh scripts/build.sh
python3 -m http.server 4173 --directory docs
```

## 功能

- 翻译网页中的可见非中文文本，可随时还原原文
- 准确直译、自然意译、信达雅三种风格
- OpenAI Responses API、Gemini、DeepL、自定义 API
- 原生 `TextTrack` 字幕和 YouTube、Video.js、JW Player、Plyr、Shaka 等常见 DOM 字幕层
- 双语对照、术语表、自动翻译、右键翻译选中内容
- 内存级译文缓存，减少同一浏览会话中的重复请求

## 安装

扩展本身无需安装依赖。先在项目目录运行构建脚本：

```bash
sh scripts/build.sh
```

如果本机装有 Node.js，也可额外运行 `npm run check` 做清单引用和 JavaScript 语法校验，再用 `npm run build` 构建。
构建结果位于 `dist/chromium`、`dist/firefox`，并同时生成可用于商店上传的 ZIP 包。

### Chrome / Edge

1. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择 `dist/chromium`。
4. 打开扩展设置，填写自己的 API Key。

### Firefox

1. 打开 `about:debugging#/runtime/this-firefox`。
2. 点击“临时载入附加组件”。
3. 选择 `dist/firefox/manifest.json`。

正式发布到 Firefox Add-ons 前，请把 `manifest.firefox.json` 中的示例扩展 ID 改为自己的稳定 ID。

### 油猴脚本

1. 在浏览器中安装 Tampermonkey。
2. 打开网站下载区并点击“安装油猴脚本”，或直接打开 `userscript/yayi.user.js`。
3. 在 Tampermonkey 安装页面确认安装。
4. 从 Tampermonkey 的雅译菜单打开设置，填写自己的 API Key。

油猴版支持网页翻译、还原、选中文字翻译、视频字幕翻译、三种翻译风格和四类 API。快捷键为 `Alt/Option + Shift + T`。

## API 配置

点击扩展弹窗底部的“设置 API 与翻译风格”。

- OpenAI：默认使用 Responses API。填写 API Key，可自行更改模型和兼容代理的 Base URL。
- Gemini：填写 Google AI API Key、模型与 Base URL。
- DeepL：Free 账户默认使用 `api-free.deepl.com`；Pro 账户改为 `https://api.deepl.com/v2`。
- 自定义 API：提供 URL、请求头、请求体 JSON 模板和响应文本路径。模板支持 `{{model}}`、`{{prompt}}`，以及放在 JSON 字符串之外的 `{{texts}}`。

自定义 OpenAI 兼容接口的默认响应路径为 `choices.0.message.content`。若接口直接返回：

```json
{"translations":["译文一","译文二"]}
```

把响应路径留为默认也可以，扩展会自动回退读取 `translations`。

## 字幕范围

扩展翻译视频页面已经提供的字幕，包括浏览器原生字幕轨和常见播放器渲染的字幕 DOM。它不会绕过 DRM，也不会偷偷上传整段音轨。没有字幕轨的视频不会自动变成语音识别字幕；如需该能力，应另行接入流式语音转写服务，并先确认平台条款、版权、隐私与费用。

## 安全与隐私

API Key 与偏好使用 `storage.local` 保存在浏览器本地。需要翻译的文本会发送给你选择的 API 服务商。不要在准备公开分发的扩展中预置密钥；多人或商业使用应让扩展访问自有后端，由后端保管服务商密钥并执行鉴权、限流和日志脱敏。

扩展申请 `<all_urls>` 是为了读取网页文字并连接用户自定义的 API 地址。正式商店发布时，可以改用运行时可选权限，以减少默认授权范围。

## 项目结构

```text
manifest.json              Chromium 源清单
manifest.firefox.json      Firefox 清单
userscript/yayi.user.js    Tampermonkey 油猴脚本
src/background.js          API 调用、提示词、缓存、右键菜单
src/content.js             网页文本与字幕识别、覆盖层
popup/                     扩展弹窗
options/                   API 与翻译偏好设置
scripts/                   校验和多浏览器构建脚本
```
