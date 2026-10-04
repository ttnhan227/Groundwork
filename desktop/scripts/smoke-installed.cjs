/* Exercise an installed release in its real WebView2, with no developer PATH. */
const {chromium, expect} = require('../../client/node_modules/@playwright/test');
const {spawn, spawnSync, execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const net = require('node:net');
if (!process.argv[2]) throw new Error('Pass the NSIS installer path');
const installer = path.resolve(process.argv[2]);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-installed-')));
const installDir = path.join(root, 'application');
const resultsDir = path.resolve(__dirname, '../test-results');
fs.mkdirSync(resultsDir, {recursive:true});
const workspace = path.join(root, 'workspace');
fs.mkdirSync(workspace);
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({name:'installed-workflow', dependencies:{react:'19'}}));
fs.writeFileSync(path.join(workspace, 'sample.ts'), 'export function installed_workflow_needle() { return "real evidence"; }\n');
for (const args of [['init'],['config','user.name','Installer Test'],['config','user.email','installer@example.com'],['add','.'],['commit','-m','Initialize installed workflow']]) execFileSync('git',args,{cwd:workspace,stdio:'ignore'});
const env = {...process.env, PATH:'', GROUNDWORK_DATA_DIR:path.join(root,'state'), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=18540 --remote-debugging-address=127.0.0.1'};
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
  page=browser.contexts()[0].pages()[0];
  page.on('console', message=>{if(message.type()==='error') console.error('WebView:',message.text());});
  page.on('requestfailed', request=>console.error('Request failed:',request.url(),request.failure()));
  await expect(page.getByRole('heading',{name:'Detected Projects'})).toBeVisible({timeout:30000});
  connection=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('start_local_core'));
  console.log('Core endpoint', connection.url, 'WebView', await page.evaluate(()=>({origin:location.origin,isTauri:window.isTauri})));
  const preflight=await fetch(connection.url+'/api/system/status',{method:'OPTIONS',headers:{Origin:'http://tauri.localhost','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(preflight.headers.get('access-control-allow-origin'),'http://tauri.localhost','Installed runtime rejected its desktop origin');
  await expect(page.getByText(/Core Active/)).toBeVisible({timeout:30000});
  assert.match(connection.url,/^http:\/\/127\.0\.0\.1:\d+$/);
}
async function close() {
  if(app && app.exitCode===null) {
    execFileSync('powershell.exe',['-NoProfile','-Command',`$nativeProcess = Get-Process -Id ${app.pid}; $nativeProcess.CloseMainWindow() | Out-Null`]);
    for(let i=0;i<100 && app.exitCode===null;i++)await new Promise(r=>setTimeout(r,100));
    assert.notEqual(app.exitCode,null,'Native window did not shut down');
    if(connection) await assert.rejects(()=>fetch(connection.url+'/health',{headers:{Authorization:'Bearer '+connection.token}}));
  }
  browser=undefined;
}
(async()=>{
  const installed=spawnSync(installer,['/S',`/D=${installDir}`],{windowsHide:true,timeout:120000});
  assert.equal(installed.status,0,`Installer failed: ${installed.error || installed.status}`);
  assert.ok(fs.existsSync(path.join(installDir,'groundwork-desktop.exe')),'Installed executable missing');
  try {
    await launch();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://**',route=>route.abort());
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByPlaceholder('Workspace Name (e.g. My Projects)').fill('Installed test');
    await page.getByPlaceholder('Full Folder Path (e.g. C:\\projects)').fill(workspace);
    await page.getByRole('button',{name:'Add Workspace',exact:true}).click();
    await page.getByRole('button',{name:'Projects',exact:true}).click();
    await expect(page.getByText('installed-workflow',{exact:true})).toBeVisible({timeout:20000});
    await page.getByRole('button',{name:'Overview',exact:true}).click();
    await expect(page.getByText('Initialize installed workflow',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close dialog'}).click();
    await page.keyboard.press('Control+k');
    await page.getByRole('textbox',{name:'Search files and symbols'}).fill('installed_workflow_needle');
    await expect(page.locator('[data-result-index="0"]')).toContainText('sample.ts',{timeout:20000});
    await page.screenshot({path:path.join(resultsDir,'installed-search.png')});
    await page.getByRole('button',{name:'Ask with context'}).click();
    await page.getByRole('button',{name:'Investigate',exact:true}).click();
    await expect(page.getByText('These excerpts match your search.',{exact:false}).first()).toBeVisible({timeout:20000});
    await expect(page.getByText('real evidence',{exact:false}).first()).toBeVisible();
    await page.getByRole('checkbox',{name:'Deep Multi-Step Investigation Mode'}).check();
    const investigationResponse=page.waitForResponse(response=>response.url().endsWith('/api/ai/investigate') && response.request().method()==='POST');
    await page.getByRole('button',{name:'Investigate',exact:true}).click();
    const savedInvestigation=await (await investigationResponse).json();
    assert.ok(savedInvestigation.session_id);
    assert.ok(savedInvestigation.inspected_files.includes(path.join(workspace,'sample.ts')));
    await page.getByRole('button',{name:'Resume Work',exact:true}).click();
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await expect(page.getByPlaceholder('Ask an investigation question about your workspace or codebase...')).toHaveValue(/Continue Investigation/);
    const resumedRequest=page.waitForRequest(request=>request.url().endsWith('/api/ai/query') && request.method()==='POST');
    await page.getByRole('button',{name:'Investigate',exact:true}).click();
    assert.equal((await resumedRequest).postDataJSON().session_id,savedInvestigation.session_id);
    await expect(page.getByText('These excerpts match your search.',{exact:false}).first()).toBeVisible();
    await page.getByRole('button',{name:'Notes',exact:true}).click();
    await page.getByRole('button',{name:'New',exact:true}).click();
    await page.getByPlaceholder('e.g. SQLite connection pool issue note').fill('Installed note');
    await page.getByPlaceholder('Markdown formatted note content...').fill('Created through the installed desktop UI');
    await page.getByRole('button',{name:'Save Note'}).click();
    await page.getByText('Installed note',{exact:true}).first().click();
    await expect(page.getByText('Created through the installed desktop UI',{exact:false}).first()).toBeVisible();
    await page.getByRole('button',{name:'Edit',exact:true}).click();
    await page.getByPlaceholder('Markdown formatted note content...').fill('Edited and persisted');
    await page.getByRole('button',{name:'Save Note'}).click();
    await expect(page.getByText('Edited and persisted',{exact:false}).first()).toBeVisible();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Restart local service'}).click();
    await expect(page.getByText('Local service restarted',{exact:true})).toBeVisible({timeout:30000});
    connection=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('start_local_core'));
    await close();
    await launch();
    await page.getByRole('button',{name:'Notes',exact:true}).click();
    await page.getByText('Installed note',{exact:true}).first().click();
    await expect(page.getByText('Edited and persisted',{exact:false}).first()).toBeVisible();
    await page.screenshot({path:path.join(resultsDir,'installed-restarted.png')});
    await close();
    assert.deepEqual(errors,[]);
    console.log('Installed desktop with empty PATH: silent install, native launch/backend startup, workspace UI, Git overview, keyboard search, grounded AI, investigation/save/resume, note create/edit, service restart, application shutdown/relaunch and persistence passed');
  } finally {
    try {await close();}catch(error){console.error('Cleanup:',error.message);}
    const uninstall=path.join(installDir,'uninstall.exe');
    if(fs.existsSync(uninstall))spawnSync(uninstall,['/S'],{windowsHide:true,timeout:30000});
    restoreCiPolicy();
    // Keep failed runs and screenshots available for diagnosis.
  }
})().catch(error=>{console.error(error);process.exitCode=1;console.error('Integration directory:',root)});
