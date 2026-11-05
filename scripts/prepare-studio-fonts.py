"""Download pinned OFL fonts and precompute metadata; no parsing at runtime."""
import hashlib, io, json, pathlib, urllib.request
from fontTools.ttLib import TTFont
root = pathlib.Path(__file__).resolve().parents[1]
folder = root / 'public/fonts/studio'
folder.mkdir(parents=True, exist_ok=True)
manifest_path = root / 'src/app/lib/studio-fonts.json'
previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
revision = previous[0]['revision'] if previous else json.load(urllib.request.urlopen('https://api.github.com/repos/google/fonts/commits/main'))['sha']
result = []
for slug, name in [('inter', 'Inter'), ('sourceserif4', 'Source Serif 4'), ('jetbrainsmono', 'JetBrains Mono'), ('notosansdevanagari', 'Noto Sans Devanagari'), ('notoserifdevanagari', 'Noto Serif Devanagari')]:
    base = f'https://raw.githubusercontent.com/google/fonts/{revision}/ofl/{slug}/'
    entries = json.load(urllib.request.urlopen(f'https://api.github.com/repos/google/fonts/contents/ofl/{slug}?ref={revision}'))
    font_name = next(e['name'] for e in entries if e['name'].endswith('.ttf') and 'Italic' not in e['name'])
    licence = urllib.request.urlopen(base + 'OFL.txt').read()
    assert b'SIL OPEN FONT LICENSE' in licence
    (folder / f'{slug}-OFL.txt').write_bytes(licence)
    data = urllib.request.urlopen(base + urllib.parse.quote(font_name)).read()
    font = TTFont(io.BytesIO(data))
    font.flavor = 'woff2'; output = folder / f'{slug}.woff2'; font.save(output)
    os2 = font['OS/2']; upm = font['head'].unitsPerEm
    axes = {a.axisTag: [a.minValue, a.maxValue] for a in font['fvar'].axes}
    cmap = font.getBestCmap()
    result.append({'id': slug, 'family': name, 'revision': revision, 'source': base + urllib.parse.quote(font_name), 'sourceSha256': hashlib.sha256(data).hexdigest(), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'url': f'/fonts/studio/{slug}.woff2', 'license': 'OFL-1.1', 'licenseUrl': f'/fonts/studio/{slug}-OFL.txt', 'weights': axes['wght'], 'axes': axes, 'xHeightEm': round(os2.sxHeight / upm, 4) if hasattr(os2, 'sxHeight') else None, 'capHeightEm': round(os2.sCapHeight / upm, 4) if hasattr(os2, 'sCapHeight') else None, 'scripts': ['Latin', 'Devanagari'] if all(code in cmap for code in [0x0915, 0x093E, 0x0928]) else ['Latin']})
manifest_path.write_text(json.dumps(result, indent=2) + '\n')
print(f'Prepared {len(result)} font families at google/fonts@{revision}')
