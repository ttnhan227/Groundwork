import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function setReleaseVersion(root, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Use a numeric version tag such as v1.0.0');
  const version = tag.slice(1);
  
  // 1. Update server/app/core/config.py
  const config = path.join(root, 'server/app/core/config.py');
  if (fs.existsSync(config)) {
    const text = fs.readFileSync(config, 'utf8');
    if (!/app_version: str = "[^"]+"/.test(text)) throw new Error('Core version declaration changed');
    fs.writeFileSync(config, text.replace(/app_version: str = "[^"]+"/, `app_version: str = "${version}"`));
  }

  // 2. Update C# project versions
  const csprojFiles = [
    'desktop-winui/src/Groundwork.Desktop/Groundwork.Desktop.csproj',
    'desktop-winui/src/Groundwork.Engine/Groundwork.Engine.csproj'
  ];
  for (const rel of csprojFiles) {
    const file = path.join(root, rel);
    if (fs.existsSync(file)) {
      const xml = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(file, xml.replace(/<Version>[^<]+<\/Version>/, `<Version>${version}</Version>`));
    }
  }

  // 3. Update desktop/package.json if present
  const pkgFile = path.join(root, 'desktop/package.json');
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.version = version;
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
  }

  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  console.log(setReleaseVersion(root, process.argv[2] || ''));
}
