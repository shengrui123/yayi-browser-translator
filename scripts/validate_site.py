from html.parser import HTMLParser
from pathlib import Path
import sys

site = Path(sys.argv[1] if len(sys.argv) > 1 else "docs").resolve()
index = site / "index.html"


class SiteParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []
        self.ids = set()
        self.duplicates = set()

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if values.get("id") in self.ids:
            self.duplicates.add(values["id"])
        elif values.get("id"):
            self.ids.add(values["id"])
        for key in ("href", "src"):
            value = values.get(key, "")
            if value and not value.startswith(("#", "http://", "https://", "mailto:", "data:")):
                self.references.append(value.split("?", 1)[0])


parser = SiteParser()
parser.feed(index.read_text(encoding="utf-8"))
missing = sorted({item for item in parser.references if not (site / item).exists()})
if missing:
    raise SystemExit("缺少网站文件：" + ", ".join(missing))
if parser.duplicates:
    raise SystemExit("HTML ID 重复：" + ", ".join(sorted(parser.duplicates)))
if "<title>" not in index.read_text(encoding="utf-8"):
    raise SystemExit("页面缺少标题")
print(f"网站检查通过：{len(parser.references)} 个本地资源引用全部有效。")
