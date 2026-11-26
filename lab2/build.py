from pathlib import Path
import json

p = Path(__file__).resolve().parent


def read(n):
    return (p / n).read_text(encoding="utf-8")


worker = (
    read("parsers/metadata.js")
    + "\n"
    + read("engine/worker.js")
)

engine = read("engine/scan.js")
engine = engine[engine.index("function scan"):]

script = (
    "const workerURL = URL.createObjectURL(\n"
    "    new Blob(["
    + json.dumps(worker, ensure_ascii=False)
    + '], { type: "text/javascript" })\n'
    ");\n\n"
    + engine
    + "\n\n"
    + read("ui/app.js")
)

html = read("ui/template.html")

html = html.replace(
    "<!--STYLE-->",
    "<style>\n" + read("ui/style.css") + "\n</style>"
)

html = html.replace(
    "<!--SCRIPT-->",
    "<script>\n" + script + "\n</script>"
)

(p / "index.html").write_text(html, encoding="utf-8")