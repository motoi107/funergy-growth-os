#!/usr/bin/env python3
"""Parse release JavaScript without executing the application or contacting services."""
from html.parser import HTMLParser
from pathlib import Path
import gzip
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile


class Scripts(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.current = None
        self.items = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "script":
            self.current = [dict(attrs), []]

    def handle_data(self, data):
        if self.current is not None:
            self.current[1].append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self.current is not None:
            attrs, parts = self.current
            self.items.append((attrs, "".join(parts)))
            self.current = None


def main():
    root = Path(__file__).resolve().parents[1]
    node = shutil.which("node")
    if not node:
        raise ValueError("Node.js is required for JavaScript syntax checks.")
    raw = (root / "index.html").read_bytes()
    html = raw.decode("utf-8")
    sw = (root / "sw.js").read_text(encoding="utf-8")
    if not raw or not re.search(r"<html(?:\s|>)", html, re.I):
        raise ValueError("index.html is empty or has no HTML root.")

    parser = Scripts()
    parser.feed(html)
    parser.close()
    if parser.current is not None:
        raise ValueError("An inline script is not closed.")

    sources = [("sw", "classic", sw)]
    external_count = 0
    for number, (attrs, source) in enumerate(parser.items, 1):
        if attrs.get("src"):
            external_count += 1
            continue
        kind = attrs.get("type", "").strip().lower()
        if kind not in ("", "text/javascript", "application/javascript", "module"):
            continue
        sources.append((f"inline-{number}", kind, source))
    if len(sources) == 1:
        raise ValueError("No inline application JavaScript was found; revise this check if the app was intentionally split into modules.")

    app_source = "\n".join(source for name, kind, source in sources if name != "sw")
    app_versions = re.findall(r"\b(?:const|let|var)\s+APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", app_source)
    sw_versions = re.findall(r"\b(?:const|let|var)\s+SW_BUILD\s*=\s*['\"]([^'\"]+)['\"]", sw)
    if len(app_versions) != 1 or len(sw_versions) != 1:
        raise ValueError("Expected one APP_VERSION and one SW_BUILD declaration.")
    if app_versions[0] != sw_versions[0]:
        raise ValueError("APP_VERSION and SW_BUILD do not match.")

    with tempfile.TemporaryDirectory(prefix="growth-syntax-") as temp:
        for name, kind, source in sources:
            path = Path(temp) / (name + (".mjs" if kind == "module" else ".cjs"))
            path.write_text(source, encoding="utf-8")
            result = subprocess.run([node, "--check", str(path)], capture_output=True, text=True)
            if result.returncode:
                # Do not echo application source or embedded data from Node's error excerpt.
                errors = [line.strip() for line in result.stderr.splitlines() if re.match(r"^(?:SyntaxError|TypeError|Error):", line)]
                message = errors[0] if errors else "JavaScript syntax validation failed"
                raise ValueError(f"{name}: {message}")

    print(json.dumps({
        "result": "pass",
        "version": app_versions[0],
        "html_bytes": len(raw),
        "gzip_bytes_estimate": len(gzip.compress(raw, mtime=0)),
        "html_sha256": hashlib.sha256(raw).hexdigest(),
        "inline_scripts_checked": len(sources) - 1,
        "service_worker_checked": True,
        "external_scripts_not_executed": external_count,
        "note": "Syntax and release consistency only; browser performance and business behavior were not measured."
    }, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, UnicodeError, ValueError) as error:
        print(f"Release check failed: {error}", file=sys.stderr)
        sys.exit(1)
