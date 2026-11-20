import { getScopes, searchScope, paintHits, clearHighlights, revealHit, observePage, highlightCSS } from './search.js';

const PREFS = 'dsh-pane-find.settings.v1', SAVED = 'dsh-pane-find.saved.v1';
const PAGE = 12, NAMES = {center:'对话', side:'侧栏'};
function load(win, key) { try { return JSON.parse(win.localStorage.getItem(key)); } catch { return null; } }
function save(win, key, value) { try { win.localStorage.setItem(key,JSON.stringify(value)); return true; } catch { return false; } }
export function combo(e) {
  const key = e.key?.toLowerCase();
  if (!/^[a-z0-9]$/.test(key) || (!e.ctrlKey && !e.metaKey && !e.altKey) || e.isComposing || e.getModifierState?.('AltGraph')) return '';
  return [e.ctrlKey || e.metaKey ? 'Mod' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key.toUpperCase()].filter(Boolean).join('+');
}
export function fingerprint(text) {
  let hash = 2166136261;
  for (let i=0;i<text.length;i++) hash = Math.imul(hash ^ text.charCodeAt(i),16777619);
  return (hash>>>0).toString(36);
}
function element(doc, tag, cls, text) {
  const e=doc.createElement(tag); if (cls) e.className=cls; if (text) e.textContent=text; return e;
}
export const panelCSS = highlightCSS + 
  '.pf-trigger,.pf-action,.pf-panel button,.pf-img{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent}.pf-trigger{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:7px;color:var(--dsw-alias-label-secondary,inherit)}' +
  '.pf-panel,.pf-img{--pf-bg:var(--dsw-alias-bg-layer-2,Canvas);--pf-text:var(--dsw-alias-label-primary,CanvasText);--pf-dim:var(--dsw-alias-label-secondary,GrayText);--pf-line:var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 18%,transparent));--pf-soft:var(--dsw-alias-fill-l1,color-mix(in srgb,currentColor 6%,transparent));--pf-softer:var(--dsw-alias-fill-l2,color-mix(in srgb,currentColor 3%,transparent));--pf-brand:var(--dsw-alias-brand-primary,#4c8bd8);--pf-brand-tint:color-mix(in srgb,var(--pf-brand) 12%,transparent);box-sizing:border-box;position:fixed;z-index:10001;background:var(--pf-bg);color:var(--pf-text);font:13px/1.45 system-ui,sans-serif;border:1px solid var(--pf-line);border-radius:12px;box-shadow:var(--dsw-alias-shadow-l2,0 2px 8px rgba(0,0,0,.08),0 16px 44px rgba(0,0,0,.2));overflow:hidden}.pf-panel{display:flex;flex-direction:column}.pf-panel [hidden],.pf-img[hidden]{display:none!important}' +
  '.pf-body{display:flex;flex-direction:column;min-height:0;flex:1;overflow-y:auto;padding:6px}' +
  '.pf-frame{position:absolute;inset:0;pointer-events:none}.pf-dz{position:absolute;pointer-events:auto;cursor:move;touch-action:none}.pf-dz-t{top:0;left:0;right:0;height:7px}.pf-dz-b{bottom:0;left:0;right:0;height:7px}.pf-dz-l{top:0;bottom:0;left:0;width:7px}.pf-dz-r{top:0;bottom:0;right:0;width:7px}body.pf-dragging,body.pf-dragging *{cursor:move!important;user-select:none!important}' +
  '.pf-panel .pf-row{display:flex;align-items:center;gap:5px;padding:0 2px 5px}.pf-panel .pf-row>*{flex:none}.pf-panel .pf-glyph{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;color:var(--pf-dim);background:var(--pf-softer);flex:none}.pf-panel .pf-glyph svg{display:block}' +
  '.pf-panel .pf-q{flex:1 1 auto;min-width:36px;background:var(--pf-softer);color:inherit;font:inherit;padding:4px 8px;outline:none;border:0;border-radius:7px;transition:background .15s ease,box-shadow .15s ease}.pf-q::placeholder{color:var(--pf-dim)}.pf-q:focus{background:var(--pf-soft);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--pf-brand) 45%,transparent)}' +
  '.pf-panel button,.pf-action{border-radius:7px;padding:3px 7px;transition:background .12s ease,color .12s ease}.pf-panel button:hover,.pf-panel button:focus-visible,.pf-trigger:hover,.pf-action:hover{background:var(--dsw-alias-interactive-bg-hover,#8882)}.pf-panel button:focus-visible{outline:2px solid var(--pf-brand);outline-offset:1px}.pf-panel button:disabled{opacity:.4;cursor:default}' +
  '.pf-panel .pf-scopes{display:flex;background:var(--pf-soft);border-radius:8px;padding:2px;gap:1px;flex:none}.pf-panel .pf-scopes button{font-size:11px;white-space:nowrap;border-radius:6px;padding:3px 9px;color:var(--pf-dim)}.pf-panel .pf-scopes button:hover{color:var(--pf-text)}.pf-panel button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-3,var(--pf-bg));color:var(--pf-text);box-shadow:var(--dsw-alias-shadow-l1,0 1px 3px rgba(0,0,0,.16))}.pf-panel button[aria-current=true]{background:var(--pf-brand-tint);box-shadow:inset 2px 0 0 var(--pf-brand)}' +
  '.pf-panel .pf-count{font-variant-numeric:tabular-nums;font-size:11px;color:var(--pf-dim);white-space:nowrap;background:var(--pf-softer);border-radius:6px;padding:3px 7px}.pf-panel .pf-results{display:grid;gap:2px;max-height:30vh;overflow:auto;padding-bottom:2px}.pf-panel .pf-hit{text-align:start;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;border-radius:7px;padding:4px 8px}.pf-panel .pf-hit:hover{background:var(--pf-softer)}.pf-panel .pf-preview{border:1px solid var(--pf-line);border-radius:9px;padding:7px 9px;margin-top:3px;background:var(--pf-softer)}.pf-preview pre{font:inherit;line-height:1.6;max-height:16vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 4px}' +
  '.pf-panel .pf-foot,.pf-panel .pf-settings{padding:5px 2px 2px;border-top:1px solid var(--pf-line);font-size:11px;color:var(--pf-dim)}.pf-panel .pf-foot{justify-content:space-between;margin-top:3px}.pf-panel .pf-note{font-size:11px;color:var(--pf-dim);padding-inline:5px}.pf-img{padding:4px 9px}.pf-action{font-size:12px;margin-inline-end:2px}' +
  '.pf-body::-webkit-scrollbar,.pf-panel .pf-results::-webkit-scrollbar{width:6px;height:6px}.pf-body::-webkit-scrollbar-thumb,.pf-panel .pf-results::-webkit-scrollbar-thumb{background:var(--pf-line);border-radius:3px}.pf-body::-webkit-scrollbar-track,.pf-panel .pf-results::-webkit-scrollbar-track{background:transparent}';

