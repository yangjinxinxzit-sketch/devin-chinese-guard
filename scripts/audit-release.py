"""Check publishable source and the VSIX without printing possible sensitive matches."""
from pathlib import Path
import json
import re
import subprocess
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
if (root / '.git').exists():
    files = [root / x for x in subprocess.check_output(['git', 'ls-files'], cwd=root, text=True).splitlines()]
else:
    files = [p for p in root.rglob('*') if p.is_file() and not any(x in p.relative_to(root).parts for x in ['node_modules', 'dist', '.git'])]
patterns = {
    'personal-home-path': re.compile(re.escape(str(Path.home()).encode())),
    'github-token': re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})'),
    'private-key': re.compile(rb'-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----'),
    'credential-url': re.compile(rb'https?://[^\s/\"\']+:[^\s/\"\']+@'),
}
if '--forbid-stdin' in sys.argv:
    for index, term in enumerate(json.load(sys.stdin)):
        if term:
            patterns[f'forbidden-term-{index}'] = re.compile(re.escape(term.encode()), re.I)
failures = []
for file in files:
    data = file.read_bytes()
    for label, pattern in patterns.items():
        if pattern.search(data):
            failures.append({'path': str(file.relative_to(root)), 'check': label})
for vsix in (root / 'dist').glob('*.vsix'):
    with zipfile.ZipFile(vsix) as archive:
        names = archive.namelist()
        for name in names:
            if any(x in name.split('/') for x in ['.git', 'test', 'tests', 'backups', 'versions', 'caches']) or name.endswith('english-catalogs.json') or '/.env' in name:
                failures.append({'path': name, 'check': 'unexpected-vsix-file'})
            for label, pattern in patterns.items():
                if pattern.search(archive.read(name)):
                    failures.append({'path': name, 'check': label})
result = {'passed': not failures, 'sourceFilesChecked': len(files), 'vsixFilesChecked': len(list((root / 'dist').glob('*.vsix'))), 'failures': failures}
print(json.dumps(result, ensure_ascii=False, indent=2))
sys.exit(bool(failures))
