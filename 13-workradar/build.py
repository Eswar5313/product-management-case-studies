"""Inline src/ into (1) a standalone index.html and (2) the body-only page used for the Claude artifact."""
import pathlib
root = pathlib.Path(__file__).parent
s = lambda n: (root / "src" / n).read_text()
fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">'
page = f"<title>WorkRadar</title>\n{fonts}\n<style>\n{s('styles.css')}</style>\n{s('body.html')}<script>\n{s('data.js')}\n{s('app.js')}</script>\n"
(root / "dist").mkdir(exist_ok=True)
(root / "dist" / "artifact.html").write_text(page)
(root / "index.html").write_text('<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<style>body{margin:0}[hidden]{display:none!important}</style></head><body>\n' + page + "</body></html>\n")
print("built", len(page), "bytes")