export function createPanel(doc) {
  const win=doc.defaultView, prefs=load(win,PREFS) || {};
  let preferred=Object.hasOwn(NAMES,prefs.scope) ? prefs.scope : prefs.scope==='left'||prefs.scope==='right' ? 'side' : 'center';
  let shortcut=/^(?:Mod(?:\+Alt)?|Alt)(?:\+Shift)?\+[A-Z0-9]$/.test(prefs.shortcut) ? prefs.shortcut : 'Mod+F';
  const validPos=p=>p && Number.isFinite(p.left) && Number.isFinite(p.top);
  let pos=validPos(prefs.position)?{left:prefs.position.left,top:prefs.position.top}:null;
  let dragging=false, stopDrag=null;
  let ui, watch, resize, originalFocus, timer, result, active, scope, session, recording=false, lastQuery='', pageStart=0;
  function persistPrefs(){return save(win,PREFS,{scope:preferred,shortcut,position:pos});}
  function sessionId(){return doc.querySelector('[data-conversation-session]')?.getAttribute('data-conversation-session') || '';}
  function shortcutLabel(){return shortcut.replace('Mod',/Mac|iPhone|iPad/.test(win.navigator.platform)?'⌘':'Ctrl');}
  function saved(){const x=load(win,SAVED);return Array.isArray(x)?x.filter(v=>v && typeof v.query==='string' && typeof v.session==='string').map(v=>({...v,scope:v.scope==='center'?'center':'side'})).filter(v=>Object.hasOwn(NAMES,v.scope)).slice(0,20):[];}
  function note(msg){if(ui)ui.note.textContent=msg;}
  function button(parent,label,action,text=label){const b=element(doc,'button','',text);b.type='button';b.title=label;b.setAttribute('aria-label',label);b.onclick=action;parent.append(b);return b;}
  function baseWidth(){
    const anchor=doc.querySelector('[data-composer-card]')?.getBoundingClientRect();
    return Math.min(Math.max(0,win.innerWidth-16),Math.min(560,anchor?.width>100?anchor.width:480));
  }
  function textUnits(s){let u=0;for(const ch of s){const c=ch.codePointAt(0);u+=(c>=0x2E80&&c<=0x9FFF)||(c>=0xF900&&c<=0xFAFF)||(c>=0xFF01&&c<=0xFF60)||(c>=0x3000&&c<=0x303F)?1:0.58;}return u;}
  // 宽度 = 行内固定部分 + 输入文字估宽，随输入字数自适应伸展
  function syncWidth(){
    if(!ui||dragging)return;
    let chrome=0;
    for(const child of ui.row.children){if(child===ui.q)continue;const r=child.getBoundingClientRect();if(r.width)chrome+=r.width;}
    chrome+=4*ui.row.children.length;
    const upper=baseWidth();
    const need=chrome+18+Math.max(84,textUnits(ui.q.value||ui.q.placeholder)*13+8);
    ui.box.style.width=Math.round(Math.max(Math.min(400,upper),Math.min(upper,need)))+'px';
  }
  function clampPos(p,w){return {left:Math.max(6,Math.min(win.innerWidth-w-6,p.left)),top:Math.max(6,Math.min(win.innerHeight-180,p.top))};}
  // 点击放大镜：面板出现在放大镜左下方的空白区域
  function magnifierPos(w){
    const t=doc.querySelector('button[data-pane-find-ui="trigger"]');
    if(!t)return null;
    const r=t.getBoundingClientRect();
    if(!r.width)return null;
    const top=Math.max(8,r.top);
    let left=r.left-w-12;
    if(left<8)left=Math.max(8,Math.min(win.innerWidth-w-8,r.left));
    return {left,top};
  }
  function applyPosition(){
    if(!ui||dragging)return;
    syncWidth();
    const w=ui.box.offsetWidth;
    if(pos){
      ui.box.style.bottom='auto';
      const p=clampPos(pos,w);
      ui.box.style.left=p.left+'px';ui.box.style.top=p.top+'px';
      ui.box.style.maxHeight=Math.max(90,win.innerHeight-p.top-6)+'px';
      pos=p;
    }else{
      const anchor=doc.querySelector('[data-composer-card]')?.getBoundingClientRect();
      const bottom=anchor && anchor.top>120 ? Math.max(8,win.innerHeight-anchor.top+8) : 12;
      ui.box.style.top='auto';
      ui.box.style.left=Math.max(8,Math.min(win.innerWidth-w-8,anchor?anchor.left+(anchor.width-w)/2:(win.innerWidth-w)/2))+'px';
      ui.box.style.bottom=bottom+'px';
      ui.box.style.maxHeight=Math.max(90,win.innerHeight-bottom-8)+'px';
    }
  }
  function startDrag(e){
    if(e.button!==0 || !ui)return;
    const rect=ui.box.getBoundingClientRect();
    const sx=e.clientX, sy=e.clientY, ol=rect.left, ot=rect.top, w=rect.width;
    dragging=true;doc.body.classList.add('pf-dragging');
    e.preventDefault();
    // 全屏遮罩：拖拽经过 iframe 或其它层时指针事件不丢失
    const shield=element(doc,'div','');shield.setAttribute('data-pane-find-ui','drag-shield');
    shield.style.cssText='position:fixed;inset:0;z-index:2147483600;cursor:move';
    doc.body.append(shield);
    const move=ev=>{
      if(!ui)return;
      const p=clampPos({left:ol+(ev.clientX-sx),top:ot+(ev.clientY-sy)},w);
      pos=p;
      ui.box.style.left=p.left+'px';ui.box.style.top=p.top+'px';ui.box.style.bottom='auto';
    };
    let done=false;
    const end=()=>{
      if(done)return;done=true;
      win.removeEventListener('pointermove',move,true);
      win.removeEventListener('pointerup',end,true);
      win.removeEventListener('pointercancel',end,true);
      shield.remove();doc.body.classList.remove('pf-dragging');
      dragging=false;stopDrag=null;persistPrefs();
    };
    stopDrag=()=>{if(done)return;done=true;dragging=false;shield.remove();doc.body.classList.remove('pf-dragging');stopDrag=null;};
    win.addEventListener('pointermove',move,true);
    win.addEventListener('pointerup',end,true);
    win.addEventListener('pointercancel',end,true);
  }
  function preview(hit){ui.pre.textContent=hit.fullText;ui.preview.hidden=false;ui.copy.textContent='复制整条';}
  function draw(){
    const {hits,total}=result;
    const painted=paintHits(doc,hits,active);
    ui.count.textContent=(hits.length?active+1:0)+' / '+total;
    ui.prev.disabled=ui.next.disabled=!hits.length;
    ui.list.replaceChildren();
    for(let i=pageStart;i<Math.min(hits.length,pageStart+PAGE);i++){
      const h=hits[i], b=button(ui.list,'定位第 '+(i+1)+' 处',()=>activate(i),h.excerpt);
      b.className='pf-hit';b.setAttribute('aria-current',String(i===active));b.onpointerenter=b.onfocus=()=>preview(h);
    }
    ui.foot.hidden=!ui.q.value;
    ui.summary.textContent=total?'共 '+total+' 处 · 列出 '+(pageStart+1)+'–'+Math.min(pageStart+PAGE,hits.length)+(total>hits.length?' · 可定位前 '+hits.length+' 处':''):'没有匹配';
    ui.pages.hidden=hits.length<=PAGE;ui.pgPrev.disabled=pageStart===0;ui.pgNext.disabled=pageStart+PAGE>=hits.length;
    if(!painted && hits.length)note('当前浏览器仅标出所选匹配');
  }
  function activate(index){
    const n=result.hits.length;if(!n)return;
    const i=(index%n+n)%n, hit=result.hits[i];
    if(!revealHit(hit)){refresh();note('内容已变化，请重新选择结果');return;}
    active=i;pageStart=Math.floor(i/PAGE)*PAGE;draw();preview(hit);
  }
  function refresh(){
    if(!ui)return;
    const sid=sessionId();if(sid!==session){close();return;}
    const scopes=getScopes(doc);
    const next=scopes[preferred]?preferred:scopes.center?'center':scopes.side?'side':'center';
    const oldKey=next===scope && lastQuery===ui.q.value ? result?.hits[active]?.key : null;
    const oldPreview= !ui.preview.hidden;
    scope=next;lastQuery=ui.q.value;
    for(const [id,b] of Object.entries(ui.buttons)){b.hidden=!scopes[id];b.setAttribute('aria-pressed',String(id===scope));}
    result=searchScope(scopes[scope],lastQuery);
    watch?.watch(result.shadows);
    const found=oldKey==null?-1:result.hits.findIndex(h=>h.key===oldKey);
    active=Math.max(0,found);pageStart=Math.floor(active/PAGE)*PAGE;
    ui.preview.hidden=true;
    if(found>=0 && oldPreview)preview(result.hits[found]);
    draw();applyPosition();
  }
  function queue(){win.clearTimeout(timer);timer=win.setTimeout(refresh,70);}
  const onScroll=()=>{if(!pos)applyPosition();};
  function close(restore=true){
    if(!ui)return;win.clearTimeout(timer);watch?.dispose();resize?.disconnect();
    if(stopDrag)stopDrag();
    win.removeEventListener('scroll',onScroll,true);clearHighlights(doc);
    ui.box.remove();ui=null;result=null;watch=null;resize=null;recording=false;lastQuery='';
    if(restore && originalFocus?.isConnected)originalFocus.focus({preventScroll:true});originalFocus=null;
  }
  function saveResult(){
    if(lastQuery!==ui.q.value) refresh();
    const query=ui.q.value,hit=result.hits[active];if(!query || !hit){note('选中一个匹配后再保存');return;}
    const item={session,scope,query:query.slice(0,512),key:hit.durable?hit.key:null,hash:hit.durable?fingerprint(hit.excerpt):null};
    const items=saved().filter(s=>!(s.session===session && s.scope===scope && s.query===item.query && s.key===item.key));
    const ok=save(win,SAVED,[item,...items].slice(0,20));note(ok?'已保存到本机':'浏览器未允许保存');renderSettings();
  }
  function restore(item){
    preferred=item.scope;ui.q.value=item.query;refresh();
    if(scope!==item.scope){note('保存的栏当前收起');return;}
    const index=item.key && result.hits.findIndex(h=>h.key===item.key && fingerprint(h.excerpt)===item.hash);
    if(typeof index==='number' && index>=0){activate(index);note('已定位保存的结果');}else note('已重新查找，请从当前结果选择位置');
  }
  function renderSettings(){
    const box=ui.settings;box.replaceChildren();
    button(box,'修改查找快捷键',()=>{recording=true;renderSettings();},recording?'请按组合键 · Esc 取消':shortcutLabel());
    button(box,'恢复默认快捷键',()=>{shortcut='Mod+F';recording=false;persistPrefs();renderSettings();},'默认键');
    button(box,'保存当前结果',saveResult,'保存结果');
    const items=saved(), visible=items.filter(x=>x.session===session);
    if(visible.length){button(box,'清除此会话保存的结果',()=>{const ok=save(win,SAVED,items.filter(x=>x.session!==session));note(ok?'已清除':'清除失败');renderSettings();},'清除已存');}
    for(const item of visible)button(box,'恢复 '+item.query,()=>restore(item),NAMES[item.scope]+' · '+item.query);
  }
  function open(origin='shortcut'){
    if(ui){ui.q.focus();ui.q.select();return;}
    const prefill=String(doc.getSelection()||'').trim().slice(0,512);
    originalFocus=doc.activeElement;session=sessionId();
    const box=element(doc,'section','pf-panel');box.setAttribute('data-pane-find-ui','panel');box.setAttribute('role','search');box.setAttribute('aria-label','页内查找');doc.body.append(box);
    const frame=element(doc,'div','pf-frame');
    for(const c of ['t','l','r','b']){const s=element(doc,'div','pf-dz pf-dz-'+c);s.setAttribute('data-pane-find-ui','drag');s.addEventListener('pointerdown',startDrag);frame.append(s);}
    const body=element(doc,'div','pf-body');box.append(frame,body);
    const row=element(doc,'div','pf-row'), q=element(doc,'input','pf-q');q.type='text';q.placeholder='查找此栏…';q.setAttribute('aria-label','查找内容');q.maxLength=512;q.value=prefill;q.oninput=()=>{note('');syncWidth();queue();};
    const glyph=element(doc,'span','pf-glyph');glyph.setAttribute('data-pane-find-ui','glyph');glyph.innerHTML='<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="8.2" cy="8.2" r="5.5"></circle><path d="m12.5 12.5 4.5 4.5" stroke-linecap="round"></path></svg>';
    const scopes=element(doc,'div','pf-scopes'),count=element(doc,'span','pf-count');count.setAttribute('aria-live','polite');row.append(glyph,q,scopes,count);body.append(row);
    const buttons={};for(const [id,name] of Object.entries(NAMES))buttons[id]=button(scopes,'查找'+name,()=>{preferred=id;persistPrefs();refresh();q.focus();},name);
    const prev=button(row,'上一处',()=>activate(active-1),'↑'), next=button(row,'下一处',()=>activate(active+1),'↓');
    button(row,'查找设置及保存的结果',()=>{ui.settings.hidden=!ui.settings.hidden;recording=false;renderSettings();},'⋯');button(row,'关闭查找',()=>close(),'×');
    const list=element(doc,'div','pf-results'),previewBox=element(doc,'div','pf-preview'),pre=element(doc,'pre');previewBox.hidden=true;previewBox.append(pre);
    const copy=button(previewBox,'复制整条',async()=>{try{await win.navigator.clipboard.writeText(pre.textContent);copy.textContent='已复制';}catch{copy.textContent='复制失败';}});
    const foot=element(doc,'div','pf-foot'),summary=element(doc,'span'),pages=element(doc,'span'),settings=element(doc,'div','pf-settings'),info=element(doc,'div','pf-note');settings.hidden=true;info.setAttribute('role','status');
    const pgPrev=button(pages,'上一批结果',()=>activate(pageStart-PAGE),'‹'),pgNext=button(pages,'下一批结果',()=>activate(pageStart+PAGE),'›');foot.append(summary,pages);body.append(list,previewBox,foot,settings,info);
    ui={box,row,q,buttons,count,prev,next,list,foot,summary,pages,pgPrev,pgNext,settings,note:info,preview:previewBox,pre,copy};result={hits:[],total:0};active=0;
    syncWidth();
    if(origin==='icon'){
      const p=magnifierPos(ui.box.offsetWidth);
      if(p){pos=p;persistPrefs();}
    }
    watch=observePage(doc,refresh);const card=doc.querySelector('[data-composer-card]');if(card && win.ResizeObserver){resize=new win.ResizeObserver(applyPosition);resize.observe(card);}
    win.addEventListener('scroll',onScroll,true);renderSettings();refresh();applyPosition();q.focus();q.select();
  }
  function onKey(e){
    if(e.defaultPrevented || e.isComposing)return;
    const c=combo(e), key=e.key;
    const take=()=>{e.preventDefault();e.stopImmediatePropagation();};
    if(recording && ui){take();if(key==='Escape'){recording=false;}else if(c){shortcut=c;recording=false;persistPrefs();}renderSettings();return;}
    if(c===shortcut){take();open();return;}
    if(!ui)return;
    if(key==='Escape'){take();close();return;}
    if(key==='F3' || c==='Mod+G' || c==='Mod+Shift+G' || (key==='Enter' && e.target===ui.q)){take();if(lastQuery!==ui.q.value)refresh();activate(active+(e.shiftKey?-1:1));}
  }
  win.addEventListener('keydown',onKey,true);
  return {open,close,dispose(){close(false);win.removeEventListener('keydown',onKey,true);}};
}
