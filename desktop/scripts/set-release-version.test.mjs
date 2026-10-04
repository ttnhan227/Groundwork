import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {setReleaseVersion} from './set-release-version.mjs';

test('installer, native package, npm lock and backend all receive the release tag version', () => {
  const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'groundwork-version-test-'));
  const files=['desktop/package.json','desktop/package-lock.json','desktop/src-tauri/tauri.conf.json','desktop/src-tauri/Cargo.toml','server/app/core/config.py'];
  try {
    for(const relative of files) {const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,relative),target);}
    assert.equal(setReleaseVersion(root,'v1.2.3'),'1.2.3');
    for(const relative of files.slice(0,3)) assert.equal(JSON.parse(fs.readFileSync(path.join(root,relative),'utf8')).version,'1.2.3');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,files[1]),'utf8')).packages[''].version,'1.2.3');
    assert.match(fs.readFileSync(path.join(root,files[3]),'utf8'),/version = "1.2.3"/);
    assert.match(fs.readFileSync(path.join(root,files[4]),'utf8'),/app_version: str = "1.2.3"/);
    assert.throws(()=>setReleaseVersion(root,'v1.2.3-beta'),/stable/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
