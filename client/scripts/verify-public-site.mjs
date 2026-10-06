import {chromium, expect} from '@playwright/test';
import {fetchWindowsRelease} from '../src/services/releases.ts';

const release = await fetchWindowsRelease(AbortSignal.timeout(15000));
if (!release) throw new Error('No publicly available Windows installer');
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage();
  await page.goto('https://groundwork-client.onrender.com/');
  await expect(page.getByRole('button', {name:'Download', exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Download', exact:true}).click();
  await expect(page.getByRole('link', {name:'Download installer', exact:true})).toHaveAttribute('href', release.url);
  await expect(page.getByText(new RegExp(release.version.replaceAll('.', '\\.') + ' ·'))).toBeVisible();
  if (release.checksum) {
    await page.getByText('Previous versions and file verification', {exact:true}).click();
    await expect(page.getByText('SHA-256: ' + release.checksum, {exact:true})).toBeVisible();
  }
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('link', {name:'Download installer', exact:true})).toBeVisible();
  console.log('Public website verified: ' + release.version);
} finally {
  await browser.close();
}
