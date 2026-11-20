// Chromium integration tests for cases which a blank DSH profile cannot supply.
// The browser renders real nodes, ranges and events. DSH session actions and the
// clipboard sink are local test doubles. The OS clipboard is never changed.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const bundle = await readFile(new URL('client.js', root), 'utf8');
const browser = await chromium.launch({channel:process.env.PANE_FIND_BROWSER || (process.platform==='win32'?'msedge':'chromium'),headless:true});
const checks = [];
async function check(name, fn) {
  try {const actual=await fn();checks.push({name,status:'pass',actual});console.log('PASS',name);}
  catch(e){checks.push({name,status:'fail',error:e.message});throw e;}
}
const html = '<!doctype html><meta charset=utf-8><style>html{color-scheme:light dark}body{font:16px system-ui;margin:0}#frame{display:grid;grid-template-columns:180px 1fr 240px;height:90vh}#center{display:grid;grid-template-rows:1fr 130px;min-height:0}#flow{overflow:auto;padding:12px}#card{border:1px solid;padding:12px}[contenteditable]{height:24px}#photo{width:100px;height:100px}aside,article{padding:8px}</style><div id=hdr style="height:44px;display:flex;align-items:center;justify-content:flex-end;padding:0 14px"><div id=trigger></div></div><div id=frame><aside data-sidebar-col>侧栏标识</aside><main id=center data-conversation-session=S><div data-conversation-scroll data-chat-flow id=flow><article data-chat-node-key=m1>同一句 <b>折</b><em>线图</em></article><article data-chat-node-key=m2>同一句 · 完整消息二</article><div id=stream></div><details id=fold><summary>折叠标题</summary><p>折叠正文</p></details><div hidden>不可见的分块</div><div aria-hidden=true>不可见的分块</div><div>跨段头</div><div>跨段尾</div><div id=shadow></div><div id=many></div><img id=photo alt=测试图><iframe srcdoc="<p>框内词条</p>"></iframe></div><section data-composer-card id=card><div contenteditable=true role=textbox id=editor></div></section></main><aside data-rightbar-col>右栏标识</aside></div>';
try {
 const context=await browser.newContext({viewport:{width:1280,height:860}});const page=await context.newPage();page.setDefaultTimeout(5000);
 await page.route('http://127.0.0.1:39877/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:html}));
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:39877/fixture');
 await page.evaluate(()=>{
   const shadow=document.querySelector('#shadow').attachShadow({mode:'open'});shadow.innerHTML='<span>影根内容</span>';
   const c=document.createElement('canvas');c.width=c.height=96;c.getContext('2d').fillRect(1,1,80,80);document.querySelector('#photo').src=c.toDataURL('image/png');
   window.__ModuleLoader__={load(e){window.entry=e}};
   window.clip={text:'',image:null};Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.clip.text=text},write:async items=>{const blob=await items[0].getType('image/png');window.clip.image=[blob.type,blob.size];}}});
 });await page.addScriptTag({content:bundle});
 await page.evaluate(()=>{
   const dispose=[], comps={};const ctx={get(k){return k==='slots'?slots:null},effect(f){dispose.push(f())}};
   const slots={inject(_n,fn){fn()},register({id},component){comps[id]=component;}};
   const react={createElement:(tag,props,...children)=>({tag,props,children}),Fragment:Symbol('fragment'),useRef:()=>({}),useState:x=>[x,()=>{}],useEffect(fn){dispose.push(fn())}};
   window.entry.factory(()=>react).apply(ctx);const model=comps['pane-find-trigger']();
   const trigger=document.createElement('button');trigger.id='icon';trigger.setAttribute('data-pane-find-ui','trigger');trigger.onclick=model.props.onClick;document.querySelector('#trigger').append(trigger);
   const input={draft:'',phase:'plain',attachmentIds:[]},messages=new Map();
   const user=(id,seq)=>messages.set(id,{kind:'user',anchorSeq:seq,data:{content:[{type:'text',text:id}]}});
   const tail=(id,seq)=>messages.set(id,{kind:'turn-tail',anchorSeq:seq,data:{closing:{finalNode:{messageId:id,seq}}}});
   user('早先消息',1);tail('A',2);user('最近消息',3);tail('B',4);
   const chat={order:[...messages.keys()],nodes:messages},sent=[];
   const actions={setDraft(s){input.draft=s;document.querySelector('#editor').textContent=s;},submit(){sent.push(input.draft);actions.setDraft('')},removeAttachment(){}};
   const props={sessionId:'S',useSession:f=>f({running:false}),useChat:f=>f(chat),useInput:f=>f(input),inputActions:actions};
   comps['pane-find-history'](props);document.querySelector('#editor').addEventListener('input',e=>input.draft=e.target.textContent);
   window.qa={sent,actions,actionsFor:id=>comps['pane-find-actions']({...props,messageId:id}).children.filter(Boolean).map(b=>({label:b.children[0],click:b.props.onClick,disabled:b.props.disabled})),stop(){dispose.reverse().forEach(f=>f?.());}};
 });
 const panel=page.getByRole('search'), input=panel.getByRole('textbox');const button=name=>panel.getByRole('button',{name,exact:true});
 async function count(query,n){await input.fill(query);await page.waitForFunction(({q,n})=>document.querySelector('.pf-q')?.value===q && document.querySelector('.pf-count')?.textContent?.endsWith(' / '+n) && (n===0 || [...CSS.highlights.get('dsh-pane-find-current')||[]][0]?.toString()===q),{q:query,n});}
 async function active(){return page.evaluate(()=>{const r=[...CSS.highlights.get('dsh-pane-find-current')][0];return [r.toString(),r.startContainer.parentElement.closest('[data-chat-node-key]')?.dataset.chatNodeKey];});}
 await page.locator('#icon').click();
 await check('duplicate occurrences navigate to distinct source rows',async()=>{await count('同一句',2);assert.deepEqual(await active(),['同一句','m1']);await button('下一处').click();const got=await active();assert.deepEqual(got,['同一句','m2']);return got;});
 await check('preview copies the complete selected message to the clipboard sink',async()=>{await button('复制整条').click();assert.equal(await page.evaluate(()=>window.clip.text),'同一句 · 完整消息二');return true;});
 await check('literal Chinese phrase spans adjacent inline markdown nodes',async()=>{await count('折线图',1);return await active();});
 await check('block boundary, hidden content and iframe produce no false matches',async()=>{for(const term of ['跨段头跨段尾','不可见的分块','框内词条']){await count(term,0);assert.equal(await page.locator('.pf-hit').count(),0);}return true;});
 await check('opening details recounts, closing removes range',async()=>{await count('折叠正文',0);await page.locator('#fold summary').click();await count('折叠正文',1);await page.locator('#fold summary').click();await count('折叠正文',0);return true;});
 await check('open shadow tree initial text and streamed changes',async()=>{await count('影根内容',1);await page.evaluate(()=>document.querySelector('#shadow').shadowRoot.querySelector('span').append(' · 影根内容'));await count('影根内容',2);return true;});
 await check('streaming normal DOM append updates existing search',async()=>{await count('流式追加',0);await page.evaluate(()=>document.querySelector('#stream').append('流式追加 流式追加'));await count('流式追加',2);return true;});
 await check('true total differs from 12 preview rows and the 5000 range budget',async()=>{await page.evaluate(()=>document.querySelector('#many').textContent='唯一量词 '.repeat(5003));await count('唯一量词',5003);assert.equal(await page.locator('.pf-hit').count(),12);assert.equal(await page.evaluate(()=>CSS.highlights.get('dsh-pane-find-all').size),5000);return {total:5003,painted:5000,listed:12};});
 await check('theme colors follow live host tokens',async()=>{const colors=[];for(const bg of ['#fefefe','#242424']){await page.evaluate(bg=>document.body.style.setProperty('--dsw-alias-bg-layer-2',bg),bg);colors.push(await panel.evaluate(e=>getComputedStyle(e).backgroundColor));}assert.deepEqual(colors,['rgb(254, 254, 254)','rgb(36, 36, 36)']);return colors;});
 await page.keyboard.press('Escape');
 await check('missing CSS Highlight API retains scoped selection and then clears it',async()=>{await page.evaluate(()=>{window._h=window.Highlight;window.Highlight=undefined;});await page.keyboard.press('Control+f');await input.fill('同一句');await page.waitForFunction(()=>window.getSelection().toString()==='同一句');await input.fill('无此匹配');await page.waitForFunction(()=>window.getSelection().toString()==='');await page.keyboard.press('Escape');await page.evaluate(()=>window.Highlight=window._h);return true;});
 await check('composer arrows recall, return to empty and preserve edited input',async()=>{const e=page.locator('#editor');await e.click();await e.press('ArrowUp');assert.equal(await e.innerText(),'最近消息');await e.press('ArrowUp');assert.equal(await e.innerText(),'早先消息');await e.press('ArrowDown');await e.press('ArrowDown');assert.equal(await e.innerText(),'');await e.fill('编辑中');await e.press('ArrowUp');assert.equal(await e.innerText(),'编辑中');await e.fill('');return true;});
 await check('answer action adapter only continues the latest reply and admits explicit clicks once',async()=>{const observed=await page.evaluate(()=>{const a=window.qa.actionsFor('A'),b=window.qa.actionsFor('B');a[0].click();a[0].click();return {old:a.map(x=>x.label),last:b.map(x=>x.label),sent:window.qa.sent};});assert.deepEqual(observed,{old:['重新生成'],last:['重新生成','继续生成'],sent:['早先消息']});return observed;});
 await check('hover image copies a nonempty PNG to the isolated clipboard sink',async()=>{await page.locator('#photo').hover();await page.getByRole('button',{name:'复制图片'}).click();await page.waitForFunction(()=>window.clip.image?.[1]>0);return await page.evaluate(()=>window.clip.image);});
 await page.keyboard.press('Escape');
 await check('magnifier click anchors the panel beside the icon',async()=>{await page.locator('#icon').click();await panel.waitFor();const r=await page.evaluate(()=>{const p=document.querySelector('.pf-panel').getBoundingClientRect(),t=document.querySelector('#icon').getBoundingClientRect();return {pLeft:p.left,pTop:p.top,pRight:p.right,bottomStyle:document.querySelector('.pf-panel').style.bottom,tLeft:t.left,tTop:t.top};});assert.ok(r.pRight<=r.tLeft+2,'panel right edge sits left of the magnifier');assert.ok(Math.abs(r.pTop-r.tTop)<=2,'panel top aligns with the magnifier icon');assert.equal(r.bottomStyle,'auto');await page.keyboard.press('Escape');return r;});
 await check('dragging the edge moves the panel and remembers the spot',async()=>{await page.keyboard.press('Control+f');await panel.waitFor();const before=await page.evaluate(()=>{const b=document.querySelector('.pf-panel').getBoundingClientRect();return {left:b.left,top:b.top};});const moved=await page.evaluate(()=>{const s=document.querySelector('.pf-dz-t');const r=document.querySelector('.pf-panel').getBoundingClientRect();const sx=r.left+60,sy=r.top+3;s.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:sx,clientY:sy,button:0,pointerId:7}));window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:sx-180,clientY:sy+120,pointerId:7}));window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:sx-180,clientY:sy+120,pointerId:7}));const b=document.querySelector('.pf-panel').getBoundingClientRect();return {left:b.left,top:b.top,bottomStyle:document.querySelector('.pf-panel').style.bottom,shieldGone:!document.querySelector('[data-pane-find-ui="drag-shield"]')};});assert.ok(Math.abs(moved.left-(before.left-180))<2 && Math.abs(moved.top-(before.top+120))<2,'panel follows the drag delta');assert.equal(moved.bottomStyle,'auto');assert.ok(moved.shieldGone);const savedPos=await page.evaluate(()=>JSON.parse(localStorage.getItem('dsh-pane-find.settings.v1')).position);assert.ok(Math.abs(savedPos.left-moved.left)<2 && Math.abs(savedPos.top-moved.top)<2);await page.keyboard.press('Escape');await page.keyboard.press('Control+f');await panel.waitFor();const again=await page.evaluate(()=>{const b=document.querySelector('.pf-panel').getBoundingClientRect();return {left:b.left,top:b.top};});assert.ok(Math.abs(again.left-moved.left)<2 && Math.abs(again.top-moved.top)<2,'Ctrl+F reopens at the remembered spot');await page.keyboard.press('Escape');return {moved,again};});
 await page.keyboard.press('Escape');
 await check('panel width adapts to input length',async()=>{await page.keyboard.press('Control+f');await panel.waitFor();await input.fill('');const empty=await page.evaluate(()=>document.querySelector('.pf-panel').offsetWidth);await page.evaluate(()=>{const i=document.querySelector('.pf-q');i.value='这是一段相当长的搜索内容用来验证面板宽度会跟随输入扩展';i.dispatchEvent(new Event('input',{bubbles:true}));});await page.waitForFunction(w=>document.querySelector('.pf-panel').offsetWidth>w,empty,{timeout:3000});const wide=await page.evaluate(()=>document.querySelector('.pf-panel').offsetWidth);assert.ok(wide>empty,'panel grows with input');await page.keyboard.press('Escape');return {empty,wide};});
 await check('side scope merges both side columns',async()=>{await page.keyboard.press('Control+f');await panel.waitFor();await button('查找侧栏').click();await count('侧栏标识',1);await count('右栏标识',1);await button('查找对话').click();await page.keyboard.press('Escape');return true;});
 await check('dispose removes the hotkey, panel style and image button',async()=>{await page.evaluate(()=>window.qa.stop());await page.keyboard.press('Control+f');assert.equal(await panel.count(),0);assert.equal(await page.locator('.pf-img,style[data-pane-find-ui]').count(),0);assert.deepEqual(errors,[]);return true;});
} finally {
 await browser.close();if(process.argv[2]) await writeFile(fileURLToPath(new URL(process.argv[2],root)),JSON.stringify(checks,null,2)+'\n');
}
