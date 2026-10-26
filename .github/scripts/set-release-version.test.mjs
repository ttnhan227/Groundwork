import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {setReleaseVersion} from './set-release-version.mjs';

test('native projects receive the release tag version', () => {
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-version-test-'));
  const files = [
    'desktop-winui/src/Groundwork.Desktop/Groundwork.Desktop.csproj',
    'desktop-winui/src/Groundwork.Engine/Groundwork.Engine.csproj',
    'desktop-winui/installer/Groundwork.iss'
  ];
  try {
    for (const relative of files) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), {recursive: true});
      fs.copyFileSync(path.join(source, relative), target);
    }
    assert.equal(setReleaseVersion(root, 'v1.2.3'), '1.2.3');
    assert.match(fs.readFileSync(path.join(root, files[0]), 'utf8'), /<Version>1\.2\.3<\/Version>/);
    assert.match(fs.readFileSync(path.join(root, files[1]), 'utf8'), /<Version>1\.2\.3<\/Version>/);
    assert.match(fs.readFileSync(path.join(root, files[2]), 'utf8'), /#define MyAppVersion "1\.2\.3"/);
    assert.throws(() => setReleaseVersion(root, 'v1.2.3-beta'), /numeric/);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
