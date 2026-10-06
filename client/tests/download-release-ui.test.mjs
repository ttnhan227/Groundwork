import test from 'node:test';
import {spawn} from 'node:child_process';
import {chromium, expect} from '@playwright/test';
import fs from 'node:fs';

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
    fs.mkdirSync('test-results',{recursive:true});
    await page.setViewportSize({width:1280,height:900});
    await page.goto('http://127.0.0.1:18556');
    await expect(page.getByRole('heading',{name:/Explore your files\. Ask your AI/})).toBeVisible();
    await page.screenshot({path:'test-results/polished-website.png',fullPage:true});
    await page.getByRole('button',{name:'See how to get started',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Start here',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'Sign in, or continue locally',exact:true})).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'Open menu',exact:true}).click();
    await page.getByRole('navigation',{name:'Mobile navigation'}).getByRole('button',{name:'Overview'}).click();
    await expect(page.getByRole('button',{name:'Open menu',exact:true})).toBeVisible();
    await page.screenshot({path:'test-results/polished-website-mobile.png',fullPage:true});
    await page.setViewportSize({width:1280,height:900});
    let status=200;
    let version='v1.2.3';
    await page.route('https://api.github.com/repos/ttnhan227/Groundwork/releases?per_page=100',route=>route.fulfill({status,contentType:'application/json',body:JSON.stringify([{draft:false,prerelease:false,tag_name:version,assets:[{name:'Groundwork-windows-x64-setup.exe',state:'uploaded',size:104857600,digest:'sha256:'+'a'.repeat(64),browser_download_url:`https://github.com/ttnhan227/Groundwork/releases/download/${version}/Groundwork-windows-x64-setup.exe`}]}])}));
    await page.goto('http://127.0.0.1:18556/download');
    await expect(page.getByText('Latest release: v1.2.3 · 100.0 MB')).toBeVisible();
    await expect(page.getByRole('link',{name:'Download installer',exact:true})).toHaveAttribute('href',/\/v1\.2\.3\//);
    await expect(page.getByText('SHA-256: '+'a'.repeat(64))).not.toBeVisible();
    await page.getByText('Previous versions and file verification',{exact:true}).click();
    await expect(page.getByText('SHA-256: '+'a'.repeat(64))).toBeVisible();
    version='v1.2.4';
    await page.reload();
    await expect(page.getByText('Latest release: v1.2.4 · 100.0 MB')).toBeVisible();
    await expect(page.getByRole('link',{name:'Download installer',exact:true})).toHaveAttribute('href',/\/v1\.2\.4\//);
    version='v0.1.0';
    await page.reload();
    await expect(page.getByText('Preview: v0.1.0 · 100.0 MB')).toBeVisible();
    await expect(page.getByText('Groundwork is still in development.',{exact:false})).toBeVisible();
    status=404;
    await page.reload();
    await expect(page.getByText('A Windows installer has not been published yet.',{exact:false})).toBeVisible();
    await expect(page.getByRole('button',{name:'Installer not available',exact:true})).toBeDisabled();
    status=403;
    await page.reload();
    await expect(page.getByText('Unable to check the latest version right now.',{exact:false})).toBeVisible();
    await page.getByText('Previous versions and file verification',{exact:true}).click();
    await expect(page.getByRole('link',{name:'All releases and checksums'})).toHaveAttribute('href','https://github.com/ttnhan227/Groundwork/releases');
  } finally {if(browser)await browser.close();server.kill();}
});
