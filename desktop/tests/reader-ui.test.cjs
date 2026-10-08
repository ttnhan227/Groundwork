const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {chromium, expect} = require('../../client/node_modules/@playwright/test');

const root = 'C:/Audit';
const directory = root + '/Documents';
const documentPath = directory + '/Lease.docx';
const pdfPath = directory + '/Receipt.pdf';
const image = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="white"/><text x="10" y="30">Receipt</text></svg>').toString('base64');
const item = (name, kind='file') => ({workspace_id:'ws',name,path:kind==='folder'?directory:directory+'/'+name,parent:kind==='folder'?root:directory,kind,extension:path.extname(name),category:'document',size_bytes:100,mtime:1});

async function fixture(browser) {
  const page = await browser.newPage({viewport:{width:1180,height:780}});
  const state = {previews:[],questions:0,scans:0,slow:false,infoFailure:false,preferences:0,ruleSaves:0,rules:[],deleteFailure:false,errors:[]};
  page.on('pageerror',e=>state.errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('groundwork-welcome-complete','1'));
  await page.route('http://127.0.0.1:8000/**', async route => {
    const req=route.request(), url=new URL(req.url());
    const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'content-type'};
    if(req.method()==='OPTIONS') return route.fulfill({status:204,headers});
    let body={},status=200;
    if(url.pathname==='/api/sync/status') body={enabled:false,is_authenticated:false,state:'disabled',pending_items:0};
    else if(url.pathname==='/api/workspaces') body=[{id:'ws',name:'Audit files',path:root,is_active:true,ignore_patterns:[]}];
    else if(url.pathname==='/api/projects') body=[];
    else if(url.pathname.includes('/inventory')) {
      const items=url.searchParams.get('kind')==='folder'?[]:url.searchParams.get('parent')===root?[item('Documents','folder')]:[item('Lease.docx'),item('Receipt.pdf')];
      body={items,total:items.length,files:2,bytes:200,parent_bytes:200,category_breakdown:[],scan_status:'completed',errors:[],updated_at:1};
    } else if(url.pathname==='/api/index/status') body={status:'completed',percent:100,files_indexed:2};
    else if(url.pathname==='/api/index/start') {state.scans++; await new Promise(r=>setTimeout(r,150)); body={status:'running'};}
    else if(url.pathname==='/api/system/file-storage') body={logical_bytes:100,allocated_bytes:4096,hard_links:1,allocation_note:''};
    else if(url.pathname==='/api/system/status') {if(state.infoFailure)status=503; else body={app_version:'1.0.0',counts:{workspaces:1,projects:0,files:2,chunks:2,notes:0}};}
    else if(url.pathname==='/api/system/file-preview') {
      const file=url.searchParams.get('path'),number=Number(url.searchParams.get('page'));
      state.previews.push({path:file,page:number});
      if(state.slow) await new Promise(r=>setTimeout(r,600));
      body={path:file,name:file.split('/').pop(),size:100,modified:1,page:number,pages:file===pdfPath?2:1,kind:file===pdfPath?'pdf':'text',text:'Apartment renewal\nRent: USD 950\nReply by 12 December',image:file===pdfPath?image:'',message:'Sample read-only evidence.',line_start:1,total_lines:3};
    } else if(url.pathname==='/api/ai/organization/history') body=[];
    else if(url.pathname==='/api/ai/organization/rules') body=state.rules;
    else if(url.pathname==='/api/ai/organization/preferences') body=[{id:'pref-1',name:'Existing preference',categories:['Receipts'],instructions:''}];
    else if(url.pathname==='/api/ai/organization/progress') body={phase:'idle',total:0,completed:0,checked:0,bytes:0};
    else if(url.pathname==='/api/ai/organization') {
      const action=req.postDataJSON();
      if(action.action==='save_preference') {state.preferences++;await new Promise(r=>setTimeout(r,150));body={id:'new-pref'};}
      else if(action.action==='delete_preference') {status=state.deleteFailure?503:200;body=state.deleteFailure?{detail:'Could not delete this preference. Try again.'}:{success:true};}
      else if(action.action==='save_rule') {state.ruleSaves++;await new Promise(r=>setTimeout(r,150));body={id:'new-rule',name:action.rule_name,folder_path:root,rule_type:'by_type',categories:[]};state.rules=[body];}
      else body={id:'plan-job',status:'complete',error:null,result:{id:'plan-1',status:'preview',created:1,instruction:'',items:[{source:documentPath,target:root+'/Lease.docx',status:'ready',error:null}]}};
    } else if(url.pathname==='/api/ai/providers') body=[{id:'builtin',name:'Built-in AI',active:true,is_local:true}];
    else if(url.pathname==='/api/system/local-ai') body={supported:true,selected:'small',models:[{id:'small',installed:true}]};
    else if(url.pathname==='/api/ai/jobs/query' || url.pathname.startsWith('/api/ai/jobs/')) {
      if(req.method()==='POST')state.questions++;
      body={id:'job-1',status:req.method()==='POST'?'running':'complete',error:null,result:{answer:'The monthly rent is USD 950. Reply by 12 December.',provider_used:'builtin',evidence_count:1,citations:[{filename:'Lease.docx',path:documentPath,line_start:1,line_end:3,snippet:'Rent: USD 950',evidence_kind:'text',coverage:'Extracted document text'}]}};
    }
    try {await route.fulfill({status,headers,contentType:'application/json',body:JSON.stringify(body)});} catch { /* The timeout test deliberately aborts a response. */ }
  });
  await page.goto('http://127.0.0.1:18559');
  await expect(page.getByRole('combobox',{name:'Current location',exact:true})).toHaveValue('ws');
  await page.locator('tr[data-file-row]').filter({hasText:'Documents'}).dblclick();
  await expect(page.locator('tr[data-file-row]').filter({hasText:'Lease.docx'})).toBeVisible();
  return {page,state};
}

