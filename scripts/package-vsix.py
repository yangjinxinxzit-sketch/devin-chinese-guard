from pathlib import Path
from xml.sax.saxutils import escape
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[1]
package = json.loads((root / 'package.json').read_text())
version = package['version']
output = root / 'dist'
output.mkdir(exist_ok=True)
destination = output / f"{package['name']}-{version}.vsix"
manifest = f'''<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011"><Metadata><Identity Language="zh-CN" Id="{package['name']}" Version="{version}" Publisher="{package['publisher']}"/><DisplayName>{escape(package['displayName'])}</DisplayName><Description xml:space="preserve">{escape(package['description'])}</Description><Tags>devin,chinese,localization</Tags><Categories>Other</Categories><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="{escape(package['engines']['vscode'])}"/><Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code" Version="[1.100.0,)"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE" Addressable="true"/><Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/></Assets></PackageManifest>'''
content = '''<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="js" ContentType="application/javascript"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="xml" ContentType="text/xml"/><Default Extension="vsixmanifest" ContentType="text/xml"/><Default Extension="md" ContentType="text/plain"/></Types>'''
files = [root / n for n in ['package.json', 'engine.cjs', 'extension.cjs', 'LICENSE', 'NOTICE', 'THIRD_PARTY_LICENSE', 'README.md']]
files += sorted((root / 'lib').glob('*.cjs')) + sorted((root / 'lib').glob('*.js'))
files += [root / 'data' / n for n in ['chinese-catalogs.json', 'english-hashes.json', 'dictionary.json', 'native.i18n.json']]
files += [root / 'node_modules/acorn' / n for n in ['package.json', 'LICENSE', 'dist/acorn.js']]
for file in files:
    if not file.is_file() or not file.resolve().is_relative_to(root):
        raise SystemExit(f'Missing or unsafe package input: {file.relative_to(root)}')
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    def add(name, data):
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    add('extension.vsixmanifest', manifest)
    add('[Content_Types].xml', content)
    for file in files:
        add('extension/' + str(file.relative_to(root)), file.read_bytes())
digest = hashlib.sha256(destination.read_bytes()).hexdigest()
(output / 'SHA256SUMS').write_text(f'{digest}  {destination.name}\n')
print(json.dumps({'vsix': str(destination), 'sha256': digest, 'files': len(files)}, ensure_ascii=False))
