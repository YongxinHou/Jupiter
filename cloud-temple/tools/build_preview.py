"""Bundle public/ into one self-contained HTML page that runs in solo mode (no server).

usage: python3 tools/build_preview.py OUT.html
"""
import pathlib, re, sys

pub = pathlib.Path(__file__).resolve().parent.parent / "public"
html = (pub / "index.html").read_text()
css = (pub / "style.css").read_text().replace(":root {", ":root {\n  color-scheme: dark;", 1)
js = (pub / "app.js").read_text()

fonts = "\n".join(re.findall(r'<link rel="(?:preconnect|stylesheet)" href="https://fonts[^>]*>', html))
body = re.search(r"<body>(.*?)<script src=\"app.js\"></script>", html, re.S).group(1)

out = f"""<title>云寺 Cloud Temple</title>
{fonts}
<style>
{css}
@media (prefers-reduced-motion: reduce) {{ .gate-inner, .sheet-card {{ animation: none; }} }}
button:focus-visible {{ outline: 2px solid var(--gold); outline-offset: 2px; }}
</style>
{body}
<script>window.CT_SOLO = true;</script>
<script>
{js}
</script>
"""
pathlib.Path(sys.argv[1]).write_text(out)
print("wrote", sys.argv[1])
