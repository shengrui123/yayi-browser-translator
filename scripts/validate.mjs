import { readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifests = ["manifest.json", "manifest.firefox.json"];
let checked = 0;

for (const manifestName of manifests) {
  const manifest = JSON.parse(await readFile(path.join(root, manifestName), "utf8"));
  if (manifest.manifest_version !== 3) throw new Error(`${manifestName}: 必须使用 Manifest V3`);
  const referenced = [
    manifest.background?.service_worker,
    ...(manifest.background?.scripts || []),
    manifest.action?.default_popup,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...manifest.content_scripts.flatMap((item) => [...item.js, ...(item.css || [])])
  ].filter(Boolean);
  for (const file of referenced) await access(path.join(root, file));
  checked += 1;
}

for (const file of ["src/config.js", "src/background.js", "src/content.js", "popup/popup.js", "options/options.js"]) {
  execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
  checked += 1;
}

const html = await readFile(path.join(root, "options/options.html"), "utf8");
if (/script\s+src=["']https?:/i.test(html)) throw new Error("设置页不得加载远程脚本");
console.log(`检查通过：${checked} 项清单与脚本校验完成。`);
