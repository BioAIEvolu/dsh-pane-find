/*! Adapted chat-node and image helpers from Ernesto-yuan/dsh-conversation-tools, MIT. See licenses/dsh-conversation-tools.txt. */
import {createFileRecall, uploadsReady} from './file-recall.js';
/** Text of user-message wire blocks. */
function textOfContent(content) {
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') text += block.text;
  }
  return text;
}
/** Ordered `{ key, node }` pairs of the Chat snapshot. */
function nodeEntries(snapshot) {
  const entries = [];
  if (snapshot === null || typeof snapshot !== 'object') return entries;
  const nodes = snapshot.nodes;
  if (nodes === undefined || nodes === null || typeof nodes.get !== 'function') return entries;
  const order = snapshot.order;
  const keys = Array.isArray(order) ? order : order !== null && typeof order === 'object' && typeof order[Symbol.iterator] === 'function' ? Array.from(order) : [];
  for (const key of keys) {
    const node = nodes.get(key);
    if (node !== undefined && node !== null && typeof node === 'object') entries.push({ key, node });
  }
  return entries;
}

/** Sequence number used to order nodes. */
function seqOf(node) {
  return typeof node.anchorSeq === 'number' ? node.anchorSeq : 0;
}

/** Durable attachment references carried by one user message. */
function attachmentsOfContent(content) {
  if (!Array.isArray(content)) return [];
  const refs = [];
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue;
    if (block.type !== 'image' && block.type !== 'file') continue;
    const ref = block.attachment;
    if (ref === null || ref === undefined || typeof ref !== 'object') continue;
    if (typeof ref.attachmentId !== 'string') continue;
    // Keep the whole reference: newer hosts verify it against storage and
    // reject a bare id, while older hosts only accept the id string.
    refs.push({ ...ref });
  }
  return refs;
}
export function userHistory(snapshot) {
  const items = [];
  for (const { key, node } of nodeEntries(snapshot)) {
    if (node.kind !== 'user' && node.kind !== 'steering') continue;
    const content = node.data === undefined ? undefined : node.data.content;
    const text = textOfContent(content);
    const attachments = attachmentsOfContent(content);
    if (text === '' && attachments.length === 0) continue;
    items.push({ key, seq: seqOf(node), text, attachments });
  }
  items.sort((left, right) => left.seq - right.seq);
  return items;
}

/** The user prompt that produced one finalized assistant message. */
export function contentForAnswer(snapshot, messageId) {
  const entries = nodeEntries(snapshot);
  const tail = entries.find(({node}) => node.kind === 'turn-tail' && node.data?.closing?.finalNode?.messageId === messageId)?.node;
  if (!tail) return null;
  const seq = tail.data.closing.finalNode.seq ?? seqOf(tail);
  let opening;
  for (const {node} of entries) {
    const opensExchange = node.kind === 'user' || (node.kind === 'steering' && node.groupTree === 'exchange');
    if (!opensExchange || seqOf(node) > seq) continue;
    // RC.5 exposes a TurnLocation object on user rows and a number on turn tails.
    // When the tail has a coordinate, only a proven same-turn opening may be replayed.
    const position = node.location?.turn;
    const turn = typeof position === 'number' ? position : position?.turn ?? node.data?.turn;
    if (tail.data.turn != null && turn !== tail.data.turn) continue;
    if (!opening || seqOf(node) >= seqOf(opening)) opening = node;
  }
  // Preserve the original immutable content (including file-only prompts).
  return opening?.data?.content ?? null;
}
export function promptForMessage(snapshot, messageId) {
  return textOfContent(contentForAnswer(snapshot, messageId));
}

/** Message id of the newest finalized assistant message. */
export function lastAssistantMessageId(snapshot) {
  let last = null;
  let lastSeq = -1;
  for (const { node } of nodeEntries(snapshot)) {
    if (node.kind !== 'turn-tail') continue;
    const closing = node.data === undefined ? undefined : node.data.closing;
    const finalNode = closing === null || closing === undefined ? undefined : closing.finalNode;
    if (finalNode === null || finalNode === undefined || typeof finalNode.messageId !== 'string') continue;
    const seq = typeof finalNode.seq === 'number' ? finalNode.seq : seqOf(node);
    if (seq >= lastSeq) {
      lastSeq = seq;
      last = finalNode.messageId;
    }
  }
  return last;
}
/** Smallest rendered size (px) that counts as content, not an inline icon. */
const IMAGE_MIN_SIZE = 56;

