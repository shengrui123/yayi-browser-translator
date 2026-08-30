(() => {
  const ua = navigator.userAgent;
  let browser = "chromium";
  let label = "下载 Chrome / Edge 版";
  let href = "downloads/yayi-chromium.zip";
  let message = "适合 Chrome、Edge、Arc、Brave 等 Chromium 浏览器";

  if (/Firefox\//i.test(ua)) {
    browser = "firefox";
    label = "下载 Firefox 版";
    href = "downloads/yayi-firefox.zip";
    message = "已识别 Firefox，为你推荐独立适配版本";
  } else if (/Safari\//i.test(ua) && !/Chrome|Chromium|CriOS|Edg\//i.test(ua)) {
    browser = "safari";
    label = "下载 Safari 转换源";
    href = "downloads/yayi-safari-source.zip";
    message = "已识别 Safari，需要使用 Xcode 完成本地封装";
  } else if (/Edg\//i.test(ua)) {
    label = "下载 Edge 版";
    message = "已识别 Microsoft Edge，为你推荐 Chromium 版本";
  } else if (/Chrome|Chromium|CriOS/i.test(ua)) {
    label = "下载 Chrome 版";
    message = "已识别 Chrome，为你推荐 Chromium 版本";
  }

  const download = document.getElementById("recommended-download");
  download.href = href;
  document.getElementById("recommended-label").textContent = label;
  document.getElementById("compatibility").textContent = message;
  document.querySelector(`[data-browser="${browser}"]`)?.classList.add("detected");
  document.getElementById("year").textContent = String(new Date().getFullYear());

  const params = new URLSearchParams(location.search);
  const repository = params.get("repo");
  if (repository && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(repository)) {
    for (const id of ["repo-link", "footer-repo"]) document.getElementById(id).href = repository;
    document.getElementById("privacy-link").href = `${repository.replace(/\/$/, "")}/blob/main/PRIVACY.md`;
  }
})();
