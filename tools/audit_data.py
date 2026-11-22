"""Fail unless dist/data contains exactly the files data/manifest.json lists, each with the recorded SHA-256.
Also refuses any CSV elsewhere under dist/. Run before every publish:  python3 tools/audit_data.py"""
import hashlib, json, sys
from pathlib import Path

dist = Path(__file__).resolve().parents[1] / 'dist'
data = dist / 'data'
m = json.loads((data / 'manifest.json').read_text())
if m.get('manifest_version') != 1:
    sys.exit('manifest_version must be 1')
listed = {d['file']: d['sha256'] for d in m.get('datasets', [])} | {g: None for g in m.get('glossary', [])}
problems = []
for name, sha in listed.items():
    f = data / name
    if not f.is_file(): problems.append(f'missing: {name}'); continue
    if sha and hashlib.sha256(f.read_bytes()).hexdigest() != sha: problems.append(f'hash differs: {name}')
for f in dist.rglob('*.csv'):
    if f.parent != data or f.name not in listed: problems.append(f'unlisted CSV in site: {f.relative_to(dist)}')
if problems: sys.exit('AUDIT FAILED\n  ' + '\n  '.join(problems))
print(f'audit ok: {len(listed)} listed file(s), no unlisted CSV')
