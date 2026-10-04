import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function setReleaseVersion(root, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Use a stable version tag such as v1.0.1');
  const version = tag.slice(1);
  for (const relative of ['desktop/package.json', 'desktop/package-lock.json', 'desktop/src-tauri/tauri.conf.json']) {
    const filename = path.join(root, relative);
    const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
    value.version = version;
    if (value.packages?.['']) value.packages[''].version = version;
    fs.writeFileSync(filename, JSON.stringify(value, null, 2) + '\n');
  }
  const cargo = path.join(root, 'desktop/src-tauri/Cargo.toml');
  fs.writeFileSync(cargo, fs.readFileSync(cargo, 'utf8').replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${version}"`));
  const config = path.join(root, 'server/app/core/config.py');
  const text = fs.readFileSync(config, 'utf8');
  if (!/app_version: str = "[^"]+"/.test(text)) throw new Error('Core version declaration changed');
  fs.writeFileSync(config, text.replace(/app_version: str = "[^"]+"/, `app_version: str = "${version}"`));
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  console.log(setReleaseVersion(root, process.argv[2] || ''));
}
