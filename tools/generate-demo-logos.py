"""Create original logo assets for the fictional Connect marketplace demo companies."""
from pathlib import Path
import html
import re

source = Path('apps/api/src/seed-marketplace.ts').read_text()
names = re.findall(r'\[\s*"([^"]+)",\s*"(?:Installer|Contractor|EPC|Service provider)"', source)
assert len(names) == 20, f'Expected 20 demo companies, found {len(names)}'
out = Path('apps/web/public/assets/demo-logos')
out.mkdir(parents=True, exist_ok=True)
colors = [
    ('#E86320','#FEF0E7'), ('#236AA0','#EAF4FC'), ('#204E83','#EAF0F8'),
    ('#A46A2B','#FBF3E8'), ('#845732','#F5EEE7'), ('#177B93','#E8F6F7'),
    ('#BD612B','#FCF0E8'), ('#376B72','#ECF6F4'), ('#308D9A','#E7F5F7'),
    ('#5C824B','#F0F6EB'), ('#42599A','#EEF0FA'), ('#167BA8','#E8F6FC'),
    ('#AC5340','#FBEEEB'), ('#D18336','#FCF2E7'), ('#326B9A','#EDF4FB'),
    ('#2B795F','#EAF5EF'), ('#E16B29','#FEF0E6'), ('#37918E','#E9F6F3'),
    ('#6D668D','#F1F0F8'), ('#247FAD','#EAF5FB'),
]
# Each mark is an original, company-specific vector pictogram in a 48x48 tile.
marks = [
    '<path d="M6 34 17 20l7 8 8-13 11 19H6Z"/><circle cx="35" cy="10" r="4" fill="white" stroke="none"/>',
    '<path d="M5 31c8-13 13-3 21-17 6 13 12 8 17 17M5 38c9-8 17-3 25-9 5 2 9 4 13 9"/>',
    '<path d="M9 38V11h30v27M8 23h32M16 11v27M31 11v27"/><path d="m22 19-4 9h5l-3 8 10-12h-6l3-5" fill="white" stroke="none"/>',
    '<path d="m4 31 13-17 11 14 6-9 10 15M4 39h40M12 34h24"/>',
    '<path d="M5 26 24 10l19 16M9 25v14h30V25M13 31h22M17 35h14"/>',
    '<path d="M4 27c7-8 13-8 20 0s13 8 20 0M4 36c7-8 13-8 20 0s13 8 20 0"/><circle cx="24" cy="13" r="6"/>',
    '<path d="m7 10 34 0-4 27H11L7 10ZM10 20h28M13 29h22M22 10l-5 27M30 10l4 27"/>',
    '<path d="M7 38V13h12v25M29 38V10h12v28M19 21h10M19 30h10"/><circle cx="24" cy="13" r="3" fill="white" stroke="none"/>',
    '<circle cx="24" cy="24" r="10"/><path d="M24 4v7M24 37v7M4 24h7M37 24h7M10 10l5 5M33 33l5 5M38 10l-5 5M15 33l-5 5"/>',
    '<path d="M4 35c10-4 17-4 26-1 5 2 10 2 14 0M4 27c10-4 17-4 26-1 5 2 10 2 14 0M6 19h36"/><circle cx="36" cy="12" r="4"/>',
    '<path d="M5 38 19 15l7 12 5-8 12 19H5Z"/><path d="m25 12-5 12h7l-4 10 12-15h-8l4-7"/>',
    '<circle cx="24" cy="16" r="8"/><path d="M6 33c6-6 12-6 18 0s12 6 18 0M7 40h34"/>',
    '<path d="M5 19 24 9l19 10-19 10L5 19ZM10 27l14 8 14-8M12 35l12 6 12-6"/>',
    '<circle cx="29" cy="16" r="8"/><path d="M5 38c5-11 12-13 20-8 6-8 11-6 18 8M8 38h34"/>',
    '<path d="M4 27c8-7 15-7 20 0s12 7 20 0M4 36c8-7 15-7 20 0s12 7 20 0"/><path d="M24 10v10M18 15h12"/>',
    '<path d="M6 27 24 12l18 15M10 25v14h28V25M24 6v15M19 12l5-6 5 6"/>',
    '<circle cx="11" cy="34" r="4"/><circle cx="36" cy="12" r="4"/><path d="M14 32c6-2 6-14 13-16 3-1 5-1 7-2M14 35h27"/>',
    '<path d="M23 39V10M23 17c-8-8-14-6-17 0M23 22c7-8 13-7 18-1M23 29c-7-6-13-5-16 1M23 33c8-6 14-4 18 1"/>',
    '<path d="M4 30c8-10 13-10 20 0s12 10 20 0M4 39c8-10 13-10 20 0s12 10 20 0"/><circle cx="9" cy="12" r="4"/>',
    '<path d="m7 14 9 22 8-17 8 17 9-22M7 40h34"/><circle cx="24" cy="8" r="3" fill="white" stroke="none"/>',
]
for i,name in enumerate(names):
    slug = 'demo-' + re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
    fg,bg = colors[i]
    parts=name.split()
    line1=' '.join(parts[:2]); line2=' '.join(parts[2:])
    fs=19 if len(line1)<15 else 16
    second=f'<text x="65" y="49" font-size="14" font-weight="650" fill="{fg}">{html.escape(line2)}</text>' if line2 else ''
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" width="270" height="72" viewBox="0 0 270 72" role="img" aria-label="{html.escape(name)}"><rect x="4" y="10" width="48" height="48" rx="13" fill="{bg}"/><g transform="translate(4 10)" fill="none" stroke="{fg}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">{marks[i]}</g><text x="65" y="31" font-family="Arial,Helvetica,sans-serif" font-size="{fs}" font-weight="750" letter-spacing="-.5" fill="#173149">{html.escape(line1)}</text>{second}</svg>'''
    (out/(slug+'.svg')).write_text(svg)
print(f'Generated {len(names)} original demo logo assets')
