#!/usr/bin/env python3
"""Verify the export contains only the allowlisted application inputs, never CSVs."""
from pathlib import Path
import hashlib, json
root = Path(__file__).resolve().parent
manifest = json.loads((root/'source-manifest.json').read_text())
files = json.loads((root/'site/app.json').read_text())
assert {x['name'] for x in files} == set(manifest), 'Export file list differs from allowlist'
for item in files:
    name = item['name']
    assert name.endswith(('.R','.css','.js')), f'Unexpected exported input: {name}'
    assert hashlib.sha256(item['content'].encode()).hexdigest() == manifest[name], f'Unexpected content: {name}'
assert not list((root/'site').rglob('*.csv')), 'CSV found in site output'
for p in (root/'site').rglob('*'):
    if p.is_file(): assert p.stat().st_size < 100 * 1024**2, f'File too large for normal GitHub storage: {p}'
print(f'PASS: {len(files)} allowlisted app inputs; no CSV files in published site.')
