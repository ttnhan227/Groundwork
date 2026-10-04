import assert from 'node:assert/strict';
import test from 'node:test';
import {parseWindowsRelease, fetchWindowsRelease} from '../src/services/releases.ts';

const fixture = () => ({draft:false, prerelease:false, tag_name:'v1.2.3', assets:[{name:'Groundwork-windows-x64-setup.exe',state:'uploaded',size:123456,digest:'sha256:'+'a'.repeat(64),browser_download_url:'https://github.com/ttnhan227/Groundwork/releases/download/v1.2.3/Groundwork-windows-x64-setup.exe'}]});

test('uses the published asset version, exact URL, size and digest', () => {
  assert.deepEqual(parseWindowsRelease(fixture()), {version:'v1.2.3', url:fixture().assets[0].browser_download_url, bytes:123456, checksum:'a'.repeat(64), preview:false});
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
