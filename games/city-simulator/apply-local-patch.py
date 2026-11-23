#!/usr/bin/env python3
"""Reproduce the local City Simulator presentation from the pristine gh-pages snapshot.

Usage:
    python apply-local-patch.py [PRISTINE_GH_PAGES_DIR] [OUTPUT_DIR]

With no arguments it patches the files in this directory in place. The pristine
snapshot is upstream graememcc/micropolisJS gh-pages afe2047
(index identifies source f13a1624d111d235e804bd80f48ba7c9f66a8e0f).
Only presentation, privacy and neutral-name changes are made; game logic in the
bundled JS is otherwise byte-identical to upstream.
"""
from pathlib import Path
import shutil
import sys

SRC = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent
DST = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else Path(__file__).resolve().parent
DST.mkdir(parents=True, exist_ok=True)

if SRC != DST:
    for item in SRC.iterdir():
        if item.name in {'.git', '.gitignore'}:
            continue
        target = DST / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)


def edit(name, fn):
    p = DST / name
    p.write_text(fn(p.read_text(encoding='utf-8')), encoding='utf-8', newline='')


def sub_once(text, old, new, count=1):
    if old not in text:
        if new in text:
            return text
        raise SystemExit(f'expected text not found: {old[:90]!r}')
    return text.replace(old, new, count)


THEME = '''<script>(function(){var t="dark";try{t=localStorage.getItem("site-theme")||"dark"}catch(e){}if(t==="system"){t=window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}else if(t!=="dark"&&t!=="light"){t="dark"}var d=document.documentElement;d.setAttribute("data-theme",t);d.setAttribute("data-site-theme",t)})();</script>'''

FAVICON = '''<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 rx=%2224%22 fill=%22%231d1d1f%22/><text x=%2250%22 y=%2266%22 font-family=%22-apple-system,Helvetica,Arial%22 font-size=%2248%22 font-weight=%22700%22 fill=%22white%22 text-anchor=%22middle%22>C</text></svg>">'''

BACKBAR = '''<!-- Shared themed back bar from games/backbar-snippet.html (site chrome only). -->
<style>
.msm-backbar{--bg:#ffffff;--bg-alt:#f5f5f7;--ink:#1d1d1f;--ink-2:#424245;--muted:#6e6e73;--line:#d2d2d7;--blue:#0066cc;--blue-hover:#0077ed;--bar-bg:rgba(255,255,255,.86);--max:1080px;--ease:cubic-bezier(.22,.61,.36,1);box-sizing:border-box;position:sticky;top:0;z-index:2147483000;height:48px;display:flex;align-items:center;padding:0 22px;background:var(--bar-bg);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid var(--line);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:13px;line-height:1;letter-spacing:-.01em;color:var(--ink-2)}
html[data-theme="dark"] .msm-backbar,html[data-site-theme="dark"] .msm-backbar{--bg:#0b0b0d;--bg-alt:#161619;--ink:#f5f5f7;--ink-2:#c8c8ce;--muted:#9b9ba3;--line:#2e2e33;--blue:#5aa9ff;--blue-hover:#7fbcff;--bar-bg:rgba(16,16,19,.86)}
.msm-backbar *{box-sizing:border-box}
.msm-backbar .msm-inner{width:100%;max-width:var(--max);margin:0 auto;display:flex;align-items:center;gap:12px}
.msm-backbar a{color:var(--blue);font-weight:600;text-decoration:none;white-space:nowrap}
.msm-backbar a:hover{color:var(--blue-hover);text-decoration:underline}
.msm-backbar .msm-title{margin-left:auto;color:var(--ink);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@media (max-width:380px){.msm-backbar{padding:0 14px}.msm-backbar .msm-inner{gap:8px}}
</style>
<div class="msm-backbar"><div class="msm-inner"><a href="/games/">← Mspy1 · Games</a><span class="msm-title">City Simulator</span></div></div>'''

FOOTER = '''<footer id="localFooter" class="alignCenter chunk white padding10"><div class="nameLicense">Micropolis is a registered trademark of <a href="https://www.micropolis.com">Micropolis Corporation (Micropolis GmbH)</a> and is licensed here as a courtesy of the owner under the <a href="name_license.html">Micropolis Public Name License</a>.</div><div class="open">Modified, unendorsed local presentation of a GPLv3 upstream port. <a href="CREDITS.html">Credits &amp; licenses</a> · <a href="corresponding-source.zip">Corresponding source</a></div></footer>'''


