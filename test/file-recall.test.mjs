import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFileRecall, uploadsReady } from '../src/file-recall.js';
import { replayPrompt } from '../src/conversation.js';

const valid = () => true;
function attachment(text, name='sample.txt') {
  const bytes=Buffer.from(text);
  const file=new File([bytes], name, {type:'text/plain'});
  const ref={name, bytes:bytes.length, attachmentId:'sha256:'+createHash('sha256').update(bytes).digest('hex')};
  return {file,ref};
}
function store(initial={}) {
  let state=initial;
  const listeners=new Set();
  return {getSnapshot:()=>state, subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},
    publish(value){state=value;for(const fn of listeners)fn();}, subscriptions:()=>listeners.size};
}
function capture(cache, sid, item, upload={status:'ready',receiptId:'original',file:item.ref}) {
  const service={fileUploads:store({d:upload}),resolveDraftAttachments:()=>[{kind:'file',id:'d',file:item.file}]};
  cache.capture(sid,service,['d']);
}

test('admitted File is reusable only in its own session with the original name, size and id',async()=>{
  const a=attachment('中文'), cache=createFileRecall({choose:()=>null});
  capture(cache,'one',a);
  assert.deepEqual(await cache.resolve('one',[a.ref],valid),[a.file]);
  assert.equal(await cache.resolve('two',[a.ref],valid),null);
  assert.equal(await cache.resolve('one',[{...a.ref,name:'other.txt'}],valid),null);
  cache.dispose();assert.equal(await cache.resolve('one',[a.ref],valid),null);
});
test('a cold picker refuses a same-name, same-size file with different bytes',async()=>{
  const a=attachment('abc'), wrong=attachment('xyz');
  const cache=createFileRecall({choose:()=>[wrong.file]});
  await assert.rejects(cache.resolve('s',[a.ref],valid),/内容/);
});
test('cold reselect preserves order and duplicates even when picked in a different order',async()=>{
  const a=attachment('A','a.txt'),b=attachment('B','b.txt');let picks=0;
  const cache=createFileRecall({choose:()=>{picks++;return [b.file,a.file];}});
  const refs=[a.ref,b.ref,a.ref];assert.deepEqual(await cache.resolve('s',refs,valid),[a.file,b.file,a.file]);
  await cache.resolve('s',refs,valid);assert.equal(picks,1);
});
test('pending uploads, evicted entries, missing picker selection and stale choices cannot be replayed',async()=>{
  const a=attachment('aa'), b=attachment('bb','b.txt');const cache=createFileRecall({maxBytes:3,maxEntries:2,choose:()=>null});
  capture(cache,'s',a,{status:'uploading'});assert.equal(await cache.resolve('s',[a.ref],valid),null);
  capture(cache,'s',a);capture(cache,'s',b);assert.equal(await cache.resolve('s',[a.ref],valid),null);
  assert.deepEqual(await cache.resolve('s',[b.ref],valid),[b.file]);
  const incomplete=createFileRecall({choose:()=>[a.file]});await assert.rejects(incomplete.resolve('s',[a.ref,b.ref],valid),/选齐/);
  let live=true;const stale=createFileRecall({choose:()=>{live=false;return [a.file];}});assert.equal(await stale.resolve('s',[a.ref],()=>live),null);
});
test('upload wait uses the matching server receipt and disposes its subscription on every exit',async()=>{
  const a=attachment('aa'); const pairs=[['d',a.ref]];
  for(const [state,want] of [[{status:'ready',file:a.ref},true],[{status:'ready',file:{...a.ref,bytes:3}},false],[{status:'error'},false]]){
    const s=store({d:{status:'uploading'}});const run=uploadsReady(s,pairs,valid,200);assert.equal(s.subscriptions(),1);
    s.publish({d:state});assert.equal(await run,want);assert.equal(s.subscriptions(),0);
  }
  const s=store();assert.equal(await uploadsReady(s,pairs,valid,10),false);assert.equal(s.subscriptions(),0);
});
test('generic-file replay stages actual bytes, waits for host acceptance and submits once',async()=>{
  const a=attachment('a retained file');const cache=createFileRecall({choose:()=>null});capture(cache,'s',a);
  const fileUploads=store();let staged;const stagedPromise=new Promise(resolve=>{staged=resolve;});const submitted=[],garbage=[];
  const service={fileUploads,createDrafts(sid,files){assert.equal(sid,'s');staged(files[0]);return [{id:'copy'}];},releaseDraftAttachments(ds){garbage.push(...ds);}};
  const ctx={get:k=>k==='conversation'?service:{binding:()=>({session:{readAttachment(){assert.fail('image reader called for a file');}}})}};
  const actions={addAttachments:ids=>{submitted.push(ids);return true;},removeAttachment(){},setDraft(t){submitted.push(t);},submit(){submitted.push('sent');}};
  const run=replayPrompt(ctx,'s',[{type:'text',text:'hello'},{type:'file',attachment:a.ref}],actions,valid,cache);
  const file=await stagedPromise;assert.equal(file.name,a.ref.name);assert.equal(await file.text(),'a retained file');assert.deepEqual(submitted,[]);
  fileUploads.publish({copy:{status:'ready',file:a.ref,receiptId:'fresh'}});assert.equal(await run,true);
  assert.deepEqual(submitted,[['copy'],'hello','sent']);assert.deepEqual(garbage,[]);
});
