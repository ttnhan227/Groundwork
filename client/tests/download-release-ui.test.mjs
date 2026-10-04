import test from 'node:test';
import {spawn} from 'node:child_process';
import {chromium, expect} from '@playwright/test';

test('download page picks up newer releases without rebuilding and handles missing releases/outages', async () => {
  const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','18556','--strictPort'],{cwd:process.cwd(),windowsHide:true,stdio:'pipe'});
  let browser;
  try {
    for(let attempt=0;attempt<100;attempt++) {
      if(server.exitCode!==null)throw new Error('Preview server exited');
      try {await fetch('http://127.0.0.1:18556');break;} catch {await new Promise(resolve=>setTimeout(resolve,100));}
    }
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage();
    let status=200;
    let version='v1.2.3';
    await page.route('https://api.github.com/repos/ttnhan227/Groundwork/releases/latest',route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({draft:false,prerelease:false,tag_name:version,assets:[{name:'Groundwork-windows-x64-setup.exe',state:'uploaded',size:104857600,digest:'sha256:'+'a'.repeat(64),browser_download_url:`https://github.com/ttnhan227/Groundwork/releases/download/${version}/Groundwork-windows-x64-setup.exe`}]})}));
    await page.goto('http://127.0.0.1:18556/download');
    await expect(page.getByText('Latest stable release: v1.2.3 · 100.0 MB')).toBeVisible();
    await expect(page.getByRole('link',{name:'Download installer',exact:true})).toHaveAttribute('href',/\/v1\.2\.3\//);
    await expect(page.getByText('SHA-256: '+'a'.repeat(64))).toBeVisible();
    version='v1.2.4';
    await page.reload();
    await expect(page.getByText('Latest stable release: v1.2.4 · 100.0 MB')).toBeVisible();
    await expect(page.getByRole('link',{name:'Download installer',exact:true})).toHaveAttribute('href',/\/v1\.2\.4\//);
    status=404;
    await page.reload();
    await expect(page.getByText('A Windows installer has not been published yet.',{exact:false})).toBeVisible();
    await expect(page.getByRole('button',{name:'Installer not available',exact:true})).toBeDisabled();
    status=403;
    await page.reload();
    await expect(page.getByText('Unable to check the latest version right now.',{exact:false})).toBeVisible();
    await expect(page.getByRole('link',{name:'All releases and checksums'})).toHaveAttribute('href','https://github.com/ttnhan227/Groundwork/releases');
  } finally {if(browser)await browser.close();server.kill();}
});
