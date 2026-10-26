import assert from 'node:assert/strict';
import test from 'node:test';
import {parseWindowsRelease, fetchWindowsRelease} from '../src/services/releases.ts';

const fixture = () => ({draft:false, prerelease:false, tag_name:'v1.2.3', assets:[{name:'Groundwork-v1.2.3-windows-x64-setup.exe',state:'uploaded',size:123456,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/ttnhan227/Groundwork/releases/download/v1.2.3/Groundwork-v1.2.3-windows-x64-setup.exe'}]});

test('uses the published asset version, exact URL, size and digest', () => {
  assert.deepEqual(parseWindowsRelease(fixture()), {version:'v1.2.3', url:fixture().assets[0].browser_download_url, bytes:123456, checksum:'a'.repeat(64), preview:false, filename:'Groundwork-v1.2.3-windows-x64-setup.exe'});
});

test('matches Groundwork 1.0 exact release asset and extracts metadata', async (context) => {
  const v1Release = {
    draft: false,
    prerelease: false,
    tag_name: 'v1.0.0',
    assets: [
      {
        name: 'Groundwork-v1.0.0-windows-x64.zip',
        state: 'uploaded',
        size: 295729570,
        digest: 'sha256:59b2738a5d47777f85c614bbb64c58b18d16561acc3a15e557cbd9e0d41e8a03',
        browser_download_url: 'https://github.com/ttnhan227/Groundwork/releases/download/v1.0.0/Groundwork-v1.0.0-windows-x64.zip'
      }
    ]
  };
  const parsed = parseWindowsRelease(v1Release);
  assert.ok(parsed);
  assert.equal(parsed.version, 'v1.0.0');
  assert.equal(parsed.url, 'https://github.com/ttnhan227/Groundwork/releases/download/v1.0.0/Groundwork-v1.0.0-windows-x64.zip');
  assert.equal(parsed.bytes, 295729570);
  assert.equal(parsed.checksum, '59b2738a5d47777f85c614bbb64c58b18d16561acc3a15e557cbd9e0d41e8a03');
  assert.equal(parsed.filename, 'Groundwork-v1.0.0-windows-x64.zip');
  assert.equal(parsed.preview, false);

  context.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify([v1Release]), { status: 200 }));
  const fetched = await fetchWindowsRelease(new AbortController().signal);
  assert.ok(fetched);
  assert.equal(fetched.version, 'v1.0.0');
  assert.equal(fetched.filename, 'Groundwork-v1.0.0-windows-x64.zip');
  assert.equal(fetched.checksum, '59b2738a5d47777f85c614bbb64c58b18d16561acc3a15e557cbd9e0d41e8a03');
});

test('detects portable zip release packages and prioritizes installers when both exist', () => {
  const zipRelease = {
    draft: false,
    prerelease: false,
    tag_name: 'v1.0.0',
    assets: [
      {
        name: 'Groundwork-v1.0.0-windows-x64.zip',
        state: 'uploaded',
        size: 987654,
        digest: 'sha256:' + 'b'.repeat(64),
        browser_download_url: 'https://github.com/ttnhan227/Groundwork/releases/download/v1.0.0/Groundwork-v1.0.0-windows-x64.zip'
      }
    ]
  };
  const parsedZip = parseWindowsRelease(zipRelease);
  assert.ok(parsedZip);
  assert.equal(parsedZip.version, 'v1.0.0');
  assert.equal(parsedZip.filename, 'Groundwork-v1.0.0-windows-x64.zip');

  // Both zip and exe present -> exe is prioritized
  const dualRelease = {
    ...zipRelease,
    assets: [
      zipRelease.assets[0],
      {
        name: 'Groundwork-v1.2.3-windows-x64-setup.exe',
        state: 'uploaded',
        size: 123456,
        digest: 'sha256:' + 'c'.repeat(64),
        browser_download_url: 'https://github.com/ttnhan227/Groundwork/releases/download/v1.0.0/Groundwork-v1.2.3-windows-x64-setup.exe'
      }
    ]
  };
  const parsedDual = parseWindowsRelease(dualRelease);
  assert.ok(parsedDual);
  assert.equal(parsedDual.filename, 'Groundwork-v1.2.3-windows-x64-setup.exe');
});

test('never offers draft, incomplete, or untrusted assets', () => {
  for (const change of [{draft:true}, {assets:[]}, {assets:[{...fixture().assets[0],state:'new'}]}, {assets:[{...fixture().assets[0],browser_download_url:'javascript:alert(1)'}]}, {assets:[{...fixture().assets[0],browser_download_url:'bad-url'}]}, {assets:[{...fixture().assets[0],browser_download_url:'https://github.com/another/repo/releases/download/v1/x.exe'}]}]) {
    assert.equal(parseWindowsRelease({...fixture(),...change}), null);
  }
});

test('does not invent a checksum when GitHub does not provide one', () => {
  const release=fixture(); release.assets[0].digest=null;
  assert.equal(parseWindowsRelease(release).checksum,null);
});

test('queries latest at runtime and treats unpublished releases differently from outages', async (context) => {
  const fetch=context.mock.method(globalThis,'fetch',async ()=>new Response(JSON.stringify([fixture()]),{status:200}));
  assert.equal((await fetchWindowsRelease(new AbortController().signal)).version,'v1.2.3');
  assert.equal(fetch.mock.calls[0].arguments[0],'https://api.github.com/repos/ttnhan227/Groundwork/releases?per_page=100');
  assert.equal(fetch.mock.calls[0].arguments[1].cache,'no-store');
  fetch.mock.mockImplementation(async ()=>new Response('',{status:404}));
  assert.equal(await fetchWindowsRelease(new AbortController().signal),null);
  fetch.mock.mockImplementation(async ()=>new Response('',{status:503}));
  await assert.rejects(fetchWindowsRelease(new AbortController().signal),/unavailable/);
});

test('offers published previews honestly and sorts versions numerically', async (context) => {
  const preview={...fixture(),tag_name:'v0.1.0',prerelease:true};
  assert.equal(parseWindowsRelease(preview).preview,true);
  context.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify([{...preview,tag_name:'v0.1.9'},{...preview,tag_name:'v0.1.10'},{...fixture(),draft:true}])));
  assert.equal((await fetchWindowsRelease(new AbortController().signal)).version,'v0.1.10');
});
