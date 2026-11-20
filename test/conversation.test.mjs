import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installConversation, userHistory, promptForMessage, contentForAnswer, replayPrompt, lastAssistantMessageId, nextHistory, restoreFiles } from '../src/conversation.js';

const node = (kind, anchorSeq, data) => ({kind,anchorSeq,data});
const text = text => ({type:'text',text});
const image = {attachmentId:'img-12',mediaType:'image/png',name:'example.png'};
const nodes = new Map([
 ['u1',node('user',1,{content:[text('first')]})],['u2',node('user',7,{content:[text('second'),{type:'image',attachment:image}]})],
 ['a1',node('turn-tail',6,{closing:{finalNode:{seq:4,messageId:'A'}}})],['a2',node('turn-tail',10,{closing:{finalNode:{seq:9,messageId:'B'}}})],
 ['s3',node('steering',12,{content:[text('steering')]})],['ctx',node('context',13,{content:[text('not user input')]})],
 ['u4',node('user',15,{content:[{type:'file',attachment:image}]})]
]);
const snapshot={order:[...nodes.keys()],nodes};
test('history keeps steering, full attachment refs, attachment-only turns and chronological order',()=>{
 const h=userHistory(snapshot);assert.deepEqual(h.map(row=>row.key),['u1','u2','s3','u4']);assert.deepEqual(h[1].attachments,[image]);assert.equal(h[3].text,'');
});
test('regenerate maps each completed answer to its own prompt; only last answer continues',()=>{
 assert.equal(promptForMessage(snapshot,'A'),'first');assert.equal(promptForMessage(snapshot,'B'),'second');assert.equal(promptForMessage(snapshot,'missing'),'');assert.equal(lastAssistantMessageId(snapshot),'B');assert.equal(lastAssistantMessageId(null),null);
});
test('RC.5 nested turn and step locations bind each final answer to its own opening question', () => {
  const first = [text('first host turn')];
  const second = [text('second host turn')];
  const located = (kind, seq, data, turn) => ({...node(kind,seq,data), location:{kind:'step',turn:{turn},step:{step:1}}});
  const map = new Map([
    ['u1', located('user', 3, {content:first}, 1)],
    ['a1', node('turn-tail', 10.1, {turn:1,closing:{finalNode:{messageId:'aa',seq:9}}})],
    ['u2', located('user', 15, {content:second}, 2)],
    ['a2', node('turn-tail', 22.1, {turn:2,closing:{finalNode:{messageId:'ab',seq:21}}})],
  ]);
  const snap={nodes:map,order:[...map.keys()]};
  assert.equal(contentForAnswer(snap,'aa'),first);
  assert.equal(contentForAnswer(snap,'ab'),second);
  map.set('steer', {...located('steering',17,{content:[text('steering addition')]},2),groupTree:'input'});
  snap.order.push('steer');
  assert.equal(contentForAnswer(snap,'ab'),second,'mid-turn steering must not replace the opening');
  map.set('u2',{...located('steering',15,{content:second},2),groupTree:'exchange'});
  assert.equal(contentForAnswer(snap,'ab'),second,'step-one steering can open an exchange');
  map.delete('u2');
  assert.equal(contentForAnswer(snap,'ab'),null,'earlier question must not be sent for an unloaded opening');
  map.set('u2', {...node('user',15,{content:second}),location:{kind:'unresolved'}});
  assert.equal(contentForAnswer(snap,'ab'),null,'unresolved coordinates cannot prove turn membership');
});
test('up starts from empty only, down returns to empty, edited recall remains editable',()=>{
 const h=userHistory(snapshot).slice(0,2);assert.equal(nextHistory(null,h,'occupied',-1),null);assert.equal(nextHistory(null,h,'',1),null);const last=nextHistory(null,h,'',-1).entry;assert.equal(last.key,'u2');assert.equal(nextHistory(last,h,'second',-1).entry.key,'u1');assert.equal(nextHistory(last,h,'second',1).entry,null);assert.equal(nextHistory(last,h,'my edit',-1),null);
});
test('file-only prompt stays associated with the correct turn instead of falling back',()=>{
 const copy=new Map(nodes);copy.set('a3',node('turn-tail',20,{closing:{finalNode:{seq:19,messageId:'C'}}}));
 const s={order:[...copy.keys()],nodes:copy};assert.equal(promptForMessage(s,'C'),'');assert.deepEqual(contentForAnswer(s,'C'),[{type:'file',attachment:image}]);
});
test('replaying a file-only prompt sends all refs exactly once',async()=>{
 const h=host(),calls=[];const a={...h.actions,setDraft:t=>calls.push(['draft',t]),submit:()=>calls.push(['send'])};
 assert.equal(await replayPrompt(h.ctx,'S',[{type:'image',attachment:image}],a,()=>true),true);assert.deepEqual(h.added,['d0']);assert.deepEqual(calls,[['draft',''],['send']]);
});
test('missing, unrecognized or over-budget attachment prevents partial resend',async()=>{
 const h=host({read:async()=>({ok:false})}),calls=[];const a={...h.actions,setDraft:t=>calls.push(t),submit:()=>calls.push('send')};
 for(const content of [[text('first'),{type:'image',attachment:image}],[text('first'),{type:'file'}],Array(7).fill({type:'image',attachment:image})])assert.equal(await replayPrompt(h.ctx,'S',content,a,()=>true),false);assert.deepEqual(calls,[]);
});
function host({read=async ref=>({ok:true,value:{attachment:ref,data:[5,3,1]}}),accept=true}={}) {
 const reads=[],files=[],released=[],added=[];
 const binding={session:{readAttachment:ref=>{reads.push(ref);return read(ref);}}};
 const service={createDrafts(sid,list){assert.equal(sid,'S');files.push(...list);return list.map((_,i)=>({id:'d'+i}));},releaseDraftAttachments(list){released.push(...list);}};
 return {ctx:{get:name=>name==='sessions'?{binding:()=>binding}:service},actions:{addAttachments(ids){added.push(...ids);return accept;}},reads,files,added,released};
}
test('same-turn double clicks send once, then the new answer accepts continue immediately', async t => {
  t.mock.method(Date, 'now', () => 125_000);
  const components = new Map();
  const slots = { inject(name, register) { register(); }, register({ id }, component) { components.set(id,component); } };
  const React = {
    Fragment: Symbol('fragment'),
    createElement: (type, props, ...children) => ({type, props, children}),
    useState: value => [value, () => {}], useRef: () => ({}), useEffect() {},
  };
  installConversation({get: () => slots, effect() {}}, React);
  const rows = new Map(nodes);
  const chat = {order: [...rows.keys()], nodes: rows};
  const input = {phase:'plain', draft:'', draftRev:0, attachmentIds:[]};
  const sends = [];
  const actions = {
    setDraft(value) { input.draft = value; input.draftRev++; },
    submit() { sends.push(input.draft); this.setDraft(''); },
  };
  function buttonFor(messageId, label) {
    const props = {messageId, sessionId:'S', inputActions:actions,
      useChat: select => select(chat), useInput: select => select(input), useSession: select => select({running:false})};
    const footer = components.get('pane-find-actions')(props);
    return footer.children.find(child => child?.children?.[0] === label).props.onClick;
  }
  const replay = buttonFor('A','重新生成');
  const pending = replay();
  await replay();
  await pending;
  await replay();
  assert.deepEqual(sends,['first']);
  rows.set('reply-after-replay',node('turn-tail',24,{closing:{finalNode:{seq:23,messageId:'C'}}}));
  chat.order.push('reply-after-replay');
  await buttonFor('C','继续生成')();
  assert.deepEqual(sends,['first','继续']);
});
test('RC.5 full reference produces actual File bytes and cap six',async()=>{
 const h=host();const ids=await restoreFiles(h.ctx,'S',Array(9).fill(image),h.actions,()=>true);assert.equal(ids.length,6);assert.equal(h.reads.length,6);assert.deepEqual(h.reads[0],image);assert.equal(h.files[0].name,image.name);assert.deepEqual([...new Uint8Array(await h.files[0].arrayBuffer())],[5,3,1]);assert.equal(h.files[0].type,'image/png');
});
test('changing session/entry while bytes are in flight admits no stale file',async()=>{
 let release,valid=true;const h=host({read:()=>new Promise(resolve=>{release=resolve;})});const run=restoreFiles(h.ctx,'S',[image],h.actions,()=>valid);valid=false;release({ok:true,value:{attachment:image,data:[1]}});assert.deepEqual(await run,[]);assert.deepEqual(h.added,[]);assert.equal(h.files.length,0);
});
test('composer admission refusal releases owned files',async()=>{
 const h=host({accept:false});assert.deepEqual(await restoreFiles(h.ctx,'S',[image],h.actions,()=>true),[]);assert.deepEqual(h.released,[{id:'d0'}]);
});
test('missing stored attachment adds nothing, remaining valid refs still recover',async()=>{
 const h=host({read:async r=>r.attachmentId===image.attachmentId?{ok:true,value:{data:[8]}}:{ok:false}});assert.deepEqual(await restoreFiles(h.ctx,'S',[{attachmentId:'missing'},image],h.actions,()=>true),['d0']);
});
