// Render the find panel and capture UI screenshots (light/dark, empty/hits).
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const bundle = await readFile(new URL('client.js', root), 'utf8');
const html = '<!doctype html><meta charset=utf-8><style>html{color-scheme:light dark}body{font:16px system-ui;margin:0}#frame{display:grid;grid-template-columns:180px 1fr 240px;height:90vh}#center{display:grid;grid-template-rows:1fr 130px;min-height:0}#flow{overflow:auto;padding:12px}#card{border:1px solid;padding:12px}[contenteditable]{height:24px}#photo{width:100px;height:100px}aside,article{padding:8px}</style><div id=hdr style="height:44px;display:flex;align-items:center;justify-content:flex-end;padding:0 14px"><div id=trigger></div></div><div id=frame><aside data-sidebar-col>侧栏标识</aside><main id=center data-conversation-session=S><div data-conversation-scroll data-chat-flow id=flow><article data-chat-node-key=m1>同一句 <b>折</b><em>线图</em></article><article data-chat-node-key=m2>同一句 · 完整消息二</article><div id=stream></div><details id=fold><summary>折叠标题</summary><p>折叠正文</p></details><div hidden>不可见的分块</div><div aria-hidden=true>不可见的分块</div><div>跨段头</div><div>跨段尾</div><div id=shadow></div><div id=many></div><img id=photo alt=测试图><iframe srcdoc="<p>框内词条</p>"></iframe></div><section data-composer-card id=card><div contenteditable=true role=textbox id=editor></div></section></main><aside data-rightbar-col>右栏标识</aside></div>';
const outDir = process.argv[2] || '../research/dsh-pane-find/validation/r7';
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const context = await browser.newContext({viewport:{width:1280,height:860}});
  const page = await context.newPage(); page.setDefaultTimeout(8000);
  await page.route('http://127.0.0.1:39877/**', r=>r.fulfill({contentType:'text/html; charset=utf-8', body:html}));
  await page.goto('http://127.0.0.1:39877/fixture');
  await page.evaluate(()=>{
    const shadow=document.querySelector('#shadow').attachShadow({mode:'open'});shadow.innerHTML='<span>影根内容</span>';
    const c=document.createElement('canvas');c.width=c.height=96;c.getContext('2d').fillRect(1,1,80,80);document.querySelector('#photo').src=c.toDataURL('image/png');
    window.__ModuleLoader__={load(e){window.entry=e}};
  });
  await page.addScriptTag({content:bundle});
  await page.evaluate(()=>{
    const dispose=[], comps={};const ctx={get(k){return k==='slots'?slots:null},effect(f){dispose.push(f())}};
    const slots={inject(_n,fn){fn()},register({id},component){comps[id]=component;}};
    const react={createElement:(tag,props,...children)=>({tag,props,children}),Fragment:Symbol('fragment'),useRef:()=>({}),useState:x=>[x,()=>{}],useEffect(fn){dispose.push(fn())}};
    window.entry.factory(()=>react).apply(ctx);const model=comps['pane-find-trigger']();
    const trigger=document.createElement('button');trigger.id='icon';trigger.setAttribute('data-pane-find-ui','trigger');trigger.onclick=model.props.onClick;document.querySelector('#trigger').append(trigger);
  });
  await mkdir(outDir,{recursive:true});
  const panel = page.getByRole('search');
  const el = page.locator('.pf-panel');
  // 真实应用环境：只定义宿主实际存在的别名，fill/shadow 等未定义项走插件回退
  const LIGHT = {'--dsw-alias-bg-layer-2':'#ffffff','--dsw-alias-label-primary':'#0f1115','--dsw-alias-label-secondary':'#61666b','--dsw-alias-border-l2':'rgba(0,0,0,.1)','--dsw-alias-brand-primary':'#0f1115'};
  const DARK = {'--dsw-alias-bg-layer-2':'#2c2c2e','--dsw-alias-label-primary':'#f9fafb','--dsw-alias-label-secondary':'#cfd3d6','--dsw-alias-border-l2':'rgba(0,0,0,.1)','--dsw-alias-brand-primary':'#f9fafb'}
  await page.evaluate(tokens=>{for(const [k,v] of Object.entries(tokens))document.body.style.setProperty(k,v);},LIGHT);
  await page.locator('#icon').click(); await panel.waitFor();
  await el.screenshot({path:outDir+'/ui-light-empty.png'});
  await page.locator('.pf-q').fill('同一句');
  await page.waitForFunction(()=>document.querySelector('.pf-count')?.textContent?.includes('/ 2'));
  await page.locator('.pf-hit').nth(1).click();
  await page.waitForFunction(()=>{const p=document.querySelector('.pf-preview');return p && p.offsetHeight>0;});
  await el.screenshot({path:outDir+'/ui-light-hits.png'});
  await page.keyboard.press('Escape'); await page.keyboard.press('Control+f'); await panel.waitFor();
  await page.evaluate(tokens=>{for(const [k,v] of Object.entries(tokens))document.body.style.setProperty(k,v);},DARK);
  await el.screenshot({path:outDir+'/ui-dark-empty.png'});
  await page.locator('.pf-q').fill('同一句');
  await page.waitForFunction(()=>document.querySelector('.pf-count')?.textContent?.includes('/ 2'));
  await el.screenshot({path:outDir+'/ui-dark-hits.png'});
  console.log('done');
} finally { await browser.close(); }
