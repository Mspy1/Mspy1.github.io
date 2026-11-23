"""Check the shipped arcade catalog, offline. Optional args require new game slugs."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlsplit
import json
import re
import sys
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
HOME = ROOT / "index.html"
HUB = ROOT / "games" / "index.html"
SITE = "https://mspy1.github.io"


class Cards(HTMLParser):
    def __init__(self):
        super().__init__()
        self.items = []
        self.card = None
        self.heading = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        classes = a.get("class", "").split()
        if tag == "article" and "gcard" in classes:
            self.card = {}
            self.items.append(self.card)
        if self.card is None:
            return
        if tag == "h3":
            self.heading = True
        elif tag == "a" and "play" in classes:
            self.card["route"] = a["href"]
        elif tag == "a" and "source" in classes:
            self.card["source"] = a["href"]
        elif tag == "img":
            self.card["thumb"] = urlsplit(urljoin(SITE + "/games/", a["src"])).path

    def handle_data(self, text):
        if self.heading:
            self.card["title"] = self.card.get("title", "") + text

    def handle_endtag(self, tag):
        if tag == "h3":
            self.heading = False
        elif tag == "article":
            self.card = None


def check(required):
    hub = HUB.read_text(encoding="utf-8")
    parser = Cards()
    parser.feed(hub)
    cards = {c["route"]: c for c in parser.items}
    assert cards and len(cards) == len(parser.items), "Missing or duplicate game route"
    missing = [slug for slug in required if f"/games/{slug}/" not in cards]
    assert not missing, f"Missing requested games: {', '.join(missing)}"
    for path, c in cards.items():
        assert path.startswith("/") and not path.startswith("//"), path
        assert (ROOT / path.strip("/") / "index.html").is_file(), path
        assert c["source"].startswith("https://"), c
        assert (ROOT / c["thumb"].lstrip("/")).is_file(), c
        assert c["title"].strip(), c

    schema = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', hub, re.S)[1])
    items = schema["mainEntity"]["itemListElement"]
    assert [(i["name"], i["url"], i["position"]) for i in items] == [
        (c["title"], SITE + route, n) for n, (route, c) in enumerate(cards.items(), 1)
    ], "Structured list differs from playable catalog"

    expected = {(c["title"], route, c["thumb"]) for route, c in cards.items() if route != "/football/"}
    featured = json.loads(re.search(r"const FEATURED_GAMES\s*=\s*(\[.*?\]);", HOME.read_text(encoding="utf-8"), re.S)[1])
    assert len(featured) == len(expected) and {tuple(x) for x in featured} == expected, "Spotlight differs"
    urls = [el.text for el in ET.parse(ROOT / "sitemap.xml").iterfind(".//{*}loc")]
    assert len(set(urls)) == len(urls) and all(SITE + r in urls for r in cards), "Sitemap differs"
    print(f"{len(cards)} game cards, {len(featured)} spotlight picks, {len(urls)} sitemap URLs: OK")


if __name__ == "__main__":
    check(sys.argv[1:])