/** The chat image a pointer event sits on, or null. */
function chatImageAt(target) {
  if (target === null || typeof target !== 'object' || typeof target.closest !== 'function') return null;
  const img = target.closest('img');
  if (img === null || img === undefined || typeof img.closest !== 'function') return null;
  if (img.closest('[data-chat-flow],[data-conversation-scroll]') === null) return null;
  const rect = typeof img.getBoundingClientRect === 'function' ? img.getBoundingClientRect() : null;
  if (rect === null || rect.width < IMAGE_MIN_SIZE || rect.height < IMAGE_MIN_SIZE) return null;
  return img;
}

/** Draw into a fresh canvas and resolve the PNG blob. */
function canvasPng(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext('2d');
  if (context === null || context === undefined) throw new Error('canvas 2d context unavailable');
  draw(context);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null || blob === undefined) reject(new Error('canvas.toBlob returned null'));
      else resolve(blob);
    }, 'image/png');
  });
}

/** Read the image bytes, falling back to rasterizing the element. */
async function imageBlob(img) {
  const src = typeof img.currentSrc === 'string' && img.currentSrc !== '' ? img.currentSrc : img.src;
  if (typeof src === 'string' && src !== '') {
    try {
      const address = new URL(src, document.baseURI);
      if (!['http:', 'https:', 'blob:', 'data:'].includes(address.protocol)) throw new Error('unsupported image source');
      const response = await fetch(address, { credentials: 'same-origin', referrerPolicy: 'no-referrer' });
      if (response.ok) {
        const blob = await response.blob();
        if (typeof blob.type === 'string' && blob.type.startsWith('image/')) return blob;
      }
    } catch (error) {
      /* cross-origin or opaque source: rasterize the element instead */
    }
  }
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  if (!width || !height) throw new Error('image has no size yet');
  return canvasPng(width, height, (context) => context.drawImage(img, 0, 0, width, height));
}

/** Convert any image blob to PNG, which is what the clipboard accepts. */
async function pngBlob(blob) {
  if (blob.type === 'image/png') return blob;
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    try {
      return await canvasPng(bitmap.width, bitmap.height, (context) => context.drawImage(bitmap, 0, 0));
    } finally {
      if (typeof bitmap.close === 'function') bitmap.close();
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('image could not be decoded'));
      element.src = url;
    });
    return await canvasPng(image.naturalWidth, image.naturalHeight, (context) => context.drawImage(image, 0, 0));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Copy one chat image into the clipboard as PNG. */
