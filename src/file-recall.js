// Generic files in RC.5 have a content-addressed receipt. Session.readAttachment is for images.
const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 32;
const fileRef = ref => typeof ref?.name === 'string' && ref.name.length > 0 && !ref.mediaType &&
  Number.isSafeInteger(ref.bytes) && ref.bytes >= 0 && /^sha256:[0-9a-f]{64}$/.test(ref.attachmentId);
const identity = ref => JSON.stringify([ref.attachmentId, ref.name, ref.bytes]);
const matches = (file, ref) => file?.name === ref.name && file?.size === ref.bytes;

export function createFileRecall({maxBytes = MAX_BYTES, maxEntries = MAX_ENTRIES, choose = chooseOriginals} = {}) {
  const entries = new Map();
  let retained = 0, disposed = false;
  const key = (sid, ref) => JSON.stringify([sid, identity(ref)]);
  function remember(sid, ref, file) {
    if (disposed || !sid || !fileRef(ref) || !matches(file,ref) || file.size > maxBytes) return;
    const id = key(sid,ref);
    if (entries.has(id)) { retained -= entries.get(id).size; entries.delete(id); }
    entries.set(id,file); retained += file.size;
    while (entries.size > maxEntries || retained > maxBytes) {
      const oldest = entries.keys().next().value;
      retained -= entries.get(oldest).size; entries.delete(oldest);
    }
  }
  return {
    capture(sid, service, ids) {
      if (!ids?.length || !service?.resolveDraftAttachments || !service.fileUploads?.getSnapshot) return;
      const uploads = service.fileUploads.getSnapshot();
      for (const draft of service.resolveDraftAttachments(ids)) {
        const state = uploads[draft.id];
        if (draft.kind === 'file' && state?.status === 'ready') remember(sid, state.file, draft.file);
      }
    },
    async resolve(sid, refs, valid) {
      const current = () => !disposed && valid();
      if (!sid || !current() || refs.some(ref=>!fileRef(ref))) return null;
      const files = new Map(), missing = new Map();
      for (const ref of refs) {
        const id = identity(ref), file = entries.get(key(sid,ref));
        if (file) files.set(id,file); else missing.set(id,ref);
      }
      if (missing.size) {
        const required = [...missing.values()];
        if (required.some(ref=>ref.bytes > maxBytes)) throw Error('附件超出恢复容量，请在输入框重新添加。');
        const selected = await choose(required, current);
        if (!current() || !selected) return null;
        // Verify locally before any reselected bytes reach the upload service.
        const pending = new Map(missing);
        for (const file of selected) {
          const candidates = [...pending.values()].filter(ref=>matches(file,ref));
          if (!candidates.length) throw Error('所选文件的名称或大小与原附件不同。');
          const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()));
          if (!current()) return null;
          const digest = 'sha256:'+Array.from(hash,n=>n.toString(16).padStart(2,'0')).join('');
          const ref = candidates.find(r=>r.attachmentId === digest);
          if (!ref) throw Error('所选文件的内容与原附件不同。');
          pending.delete(identity(ref)); files.set(identity(ref),file);
        }
        if (pending.size) throw Error('请选齐列出的原附件。');
        for (const ref of required) remember(sid,ref,files.get(identity(ref)));
      }
      return current() ? refs.map(ref=>files.get(identity(ref))) : null;
    },
    dispose() { disposed = true; entries.clear(); retained = 0; },
  };
}

// Await exactly the newly created file drafts. Never consume a handle to a different upload.
export function uploadsReady(store, pairs, valid, timeoutMs = 30000) {
  if (!pairs.length) return Promise.resolve(valid());
  if (!store?.getSnapshot || !store.subscribe) return Promise.resolve(false);
  return new Promise(resolve => {
    let done = false, unsubscribe, tick, deadline;
    const finish = value => {
      if (done) return;
      done = true; clearInterval(tick); clearTimeout(deadline); unsubscribe?.(); resolve(value);
    };
    function check() {
      try {
        if (!valid()) { finish(false); return; }
        const snapshot = store.getSnapshot();
        let ready = true;
        for (const [id, expected] of pairs) {
          const state = snapshot[id];
          if (state?.status === 'error') { finish(false); return; }
          if (state?.status !== 'ready') {ready=false; continue;}
          if (!fileRef(state.file) || identity(state.file)!==identity(expected)) { finish(false); return; }
        }
        if (ready) finish(true);
      } catch { finish(false); }
    }
    tick = setInterval(check,150); deadline = setTimeout(()=>finish(false),timeoutMs);
    try { unsubscribe=store.subscribe(check); if(done) unsubscribe?.(); else check(); }
    catch { finish(false); }
  });
}

function chooseOriginals(refs, valid) {
  if (!globalThis.document?.body || !valid()) return Promise.resolve(null);
  return new Promise(resolve => {
    const doc=document, dialog=doc.createElement('dialog');
    const title=doc.createElement('strong'), list=doc.createElement('ul'), picker=doc.createElement('input'), cancel=doc.createElement('button');
    dialog.setAttribute('data-pane-find-ui','file-reselect');dialog.setAttribute('aria-label','重新选择原附件');
    dialog.style.cssText='max-width:min(28rem,90vw);max-height:70vh;overflow:auto;padding:16px;border:1px solid var(--dsw-alias-border-l2,GrayText);border-radius:10px;background:var(--dsw-alias-bg-overlay,Canvas);color:var(--dsw-alias-label-primary,CanvasText);font:inherit';
    title.textContent='重新选择原附件';
    for (const ref of refs) {const row=doc.createElement('li');row.textContent=ref.name+' · '+ref.bytes+' 字节';list.append(row);}
    picker.type='file';picker.multiple=refs.length>1;picker.setAttribute('aria-label','选择原文件');
    cancel.textContent='取消';cancel.type='button';
    dialog.append(title,list,picker,cancel);doc.body.append(dialog);
    let timer, deadline, done=false;
    const finish = selected => {
      if(done)return;done=true;clearInterval(timer);clearTimeout(deadline);
      if(dialog.open)dialog.close();dialog.remove();resolve(selected);
    };
    picker.onchange=()=>finish(Array.from(picker.files||[]));cancel.onclick=()=>finish(null);
    dialog.oncancel=e=>{e.preventDefault();finish(null);};dialog.onclose=()=>finish(null);
    timer=setInterval(()=>{if(!valid())finish(null);},200);deadline=setTimeout(()=>finish(null),120000);
    try {dialog.showModal();} catch {finish(null);}
  });
}
