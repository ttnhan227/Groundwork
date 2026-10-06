/* Exercise an installed release in its real WebView2, with no developer PATH. */
const {chromium, expect} = require('../../client/node_modules/@playwright/test');
const {spawn, spawnSync, execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');
const crypto = require('node:crypto');
if (!process.argv[2]) throw new Error('Pass the NSIS installer path');
const upgradeFrom = process.env.GROUNDWORK_UPGRADE_FROM ? path.resolve(process.env.GROUNDWORK_UPGRADE_FROM) : null;
const portable = process.argv[2] === '--portable';
const installer = portable ? null : path.resolve(process.argv[2]);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-installed-')));
const installDir = portable ? path.resolve(__dirname,'../src-tauri/target/release') : path.join(root, 'application');
const resultsDir = path.resolve(__dirname, '../test-results');
fs.mkdirSync(resultsDir, {recursive:true});
const workspace = path.join(root, 'workspace');
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({name:'installed-workflow', dependencies:{react:'19'}}));
fs.writeFileSync(path.join(workspace, 'sample.ts'), 'export function installed_workflow_needle() { return "real evidence"; }\n');
for (const args of [['init'],['config','user.name','Installer Test'],['config','user.email','installer@example.com'],['add','.'],['commit','-m','Initialize installed workflow']]) execFileSync('git',args,{cwd:workspace,stdio:'ignore'});
const env = {...process.env, PATH:'', GROUNDWORK_DATA_DIR:path.join(root,'state'), WEBVIEW2_USER_DATA_FOLDER:path.join(root,'webview'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=18540 --remote-debugging-address=127.0.0.1'};
let app, browser, page, connection;
// Microsoft WebView2 150+ drops environment overrides in elevated hosts.
// Only the ephemeral hosted-CI wrapper opts into a per-executable HKLM policy.
const useCiPolicy = process.env.GROUNDWORK_CI_WEBVIEW_POLICY === '1';
const policyKey = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Edge\\WebView2\\AdditionalBrowserArguments';
let previousPolicy;
function setCiPolicy(argumentsValue) {
  if (!useCiPolicy) return;
  const policyScript = `$ErrorActionPreference='Stop'; $key='${policyKey}'; $name='groundwork-desktop.exe'; New-Item -Path $key -Force | Out-Null; $existing=Get-ItemProperty -LiteralPath $key -Name $name -ErrorAction SilentlyContinue; if($existing){$existing.$name}; Set-ItemProperty -LiteralPath $key -Name $name -Value '${argumentsValue}'`;
  const value=execFileSync('powershell.exe',['-NoProfile','-Command',policyScript],{encoding:'utf8'}).trim();
  if(previousPolicy===undefined) previousPolicy=value;
}
function restoreCiPolicy() {
  if(!useCiPolicy || previousPolicy===undefined) return;
  const script=previousPolicy ? `Set-ItemProperty -LiteralPath '${policyKey}' -Name 'groundwork-desktop.exe' -Value '${previousPolicy.replace(/'/g,"''")}'` : `Remove-ItemProperty -LiteralPath '${policyKey}' -Name 'groundwork-desktop.exe' -ErrorAction SilentlyContinue`;
  execFileSync('powershell.exe',['-NoProfile','-Command',script]);
}
async function launch() {
  const listener=net.createServer();
  await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
  const debugPort=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=`--remote-debugging-port=${debugPort} --remote-debugging-address=127.0.0.1`;
  setCiPolicy(env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS);
  app = spawn(path.join(installDir,'groundwork-desktop.exe'),[],{env,stdio:'ignore'});
  for(let attempt=0;attempt<100;attempt++) {
    try { browser=await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`); break; }
    catch {if(app.exitCode!==null)throw new Error('Installed application exited'); await new Promise(r=>setTimeout(r,200));}
  }
  if(!browser) {
    console.error(execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('groundwork-desktop.exe','msedgewebview2.exe') } | Select-Object Name,ProcessId,ParentProcessId,CommandLine | Format-List | Out-String`],{encoding:'utf8'}));
    throw new Error('WebView2 debugging endpoint unavailable');
  }
  // WebView2 can expose its CDP endpoint before creating the application page.
  for(let attempt=0;attempt<150;attempt++) {
    page=browser.contexts().flatMap(context=>context.pages())[0];
    if(page)break;
    if(app.exitCode!==null)throw new Error('Installed application exited before creating its window');
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!page)throw new Error('WebView2 application page did not become ready');
  page.on('console', message=>{if(message.type()==='error') console.error('WebView:',message.text());});
  page.on('requestfailed', request=>console.error('Request failed:',request.url(),request.failure()));
  await expect(page.getByRole('region',{name:'Files and storage workspace'})).toBeVisible({timeout:30000});
  connection=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('start_local_core'));
  console.log('Core endpoint', connection.url, 'WebView', await page.evaluate(()=>({origin:location.origin,isTauri:window.isTauri})));
  const preflight=await fetch(connection.url+'/api/system/status',{method:'OPTIONS',headers:{Origin:'http://tauri.localhost','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(preflight.headers.get('access-control-allow-origin'),'http://tauri.localhost','Installed runtime rejected its desktop origin');
  await expect.poll(async () => (await fetch(connection.url+'/health',{headers:{Authorization:'Bearer '+connection.token}})).status,{timeout:30000}).toBe(200);
  assert.match(connection.url,/^http:\/\/127\.0\.0\.1:\d+$/);
}
async function close() {
  if(app && app.exitCode===null) {
    // Single-instance handling also owns a hidden message window. Locate the
    // visible application window explicitly rather than relying on the cached
    // Process.MainWindowHandle heuristic after engine restarts.
    const closeScript=`Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class GroundworkSmokeWindow { public delegate bool EnumCallback(IntPtr window,IntPtr parameter); [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback,IntPtr parameter); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint process); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window); [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint message,IntPtr wParam,IntPtr lParam); public static int Close(uint owner) { int count=0; EnumWindows((w,p)=> { uint pid; GetWindowThreadProcessId(w,out pid); if(pid==owner && IsWindowVisible(w)) { if(PostMessage(w,16,IntPtr.Zero,IntPtr.Zero)) count++; } return true; },IntPtr.Zero); return count; } }'; $count=[GroundworkSmokeWindow]::Close(${app.pid}); if($count -eq 0) { Get-Process -Id ${app.pid} | Select-Object Id,MainWindowTitle,MainWindowHandle | Out-String | Write-Output; throw 'No visible test window found' }`;
    execFileSync('powershell.exe',['-NoProfile','-Command',closeScript]);
    for(let i=0;i<250 && app.exitCode===null;i++)await new Promise(r=>setTimeout(r,100));
    assert.notEqual(app.exitCode,null,'Native window did not shut down');
    if(connection) await assert.rejects(()=>fetch(connection.url+'/health',{headers:{Authorization:'Bearer '+connection.token}}));
  }
  browser=undefined;
}
(async()=>{
  if (!portable) {
    const registryCheck=String.raw`@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Groundwork','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Groundwork') | ForEach-Object { $item=Get-ItemProperty -LiteralPath $_ -ErrorAction SilentlyContinue; if($item.InstallLocation) { $item.InstallLocation } }`;
    const registered=execFileSync('powershell.exe',['-NoProfile','-Command',registryCheck],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
    for(const entry of registered) {
      const previous=entry.replace(/^"|"$/g,'');
      if(fs.existsSync(path.join(previous,'groundwork-desktop.exe'))) {
        const parent=path.relative(os.tmpdir(),previous);
        assert.ok(!parent.startsWith('..') && !path.isAbsolute(parent) && parent.startsWith('groundwork-installed-'),'Use a clean Windows account or --portable: an existing real Groundwork installation must not be changed by this test');
      }
    }
    const installed=spawnSync(upgradeFrom || installer,['/S',`/D=${installDir}`],{windowsHide:true,timeout:120000});
    assert.equal(installed.status,0,`Installer failed: ${installed.error || installed.status}`);
  }
  assert.ok(fs.existsSync(path.join(installDir,'groundwork-desktop.exe')),'Installed executable missing');
  if (!portable && !upgradeFrom) {
    const releaseBinary=path.resolve(__dirname,'../src-tauri/target/release/groundwork-desktop.exe');
    if(fs.existsSync(releaseBinary)) {
      // Tauri restores UNK in the build output after packaging its NSS-marked
      // installer executable. Normalize only that documented bundle marker.
      const digest=filename=>{
        const bytes=fs.readFileSync(filename);
        for(const kind of ['UNK','NSS']) {
          const marker=Buffer.from('__TAURI_BUNDLE_TYPE_VAR_'+kind);
          const offset=bytes.indexOf(marker);
          if(offset>=0) bytes.write('XXX',offset+marker.length-3,'ascii');
        }
        return crypto.createHash('sha256').update(bytes).digest('hex');
      };
      assert.equal(digest(path.join(installDir,'groundwork-desktop.exe')),digest(releaseBinary),'Installer contains a stale native executable');
    }
  }
  try {
    await launch();
    const second=spawn(path.join(installDir,'groundwork-desktop.exe'),[],{env,stdio:'ignore'});
    await expect.poll(() => second.exitCode,{timeout:15000}).toBe(0);
    assert.equal(app.exitCode,null,'Second launch closed the original application');
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**',route=>route.abort());
    // A fresh user can start locally without visiting Settings or reaching the internet.
    await page.evaluate(()=>localStorage.removeItem('groundwork-welcome-complete'));
    await page.reload();
    await expect(page.getByRole('dialog',{name:'Welcome to Groundwork'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Sign in with Google',exact:true})).toBeEnabled();
    await expect(page.getByLabel('Cloud server URL')).toHaveCount(0);
    await page.screenshot({path:path.join(resultsDir,'installed-welcome.png')});
    await page.getByRole('button',{name:'Continue locally',exact:true}).click();
    await page.reload();
    await expect(page.getByRole('region',{name:'Files and storage workspace'})).toBeVisible();
    await expect(page.getByRole('dialog',{name:'Welcome to Groundwork'})).toHaveCount(0);
    const preferences=await fetch(connection.url+'/api/system/preferences',{headers:{Authorization:'Bearer '+connection.token}});
    const cloudUrl=(await preferences.json()).cloud_sync_url;
    assert.ok(process.env.DESKTOP_API_BASE_URL,'Set DESKTOP_API_BASE_URL to verify the installed build configuration');
    assert.equal(cloudUrl,process.env.DESKTOP_API_BASE_URL.trim().replace(/\/$/,'').replace(/\/api\/v1$/,''));
    if (process.env.GROUNDWORK_VERIFY_GOOGLE_SIGNIN === '1') {
      await page.getByRole('button',{name:'Account',exact:true}).click();
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await page.getByRole('button',{name:'Sign in with Google',exact:true}).click();
      console.log('Complete Google sign-in in the system browser opened by Groundwork');
      await expect(page.getByRole('heading',{name:"You're signed in",exact:true})).toBeVisible({timeout:300000});
      await page.screenshot({path:path.join(resultsDir,'installed-google-signin.png')});
      await page.getByRole('button',{name:'Sign out',exact:true}).click();
      await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'Home',exact:true}).click();
      console.log('Installed system-browser Google sign-in and logout passed');
    }
    // Add the fixture through the real authenticated service. Native picker
    // interaction is a separate manual check; this does not mock indexing.
    const added=await fetch(connection.url+'/api/workspaces',{method:'POST',headers:{Authorization:'Bearer '+connection.token,'Content-Type':'application/json'},body:JSON.stringify({path:workspace,name:'Installed test'})});
    assert.equal(added.status,200);
    await page.reload();
    await expect(page.getByRole('combobox',{name:'Current location'})).toContainText('Installed test',{timeout:20000});
    await expect(page.getByText('sample.ts',{exact:true}).first()).toBeVisible({timeout:30000});
    await expect.poll(async () => {
      const response = await fetch(connection.url+'/api/index/status',{headers:{Authorization:'Bearer '+connection.token}});
      return (await response.json()).status;
    }, {timeout:60000}).toBe('completed');
    await page.screenshot({path:path.join(resultsDir,'installed-home.png')});
    await page.getByRole('button',{name:'Contents',exact:true}).click();
    await page.getByRole('button',{name:'File contents',exact:true}).click();
    await page.getByRole('textbox',{name:'Search your files'}).fill('installed_live_change');
    fs.writeFileSync(path.join(workspace,'live.txt'),'installed_live_change arrived while search was open');
    await expect(page.locator('[data-result-index="0"]')).toContainText('live.txt',{timeout:30000});
    await page.getByRole('textbox',{name:'Search your files'}).fill('installed_workflow_needle');
    await expect(page.locator('[data-result-index="0"]')).toContainText('sample.ts',{timeout:20000});
    await page.screenshot({path:path.join(resultsDir,'installed-search.png')});
    await page.getByRole('button',{name:'Ask about this file'}).click();
    await page.getByLabel('Answer with').selectOption('local');
    await page.getByLabel('Your question').fill('installed_workflow_needle');
    await page.locator('.desktop-tool-panel').getByRole('button',{name:'Ask',exact:true}).click();
    await expect(page.getByText('These passages come from the files you selected.',{exact:false}).first()).toBeVisible({timeout:20000});
    await expect(page.getByText('real evidence',{exact:false}).first()).toBeVisible();
    await page.setViewportSize({width:900,height:600});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Workspace overflow at 900×600');
    await page.screenshot({path:path.join(resultsDir,'installed-compact-ai.png')});
    await page.getByRole('button',{name:'Expand tool panel',exact:true}).click();
    await expect(page.getByRole('button',{name:'Dock tool panel',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Dock tool panel',exact:true}).click();
    await page.setViewportSize({width:1180,height:780});
    await page.getByRole('button',{name:'Save for later',exact:true}).click();
    await expect(page.getByText('Saved in Saved work.',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Saved work',exact:true}).click();
    await page.getByRole('button',{name:/^(Continue|Resume)$/}).click();
    await expect(page.getByRole('heading',{name:'Saved findings',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Notes',exact:true}).click();
    await page.getByRole('button',{name:'New note',exact:true}).click();
    await page.getByPlaceholder('Give your note a title').fill('Installed note');
    await page.getByPlaceholder('Write your note here…').fill('Created through the installed desktop UI');
    await page.getByRole('button',{name:'Save note'}).click();
    await page.getByText('Installed note',{exact:true}).first().click();
    await expect(page.getByText('Created through the installed desktop UI',{exact:false}).first()).toBeVisible();
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    await page.getByPlaceholder('Write your note here…').fill('Edited and persisted');
    await page.getByRole('button',{name:'Save note'}).click();
    await expect(page.getByText('Edited and persisted',{exact:false}).first()).toBeVisible();
    await page.getByRole('button',{name:'Account',exact:true}).click();
    if (process.env.GROUNDWORK_VERIFY_LIVE_SYNC === '1') {
      const accountEmail=`release-check-${crypto.randomUUID()}@example.com`;
      const accountPassword=crypto.randomBytes(32).toString('base64url');
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await page.getByRole('button',{name:'Sign in with email',exact:true}).click();
      await page.getByText('New here? Create an account',{exact:true}).click();
      await page.getByLabel('Account email').fill(accountEmail);
      await page.getByLabel('Account password').fill(accountPassword);
      const registered=page.waitForResponse(response=>response.url().endsWith('/api/sync/login') && response.request().method()==='POST');
      await page.getByRole('button',{name:'Create account',exact:true}).click();
      assert.equal((await registered).status(),200,'Live registration failed');
      await expect(page.getByRole('button',{name:'Sync now',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'Sign out',exact:true}).click();
      await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await page.getByRole('button',{name:'Sign in with email',exact:true}).click();
      await page.getByLabel('Account email').fill(accountEmail);
      await page.getByLabel('Account password').fill(accountPassword);
      const loggedIn=page.waitForResponse(response=>response.url().endsWith('/api/sync/login') && response.request().method()==='POST');
      await page.getByRole('dialog').getByRole('button',{name:'Sign in',exact:true}).click();
      assert.equal((await loggedIn).status(),200,'Live login failed');
      const synced=page.waitForResponse(response=>response.url().endsWith('/api/sync/trigger') && response.request().method()==='POST');
      await page.getByRole('button',{name:'Sync now'}).click();
      const syncResult=await (await synced).json();
      assert.equal(syncResult.status,'success',JSON.stringify(syncResult));
      const login=await fetch(cloudUrl+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:accountEmail,password:accountPassword})});
      assert.equal(login.status,200);
      const cloudAccount=await login.json();
      const cloudState=await fetch(cloudUrl+'/sync/pull',{headers:{Authorization:'Bearer '+cloudAccount.access_token}});
      assert.equal(cloudState.status,200);
      const syncedState=await cloudState.json();
      assert.ok(syncedState.notes.some(note=>note.content==='Edited and persisted'),'Installed note not found on live backend');
      assert.ok(!JSON.stringify(syncedState).includes(JSON.stringify(workspace).slice(1,-1)),'Private workspace path reached cloud sync');
      await page.screenshot({path:path.join(resultsDir,'installed-live-sync.png')});
      fs.writeFileSync(path.join(resultsDir,'live-sync-verification.json'),JSON.stringify({user_id:cloudAccount.user_id,email:accountEmail,registration:true,login:true,sync:true},null,2));
      await page.getByRole('button',{name:'Sign out',exact:true}).click();
      await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
      console.log('Live Cloud Run registration, logout, login and private metadata sync passed');
    }
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    assert.ok(!(await page.locator('body').innerText()).includes(cloudUrl),'Private service URL leaked into Settings');
    await page.getByText('Troubleshooting',{exact:true}).click();
    await page.getByRole('button',{name:'Restart Groundwork engine'}).click();
    await expect(page.getByText('Groundwork restarted. Your work is saved.',{exact:true})).toBeVisible({timeout:30000});
    connection=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('start_local_core'));
    await close();
    if(upgradeFrom) {
      const upgraded=spawnSync(installer,['/S',`/D=${installDir}`],{windowsHide:true,timeout:120000});
      assert.equal(upgraded.status,0,'Upgrade installer failed');
      assert.ok(fs.existsSync(path.join(root,'state')),'Upgrade removed user data');
    }
    await launch();
    await page.getByRole('button',{name:'Notes',exact:true}).click();
    await page.getByText('Installed note',{exact:true}).first().click();
    await expect(page.getByText('Edited and persisted',{exact:false}).first()).toBeVisible();
    await page.screenshot({path:path.join(resultsDir,'installed-restarted.png')});
    const versionState=await fetch(connection.url+'/health',{headers:{Authorization:'Bearer '+connection.token}}).then(r=>r.json());
    assert.equal(versionState.version,JSON.parse(fs.readFileSync(path.resolve(__dirname,'../package.json'),'utf8')).version,'Installed engine version differs from release');
    const preservedWorkspaces=await fetch(connection.url+'/api/workspaces',{headers:{Authorization:'Bearer '+connection.token}}).then(r=>r.json());
    assert.ok(preservedWorkspaces.some(item=>item.path===workspace),'Relaunch/upgrade lost added workspace');
    const savedFindings=await fetch(connection.url+'/api/context-sessions',{headers:{Authorization:'Bearer '+connection.token}}).then(r=>r.json());
    assert.ok(savedFindings.length>0,'Upgrade lost saved AI findings');
    assert.equal(fs.readFileSync(path.join(workspace,'sample.ts'),'utf8'),'export function installed_workflow_needle() { return \"real evidence\"; }\n','Upgrade modified a user file');
    const storageResponse=await fetch(connection.url+'/api/system/file-storage?path='+encodeURIComponent(path.join(workspace,'sample.ts')),{headers:{Authorization:'Bearer '+connection.token}});
    assert.equal(storageResponse.status,200,'Packaged storage detail endpoint unavailable');
    assert.equal((await storageResponse.json()).logical_bytes,fs.statSync(path.join(workspace,'sample.ts')).size);
    await page.getByRole('button',{name:'Files & storage',exact:true}).click();
    await page.getByText('sample.ts',{exact:true}).first().click();
    await expect(page.getByText('Allocated',{exact:true})).toBeVisible();
    await expect(page.getByText('Hard links',{exact:true})).toBeVisible();
    await page.screenshot({path:path.join(resultsDir,'installed-storage-details.png')});
    await page.getByRole('button',{name:'Ask',exact:true}).click();
    await page.getByLabel('Answer with').selectOption('local');
    await page.getByLabel('Your question').fill('installed_workflow_needle');
    const keyboardJob=page.waitForResponse(response=>response.url().endsWith('/api/ai/jobs/query') && response.request().method()==='POST');
    await page.getByLabel('Your question').press('Control+Enter');
    assert.equal((await keyboardJob).status(),200,'Ctrl+Enter did not start an answer');
    await expect(page.getByText('These passages come from the files you selected.',{exact:false}).first()).toBeVisible();
    if(upgradeFrom) console.log('Upgrade from previous installer preserved notes, workspace and original files; new storage details and keyboard AI interaction passed');
    await page.getByRole('button',{name:'Files & storage',exact:true}).click();
    const scanResponse=page.waitForResponse(response=>response.url().includes('/api/index/start') && response.request().method()==='POST');
    await page.getByRole('button',{name:'Scan',exact:true}).click();
    assert.equal((await scanResponse).status(),200,'Scan control request was rejected');
    const resumeFixture=path.join(workspace,'resume-fixture');
    fs.mkdirSync(resumeFixture);
    for(let index=0;index<400;index++) fs.writeFileSync(path.join(resumeFixture,`resume-${index}.md`),`resume_button_finalmarker document ${index} with local indexing evidence`);
    const headers={Authorization:'Bearer '+connection.token,'Content-Type':'application/json'};
    assert.equal((await fetch(connection.url+'/api/index/start',{method:'POST',headers,body:'[]'})).status,200);
    await expect(page.getByRole('button',{name:'Stop indexing',exact:true})).toBeVisible({timeout:30000});
    await page.getByRole('button',{name:'Stop indexing',exact:true}).click();
    await expect(page.getByRole('button',{name:'Resume indexing',exact:true})).toBeVisible();
    const resumeResponse=page.waitForResponse(response=>response.url().includes('/api/index/start') && response.request().method()==='POST');
    await page.getByRole('button',{name:'Resume indexing',exact:true}).click();
    assert.equal((await resumeResponse).status(),200,'Resume control request was rejected');
    await expect.poll(async()=>fetch(connection.url+'/api/index/status',{headers}).then(r=>r.json()).then(p=>p.status),{timeout:120000}).toBe('completed');
    const resumedSearch=await fetch(connection.url+'/api/search?q=resume_button_finalmarker&mode=lexical',{headers}).then(r=>r.json());
    assert.ok(resumedSearch.results.length,'Resume button did not finish searchable-content preparation');
    console.log('Native workspace footer stop/resume completed real 400-document indexing');
    await close();
    assert.deepEqual(errors,[]);
    console.log(`${portable ? 'Portable desktop' : 'Installed desktop'} with empty PATH: ${portable ? '' : 'silent install, '}native launch/backend startup, single-instance activation, real workspace indexing, live content search, grounded local passages, save/resume, compact/expanded panels, note create/edit, service restart, application shutdown/relaunch and persistence passed`);
  } finally {
    try {await close();}catch(error){console.error('Cleanup:',error.message);}
    const uninstall=path.join(installDir,'uninstall.exe');
    if(!portable && fs.existsSync(uninstall))spawnSync(uninstall,['/S'],{windowsHide:true,timeout:30000});
    restoreCiPolicy();
    // Keep failed runs and screenshots available for diagnosis.
  }
})().catch(error=>{console.error(error);process.exitCode=1;console.error('Integration directory:',root)});