async function copyImage(img) {
  if (navigator.clipboard === undefined || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem !== 'function') {
    throw new Error('this browser cannot write images to the clipboard');
  }
  const png = await pngBlob(await imageBlob(img));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/**
 * Hover affordance over conversation images: a small button that copies the
 * image under the pointer to the clipboard. Imperative because the images
 * belong to the host's renderer, not to a slot this bundle owns.
 * @param translate - namespace-bound translator.
 * @returns disposer removing the button and every listener.
 */
function installImageCopy(translate) {
  if (typeof document === 'undefined' || document.body === null) return () => {};
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pf-img';
  button.setAttribute('data-pane-find-ui','image');
  button.hidden = true;
  button.setAttribute('aria-label', translate('image.copy'));
  const label = document.createElement('span');
  label.textContent = translate('image.copy');
  button.appendChild(label);
  document.body.appendChild(button);

  let hovered = null;
  let hideTimer = 0;
  let labelTimer = 0;
  let busy = false;

  const clearHide = () => { if (hideTimer) { window.clearTimeout(hideTimer); hideTimer = 0; } };
  const hide = () => { clearHide(); hovered = null; button.hidden = true; };
  const scheduleHide = () => { clearHide(); hideTimer = window.setTimeout(hide, 180); };

  const resetLabel = () => {
    label.textContent = translate('image.copy');
    button.classList.remove('pf-img-failed');
  };
  const flash = (text, failed) => {
    if (labelTimer) window.clearTimeout(labelTimer);
    label.textContent = text;
    button.classList.toggle('pf-img-failed', failed === true);
    labelTimer = window.setTimeout(resetLabel, 1400);
  };

  const place = (img) => {
    const rect = img.getBoundingClientRect();
    const width = button.offsetWidth || 96;
    const left = Math.min(Math.max(6, window.innerWidth - width - 6), Math.max(6, rect.right - width - 8));
    button.style.left = left + 'px';
    button.style.top = Math.max(6, rect.top + 8) + 'px';
  };

  let pointer = null;
  const show = (img) => { clearHide(); hovered = img; button.hidden = false; place(img); };

  const onOver = (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (busy) return;
    const img = chatImageAt(event.target);
    if (img === null) return;
    if (img === hovered) clearHide();
    else show(img);
  };
  const onOut = (event) => {
    if (hovered === null) return;
    if (button.contains(event.target) === true) { scheduleHide(); return; }
    const related = event.relatedTarget;
    if (related !== null && related !== undefined) {
      if (related === hovered || button.contains(related) === true) return;
      if (typeof related.closest === 'function' && related.closest('img') === hovered) return;
    }
    if (chatImageAt(event.target) === hovered) scheduleHide();
  };
  const onLeaveWindow = (event) => {
    if (!event.relatedTarget && (event.target === document || event.target === document.documentElement)) scheduleHide();
  };
  const onScrollOrResize = () => {
    if (!hovered || !pointer) return;
    const target = document.elementFromPoint(pointer.x, pointer.y);
    if (target === hovered || button.contains(target)) place(hovered);
    else hide();
  };
  const onButtonClick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy || hovered === null) return;
    const img = hovered;
    busy = true;
    try {
      await copyImage(img);
      flash(translate('image.copied'), false);
    } catch (error) {
      // The visible button reports clipboard denial or an unreadable image.
      flash(translate('image.failed'), true);
    } finally {
      busy = false;
    }
  };

  document.addEventListener('pointerover', onOver, true);
  document.addEventListener('pointermove', onOver, true);
  document.addEventListener('pointerout', onOut, true);
  document.addEventListener('pointerleave', onLeaveWindow, true);
  document.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);
  button.addEventListener('pointerenter', clearHide);
  button.addEventListener('pointerleave', scheduleHide);
  button.addEventListener('click', onButtonClick);

  return () => {
    if (hideTimer) window.clearTimeout(hideTimer);
    if (labelTimer) window.clearTimeout(labelTimer);
    document.removeEventListener('pointerover', onOver, true);
    document.removeEventListener('pointermove', onOver, true);
    document.removeEventListener('pointerout', onOut, true);
    document.removeEventListener('pointerleave', onLeaveWindow, true);
    document.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize);
    button.remove();
  };
}