test('reader navigation, recovery and desktop control regressions', {timeout:60000}, async t => {
  const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','18559','--strictPort'],{cwd:path.resolve(__dirname,'..'),windowsHide:true,stdio:'pipe'});
  let browser;
  try {
    for(let n=0;n<100;n++) {if(server.exitCode!==null)throw Error('Preview server exited');try {await fetch('http://127.0.0.1:18559');break;}catch {await new Promise(r=>setTimeout(r,100));}}
    browser=await chromium.launch();
    await t.test('selection is stable; reader preserves context and opens one AI job',async()=>{
      const {page,state}=await fixture(browser);
      try {
        const row=page.locator('tr[data-file-row]').filter({hasText:'Lease.docx'});
        const before=await row.boundingBox();await row.click();const after=await row.boundingBox();assert.equal(before.y,after.y);
        await expect(page.getByRole('main',{name:'File reader'})).toHaveCount(0);
        const checkbox=page.getByLabel('Select Lease.docx',{exact:true});await checkbox.focus();await checkbox.press('Space');await expect(checkbox).not.toBeChecked();
        await row.dblclick();await expect(page.getByLabel('File text preview')).toContainText('950');
        await page.getByRole('button',{name:'Zoom in',exact:true}).click();await expect(page.locator('.reader-zoom-value')).toHaveText('125%');
        await page.getByLabel('Preview file question',{exact:true}).fill('What is the rent?');await page.getByLabel('Preview file question',{exact:true}).press('Enter');
        await expect(page.getByText('ANSWER READY',{exact:true})).toBeVisible();await expect(page.getByLabel('File text preview')).toBeVisible();assert.equal(state.questions,1);
        await page.setViewportSize({width:900,height:600});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.getByRole('button',{name:'Close tool panel',exact:true}).click();await expect(page.getByRole('main',{name:'File reader'})).toBeVisible();await expect(page.locator('.reader-zoom-value')).toHaveText('125%');
        const calls=state.previews.length;await page.keyboard.press('F5');await expect.poll(()=>state.previews.length).toBe(calls+1);assert.equal(state.scans,0);
        await page.getByRole('region',{name:'Reader content',exact:true}).focus();await page.keyboard.press('Alt+ArrowLeft');await expect(page.locator('.explorer-address')).toContainText('Documents');
        await page.locator('tr[data-file-row]').filter({hasText:'Receipt.pdf'}).dblclick();await expect(page.getByRole('img',{name:'Receipt.pdf page 1',exact:true})).toBeVisible();
        await expect.poll(()=>state.previews.filter(x=>x.path===pdfPath&&x.page===2).length).toBe(1);await page.waitForTimeout(100);
        const pdfCalls=state.previews.length;await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(page.getByRole('img',{name:'Receipt.pdf page 2',exact:true})).toBeVisible();
        await page.getByRole('button',{name:'Previous page',exact:true}).click();await expect(page.getByRole('img',{name:'Receipt.pdf page 1',exact:true})).toBeVisible();assert.equal(state.previews.length,pdfCalls);
        await page.getByRole('button',{name:'Previous file',exact:true}).click();await expect(page.locator('.reader-file-title')).toContainText('Lease.docx');assert.deepEqual(state.errors,[]);
      } finally {await page.close();}
    });
    await t.test('cancelable requests still time out; settings recover and prevent duplicate scans',async()=>{
      const {page,state}=await fixture(browser);
      try {
        // Speed up the production timeout clock without changing fetch or UI behavior.
        await page.evaluate(()=>{const original=AbortSignal.timeout.bind(AbortSignal);AbortSignal.timeout=ms=>original(ms===15000?100:ms);});
        state.slow=true;await page.locator('tr[data-file-row]').filter({hasText:'Lease.docx'}).dblclick();await expect(page.getByRole('alert')).toContainText('took too long');
        state.slow=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await expect(page.getByLabel('File text preview')).toContainText('950');
        await page.getByRole('button',{name:'Back to files',exact:true}).click();state.infoFailure=true;
        await page.getByRole('button',{name:'More tools',exact:true}).click();await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page.getByText('Could not load app information.',{exact:true})).toBeVisible();
        state.infoFailure=false;await page.getByRole('button',{name:'Retry app information',exact:true}).click();await expect(page.getByText('Version 1.0.0',{exact:true})).toBeVisible();
        await page.getByText('Troubleshooting',{exact:true}).click();
        // Restore real timeouts for the deliberately slow mutation.
        await page.evaluate(()=>{AbortSignal.timeout=ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('Timeout','TimeoutError')),ms);return c.signal;};});
        await page.getByRole('button',{name:'Refresh all files',exact:true}).evaluate(button=>{button.click();button.click();});await expect.poll(()=>state.scans).toBe(1);await expect(page.getByRole('button',{name:'Refresh all files',exact:true})).toBeEnabled();assert.deepEqual(state.errors,[]);
      } finally {await page.close();}
    });
    await t.test('organization configuration prevents duplicate saves and shows modal failures',async()=>{
      const {page,state}=await fixture(browser);
      try {
        await page.locator('tr[data-file-row]').filter({hasText:'Lease.docx'}).click();await page.getByRole('button',{name:'Organize',exact:true}).click();
        await page.getByRole('button',{name:'Saved preferences',exact:true}).click();await page.getByLabel('Preference name',{exact:true}).fill('My documents');
        await page.getByRole('button',{name:'Save preference',exact:true}).evaluate(button=>{button.click();button.click();});await expect(page.getByLabel('Preference name',{exact:true})).toHaveValue('');assert.equal(state.preferences,1);
        state.deleteFailure=true;await page.getByRole('button',{name:'Delete preference Existing preference',exact:true}).click();await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Could not delete');
        await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
        await page.getByRole('button',{name:'Preview changes',exact:true}).click();await expect(page.getByText('Proposed Folder Tree Preview',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Save as rule',exact:true}).click();await page.getByRole('dialog').getByRole('textbox').fill('My rule');
        await page.getByRole('dialog').getByRole('button',{name:'Save rule',exact:true}).evaluate(button=>{button.click();button.click();});await expect(page.getByRole('dialog')).toHaveCount(0);assert.equal(state.ruleSaves,1);assert.deepEqual(state.errors,[]);
      } finally {await page.close();}
    });
  } finally {if(browser)await browser.close();server.kill();}
});