def patch_index(text):
    text = sub_once(text, '<head>', '<head>' + THEME)
    text = sub_once(text, '<meta charset="utf-8">', FAVICON + '<meta charset="utf-8">')
    text = sub_once(text, '<meta name="description" content="Play micropolisJS and build a virtual city in your browser! micropolisJS is a handwritten HTML5/Javascript port of Micropolis, the open-source release of SimCity (the 1989 version).">',
                    '<meta name="description" content="City Simulator: a modified, unendorsed open-source city-building game. Build a city locally in your browser.">')
    text = sub_once(text, '<title>micropolisJS</title>', '<title>City Simulator</title>')
    text = sub_once(text, '<body>', '<body>' + BACKBAR + '<!-- Modified local presentation, 2026-11-23. Not endorsed by upstream authors or trademark owners. -->')
    text = sub_once(text, 'id="title" class="white fontlarge">micropolisJS', 'id="title" class="white fontlarge">City Simulator')
    text = sub_once(text, '<li class="padding10"><a href="about.html" target="_blank">About</a></li>',
                    '<li class="padding10"><a href="CREDITS.html" target="_blank">About</a></li>')
    text = sub_once(text, '<p>micropolisJS is a handmade Javascript port of the open-source city simulator <cite>Micropolis</cite></p>',
                    '<p>City Simulator is a modified, unendorsed open-source city-building game. Build a city and balance its budget.</p>')
    text = sub_once(text, "micropolisJS isn't really geared towards touch devices", "this game isn't really geared towards touch devices")
    text = sub_once(text, '<h1 class="chunk alignCenter">micropolisJS</h1>', '<h1 class="chunk alignCenter">City Simulator</h1>')
    text = sub_once(text, 'Hey, thanks for your interest in micropolisJS!', 'Hey, thanks for your interest in this local city simulator!')
    text = sub_once(text, 'Enjoyed micropolisJS?', 'Enjoyed the game?')
    text = sub_once(text, 'class="nagHeader padding10 chunk white alignCenter">micropolisJS</header>', 'class="nagHeader padding10 chunk white alignCenter">City Simulator</header>')
    # Remove any remote Twitter widget and its loader if present in a given build.
    import re
    text = re.sub(r'<div[^>]*id="tw"[^>]*>.*?</div>', '', text, flags=re.S)
    text = re.sub(r'<script[^>]*src="[^"]*platform\.twitter[^"]*"[^>]*></script>', '', text)
    text = sub_once(text, '</body>', FOOTER + '</body>')
    return text


def patch_css(text):
    # No external runtime: drop the remote Google Fonts import. All other rules,
    # including the local Chunk font and its OFL notice, remain verbatim.
    return sub_once(text, '@import url(https://fonts.googleapis.com/css?family=Open+Sans:400,300,600,300italic,400italic);\n', '')


def patch_js(text):
    text = sub_once(text, 'WELCOME="Welcome to micropolisJS"', 'WELCOME="Welcome to City Simulator"')
    text = sub_once(text, '"Welcome to micropolisJS"', '"Welcome to City Simulator"')
    text = sub_once(text, '"micropolisJSGame"', '"citySimulatorGame"')
    return text


