"""Check the page's local assets and JavaScript syntax."""
from html.parser import HTMLParser
from pathlib import Path
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


class AssetParser(HTMLParser):
    def __init__(self, page):
        super().__init__()
        self.page = page

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'onerror' in attrs:
            return
        value = attrs.get('src')
        if tag == 'link' and attrs.get('rel') == 'stylesheet':
            value = attrs.get('href')
        if not value:
            return
        url = urlsplit(value)
        if url.scheme or url.netloc or not url.path:
            return
        target = self.page.parent / unquote(url.path)
        if not target.is_file():
            raise SystemExit(f'Missing asset: {self.page.relative_to(ROOT)} → {value}')


def main():
    page = ROOT / 'index.html'
    AssetParser(page).feed(page.read_text())
    scripts = sorted(ROOT.glob('assets/**/*.js'))
    for script in scripts:
        subprocess.run(['node', '--check', str(script)], check=True)
    print(f'Passed: index.html, {len(scripts)} JavaScript files.')


if __name__ == '__main__':
    main()