export async function restoreFiles(ctx, sessionId, references, actions, valid, requireAll = false, recall) {
  if (requireAll && references.length > 6) return [];
  const service = ctx.get('conversation');
  if (!service?.createDrafts || !actions?.addAttachments || !valid()) return [];
  const selected = references.slice(0, 6);
  const ordinary = selected.filter(ref => !ref.mediaType);
  const originals = ordinary.length && recall ? await recall.resolve(sessionId,ordinary,valid) : null;
  if (!valid() || (requireAll && ordinary.length && originals?.length !== ordinary.length)) return [];
  const session = ctx.get('sessions')?.binding?.(sessionId)?.session;
  const files = [], pending = [];
  let ordinaryIndex = 0;
  for (const ref of selected) {
    if (!valid()) return [];
    if (!ref.mediaType) {
      const file = originals?.[ordinaryIndex++];
      if (file) {
        pending.push([files.length,ref]);
        // FileAttachmentRef denotes verbatim bytes, even if a picker inferred an image MIME.
        files.push(new File([file],ref.name,{type:'application/octet-stream'}));
      }
      continue;
    }
    try {
      const result = await session?.readAttachment?.(ref);
      if (result?.ok && result.value?.data != null) {
        const meta = result.value.attachment || ref;
        files.push(new File([Uint8Array.from(result.value.data)],meta.name || 'attachment',{type:meta.mediaType}));
      }
    } catch { /* Unavailable historical image. Full replay requires every original. */ }
  }
  if (!valid() || !files.length || (requireAll && files.length !== references.length)) return [];
  const drafts = service.createDrafts(sessionId,files,false);
  let admitted = false;
  try {
    if (drafts.length !== files.length) return [];
    const ids = drafts.map(d=>d.id);
    if (pending.length && !await uploadsReady(service.fileUploads,pending.map(([index,ref])=>[ids[index],ref]),valid)) return [];
    admitted = valid() && actions.addAttachments(ids) === true;
    return admitted ? ids : [];
  } finally {
    if (!admitted) service.releaseDraftAttachments?.(drafts);
  }
}
// A partial replay would ask a different question. Leave the original turn and draft alone.
export async function replayPrompt(ctx, sessionId, content, actions, valid, recall) {
  if (!Array.isArray(content) || !valid([])) return false;
  if (content.some(block => !block || !(block.type === 'text' || (['image','file'].includes(block.type) && block.attachment?.attachmentId)))) return false;
  const refs = attachmentsOfContent(content), text = textOfContent(content);
  if (!text.trim() && !refs.length) return false;
  const ids = refs.length ? await restoreFiles(ctx,sessionId,refs,actions,()=>valid([]),true,recall) : [];
  if (ids.length !== refs.length || !valid(ids)) {
    for (const id of ids) actions.removeAttachment(id);
    return false;
  }
  actions.setDraft(text);
  actions.submit();
  return true;
}
function allowRecallTarget(target,sid) {
  if (!target?.isContentEditable) return false;
  const card = target.closest('[data-composer-card]');
  if (!card) return false;
  const root = card.closest('[data-conversation-session]') || document.querySelector('[data-conversation-session]');
  return root?.getAttribute('data-conversation-session') === sid;
}
export function nextHistory(cursor, history, draft, step) {
  if (!history.length || (!cursor && (step>0 || draft!=='')) || (cursor && draft!==cursor.text)) return null;
  const pos = cursor ? history.findIndex(entry=>entry.key===cursor.key) : history.length;
  if (pos<0 || pos+step<0) return null;
  return {entry:history[pos+step] || null};
}
export function contribute(slots, name, id, order, component) {
  slots.inject(name, ()=>slots.register({name,id:'pane-find-'+id,order}, component));
}
export function installConversation(ctx, React) {
  const slots = ctx.get('slots'), h = React.createElement;
  const locks = new WeakMap();
  const recall = createFileRecall();
  ctx.effect(() => () => recall.dispose(), 'pane-find session file references');
  const status = { 'image.copy':'复制图片','image.copied':'已复制图片','image.failed':'复制失败' };
  ctx.effect(()=>installImageCopy(k=>status[k]), 'pane-find image clipboard');
  function History(props) {
    // Subscribe to stable store values. Deriving a new history array in the selector
    // would create a new snapshot on every read in React useSyncExternalStore.
    const order = props.useChat(s=>s.order), nodes = props.useChat(s=>s.nodes);
    const history = userHistory({order,nodes});
    const input = props.useInput(s=>s);
    const latest = React.useRef();
    latest.current = {history,input};
    const [notice,setNotice] = React.useState('');
    React.useEffect(()=>{
      const ids=input.attachmentIds, sid=props.sessionId, service=ctx.get('conversation');
      if (!ids?.length || !service?.fileUploads?.subscribe) return;
      const capture=()=>recall.capture(sid,service,ids);
      const unsubscribe=service.fileUploads.subscribe(capture);
      capture();
      return unsubscribe;
    },[props.sessionId,input.attachmentIds]);
    React.useEffect(()=>{
      const actions = props.inputActions, sid = props.sessionId;
      let cursor = null, generation = 0, disposed = false, added = [];
      function drop() { for (const id of added) actions.removeAttachment(id); added=[]; }
      function onInput(e) { if (allowRecallTarget(e.target,sid)) { generation++;cursor=null;added=[];setNotice(''); } }
      function onKey(e) {
        if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (e.key!=='ArrowUp' && e.key!=='ArrowDown') return;
        if (!allowRecallTarget(e.target,sid)) return;
        const {input,history} = latest.current;
        if(input.phase!=='plain' || (!cursor && input.attachmentIds?.length)) return;
        const move = nextHistory(cursor,history,input.draft,e.key==='ArrowUp'?-1:1);
        if(!move) return;
        e.preventDefault(); e.stopImmediatePropagation();
        const gen=++generation, entry=move.entry;
        setNotice('');
        if (!entry?.attachments.length) { drop(); cursor=entry; actions.setDraft(entry?.text||''); return; }
        const original=input.draft, revision=input.draftRev, prevIds=input.attachmentIds||[];
        const valid=(extra=[])=>{
          const live=latest.current.input;
          return !disposed && generation===gen && live.phase==='plain' && live.draft===original && live.draftRev===revision &&
            (live.attachmentIds||[]).every(id=>prevIds.includes(id)||extra.includes(id)) && prevIds.every(id=>(live.attachmentIds||[]).includes(id));
        };
        setNotice('正在取回原附件…');
        void restoreFiles(ctx,sid,entry.attachments,actions,valid,true,recall).then(ids=>{
          if (!valid(ids)) { for (const id of ids) actions.removeAttachment(id); return; }
          if (ids.length!==entry.attachments.length) { setNotice('附件未完整取回，请重新选择原文件。'); return; }
          drop(); cursor=entry; added=ids; actions.setDraft(entry.text); setNotice('');
        }).catch(error=>{if(valid()) setNotice(error?.message || '附件未能取回。');});
      }
      document.addEventListener('input',onInput,true);
      document.addEventListener('keydown',onKey,true);
      return ()=>{disposed=true;generation++;document.removeEventListener('input',onInput,true);document.removeEventListener('keydown',onKey,true);};
    },[props.sessionId,props.inputActions]);
    return notice ? h('span',{'data-pane-find-ui':'file-status',role:'status'},notice) : null;
  }
  function Actions(props) {
    const content = props.useChat(s=>contentForAnswer(s,props.messageId));
    const last = props.useChat(lastAssistantMessageId);
    const input = props.useInput(s=>s);
    const running = props.useSession(s=>s.running === true);
    const actions = props.inputActions;
    const [notice,setNotice] = React.useState('');
    const view = React.useRef();
    view.current = {input,running,session:props.sessionId};
    React.useEffect(()=>()=>{view.current=null;},[props.sessionId]);
    const busy = running || input.phase!=='plain' || !!input.draft || !!input.attachmentIds?.length;
    function button(label, blocks) {
      return h('button',{type:'button',className:'pf-action','data-pane-find-ui':'action',disabled:busy,
        title:busy ? '请先完成当前输入或等待回答结束' : label,
        onClick:async()=>{
          const gate = locks.get(actions);
          if (busy || gate?.inFlight || (gate?.lastAnswer === last && gate?.until > Date.now())) return;
          const sid=props.sessionId, rev=view.current?.input.draftRev;
          const valid=ids=>{
            const v=view.current;
            return !!v && v.session===sid && !v.running && v.input.phase==='plain' && !v.input.draft && v.input.draftRev===rev && (v.input.attachmentIds || []).every(id=>ids.includes(id));
          };
          // Attachment reads share a single in-flight slot. Once the host settles a new
          // answer, actions on that exchange can proceed immediately, even in a fast local run.
          locks.set(actions, {inFlight:true});
          let sent = false;
          try {
            setNotice('');
            sent = await replayPrompt(ctx,sid,blocks,actions,valid,recall);
            if (!sent && view.current?.session === sid) setNotice('未发送：请检查原附件和当前草稿');
          } catch { if(view.current?.session===sid) setNotice('提交失败，请检查当前草稿'); }
          finally {
            if (sent) locks.set(actions, {lastAnswer:last, until:Date.now()+650});
            else locks.delete(actions);
          }
        }},label);
    }
    return h(React.Fragment,null,content ? button('重新生成',content):null,
      last && last===props.messageId ? button('继续生成',[{type:'text',text:'继续'}]):null,
      notice ? h('span',{'data-pane-find-ui':'notice',role:'status'},notice):null);
  }
  contribute(slots,'conversation.input.dock','history',40,History);
  contribute(slots,'conversation.chat.assistant-actions','actions',21,Actions);
}