def credits_page():
    return '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Credits &amp; licenses · City Simulator</title><link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 rx=%2224%22 fill=%22%231d1d1f%22/><text x=%2250%22 y=%2266%22 font-family=%22-apple-system,Helvetica,Arial%22 font-size=%2248%22 font-weight=%22700%22 fill=%22white%22 text-anchor=%22middle%22>C</text></svg>"><link rel="stylesheet" href="css/style.css"></head><body><header class="chunk border-bottom padding10"><div class="left inlineblock"><h1 id="title" class="white fontlarge"><a href="index.html">City Simulator</a></h1></div><nav class="white right padding10 inlineblock"><ul><li class="padding10"><a href="/games/">← Games</a></li></ul></nav></header><main class="mintcream open padding10"><h2>Credits &amp; licenses</h2><p>This is a published, modified and unendorsed edition of the open-source city simulator port by Graeme McCutcheon and contributors. It is not affiliated with or endorsed by the upstream authors, Electronic Arts, or any trademark owner.</p><h3>Upstream source</h3><ul><li>Upstream project: <a href="https://github.com/graememcc/micropolisJS">github.com/graememcc/micropolisJS</a></li><li>Published snapshot: gh-pages <code>afe2047a9fca66d721ddcfe2eaf6d08d2c226c56</code></li><li>Identified source commit: <code>f13a1624d111d235e804bd80f48ba7c9f66a8e0f</code></li><li>Complete corresponding source: <a href="corresponding-source.zip">corresponding-source.zip</a> (verbatim source archive)</li><li>Author credit (verbatim): Brought to you by <a rel="author" href="http://www.graememcc.co.uk">Graeme McCutcheon</a> and <a rel="author" href="https://github.com/graememcc/micropolisJS/graphs/contributors">contributors</a>. Upstream build marker: <code>f13a1624d111</code>.</li></ul><h3>Required trademark attribution (verbatim)</h3><p class="nameLicense">Micropolis is a registered trademark of <a href="https://www.micropolis.com">Micropolis Corporation (Micropolis GmbH)</a> and is licensed here as a courtesy of the owner under the <a href="name_license.html">Micropolis Public Name License</a>.</p><p>The full, verbatim Micropolis Public Name License is included as <a href="name_license.html">name_license.html</a>.</p><h3>Software licenses (verbatim copies included)</h3><ul><li>GNU GPL v3 — <a href="COPYING">COPYING</a> (full text).</li><li>micropolisJS additional terms under GPL §7 and copyright notice — <a href="LICENSE">LICENSE</a> (verbatim). The Electronic Arts additional terms, disclaimer, indemnity and no-affiliation conditions are reproduced there in full and are retained without change.</li><li>jQuery (MIT) — <a href="thirdparty/jquery/MIT-LICENSE.txt">thirdparty/jquery/MIT-LICENSE.txt</a>. Local copies of jQuery 1.7.2, 2.0.3 and 2.1.1 are shipped verbatim.</li><li>Chunk font (SIL Open Font License 1.1) — <a href="css/FONT_LICENSE.markdown">css/FONT_LICENSE.markdown</a>. The bundled <code>css/chunk.woff</code> is used unmodified.</li><li>Webpack runtime notice — <a href="src/micropolis.js.LICENSE.txt">src/micropolis.js.LICENSE.txt</a>.</li></ul><h3>Local modifications</h3><p>Display name, site chrome, favicon and welcome strings are changed to the neutral title “City Simulator”; the remote Google Fonts import and the remote Twitter widget/loader are removed; the localStorage namespace is renamed. No trademark or publicity rights are claimed, and no affiliation, endorsement or certification is implied. Game logic and all bundled artwork, tiles, sprites and fonts are otherwise unchanged from the pinned upstream snapshot. All files are served locally; there is no analytics, backend, CDN or external runtime.</p></main><footer class="alignCenter chunk white padding10"><a href="index.html">Back to the game</a> · <a href="/games/">Games</a></footer></body></html>'''


def neutral_about():
    return '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Credits · City Simulator</title><link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect width=%22100%22 height=%22100%22 rx=%2224%22 fill=%22%231d1d1f%22/><text x=%2250%22 y=%2266%22 font-family=%22-apple-system,Helvetica,Arial%22 font-size=%2248%22 font-weight=%22700%22 fill=%22white%22 text-anchor=%22middle%22>C</text></svg>"><link rel="stylesheet" href="css/style.css"></head><body><header class="chunk border-bottom padding10"><h1 id="title" class="white fontlarge"><a href="index.html">City Simulator</a></h1></header><main class="mintcream open padding10"><p>Upstream credits, license texts and notices have moved to <a href="CREDITS.html">CREDITS.html</a>.</p><p class="nameLicense">Micropolis is a registered trademark of <a href="https://www.micropolis.com">Micropolis Corporation (Micropolis GmbH)</a> and is licensed here as a courtesy of the owner under the <a href="name_license.html">Micropolis Public Name License</a>.</p></main></body></html>'''


edit('index.html', patch_index)
edit('css/style.css', patch_css)
edit('src/micropolis.js', patch_js)
edit('name_license.html', lambda text: sub_once(text, '<head>', '<head>' + FAVICON))
(DST / 'CREDITS.html').write_text(credits_page(), encoding='utf-8', newline='')
(DST / 'about.html').write_text(neutral_about(), encoding='utf-8', newline='')
print(f'patched {DST}')
