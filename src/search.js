// The painted Range and the persisted locator both originate in the same rendered block.
const ROW = '[data-chat-node-key],[data-chat-anchor-key]';
const SKIP = 'script,style,noscript,template,iframe,canvas,svg,textarea,input,select,[contenteditable]:not([contenteditable="false"]),[data-composer-card],[data-pane-find-ui],[aria-hidden="true"],[hidden],[inert]';
export const ALL = 'dsh-pane-find-all', CURRENT = 'dsh-pane-find-current';
const ids = new WeakMap();
let sequence = 0;
function elementId(el) {
  if (!ids.has(el)) ids.set(el, ++sequence);
  return ids.get(el);
}
function shown(el) {
  if (!el || el.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
  const box = el.getBoundingClientRect();
  if (!box.width || !box.height) return false;
  return !el.checkVisibility || el.checkVisibility({visibilityProperty:true, opacityProperty:true});
}
function firstVisible(root, selector) {
  return Array.from(root.querySelectorAll(selector)).find(shown) || null;
}
export function getScopes(doc) {
  const rightCol = doc.querySelector('[data-rightbar-col]');
  const frame = rightCol?.parentElement;
  const full = frame?.hasAttribute('data-rightbar-fullscreen');
  const right = rightCol && (full || !frame?.hasAttribute('data-rightbar-collapsed')) && shown(rightCol) ? rightCol : null;
  const centerCol = rightCol?.previousElementSibling;
  const center = full ? null : firstVisible(centerCol || doc, '[data-conversation-scroll]') || (shown(centerCol) ? centerCol : null);
  let left = firstVisible(doc, '[data-sidebar-col],[data-leftbar-col],[data-workspace-sidebar],[data-slot="sidebar.left"],aside[aria-label]');
  if (left && (rightCol?.contains(left) || centerCol?.contains(left))) left = null;
  // Desktop AppFrame also ships a wide sidebar without a public data attribute.
  if (!left && centerCol) {
    for (let el = centerCol.previousElementSibling; el; el = el.previousElementSibling) {
      if (shown(el) && el.getBoundingClientRect().width > 32 && (el.children.length || el.innerText?.trim())) { left = el; break; }
    }
  }
  if (full || frame?.hasAttribute('data-sidebar-collapsed')) left = null;
  if (left && center && (left === center || left.contains(center))) left = null;
  // 侧栏 = 对话之外的所有可见边栏区域；互相重叠的根只保留最外层一个，避免同一块内容重复计数
  const roots = [];
  for (const el of [left, right]) {
    if (!el) continue;
    if (roots.some(r => r === el || r.contains(el))) continue;
    for (let i = roots.length - 1; i >= 0; i--) if (el.contains(roots[i])) roots.splice(i, 1);
    roots.push(el);
  }
  return {center, side: roots.length ? roots : null};
}
export function literalPattern(query) {
  if (!query) return null;
  const escaped = Array.from(query, ch => '^$\\.*+?()[]{}|'.includes(ch) ? '\\' + ch : ch).join('');
  return new RegExp(escaped, 'giu');
}
function nestedText(root) {
  const groups = [], shadows = [], messages = new Map();
  let group = null;
  function visit(node, block, row) {
    if (node.nodeType === 3) {
      if (!node.data) return;
      if (!group || group.block !== block || group.row !== row) {
        group = {block, row, nodes:[], length:0, parts:[]};
        groups.push(group);
        if (row) {
          if (!messages.has(row)) messages.set(row, []);
          messages.get(row).push(group);
        }
      }
      group.nodes.push({node, base:group.length});
      group.parts.push(node.data);
      group.length += node.data.length;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.matches(SKIP)) { group = null; return; }
    const style = node.ownerDocument.defaultView.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.contentVisibility === 'hidden' || style.opacity === '0') { group = null; return; }
    if (node.tagName === 'BR' || node.tagName === 'HR') { group = null; return; }
    const isBlock = !['inline','contents','inline-block','inline-flex'].includes(style.display);
    const nextBlock = isBlock ? node : block;
    const nextRow = node.matches(ROW) ? node : row;
    if (isBlock || nextRow !== row) group = null;
    if (node.shadowRoot) {
      group = null;
      shadows.push(node.shadowRoot);
      node.shadowRoot.childNodes.forEach(child => visit(child, node, nextRow));
      group = null;
    } else if (node.localName === 'slot' && node.getRootNode()?.host) {
      group = null;
      const assigned = node.assignedNodes({flatten:true});
      (assigned.length ? assigned : node.childNodes).forEach(child => visit(child, node, nextRow));
      group = null;
    } else if (node.tagName === 'DETAILS' && !node.open) {
      const summary = Array.from(node.children).find(child => child.tagName === 'SUMMARY');
      if (summary) visit(summary, node, nextRow);
    } else node.childNodes.forEach(child => visit(child, nextBlock, nextRow));
    if (isBlock) group = null;
  }
  if (root) visit(root, root, null);
  for (const group of groups) group.text = group.parts.join('');
  return {groups, messages, shadows};
}
function at(nodes, offset) {
  let lo = 0, hi = nodes.length;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (nodes[mid].base <= offset) lo = mid; else hi = mid;
  }
  return nodes[lo];
}
export function searchScope(root, query, {limit = 5000} = {}) {
  const hits = [], occurrences = new Map(), previews = new Map(), shadows = [];
  let total = 0;
  const pattern = literalPattern(query);
  for (const scope of Array.isArray(root) ? root : [root]) {
    if (!scope || !pattern) continue;
    const {groups,messages,shadows:more} = nestedText(scope);
    shadows.push(...more);
    for (const group of groups) {
    const owner = group.row || group.block;
    const identity = owner.getAttribute('data-chat-node-key') || owner.getAttribute('data-chat-anchor-key') || owner.id;
    const anchor = identity ? 'k:' + identity : 'e:' + elementId(owner);
    for (const match of group.text.matchAll(pattern)) {
      total++;
      if (hits.length >= limit) continue;
      const index = match.index, end = index + match[0].length;
      const first = at(group.nodes, index), last = at(group.nodes, end - 1);
      if (first.node.getRootNode() !== last.node.getRootNode()) continue;
      const range = scope.ownerDocument.createRange();
      range.setStart(first.node, index - first.base);
      range.setEnd(last.node, end - last.base);
      const ordinal = occurrences.get(anchor) || 0;
      occurrences.set(anchor, ordinal + 1);
      if (!previews.has(owner)) previews.set(owner, group.row ? messages.get(owner).map(g => g.text).join('\n').trim() : group.text.trim());
      const excerpt = group.text.slice(Math.max(0,index-32), end+48).trim();
      hits.push({key:JSON.stringify([anchor,ordinal]), durable:!!identity, range, excerpt, fullText:previews.get(owner)});
    }
  }
  }
  return {total,hits,shadows};
}
const fallback = new WeakMap();
const shadowStyles = new WeakMap();
export const highlightCSS = '::highlight('+ALL+'){background-color:#ffe194;color:#302200}::highlight('+CURRENT+'){background-color:#ed8b32;color:#211400}';
export function clearHighlights(doc) {
  const registry = doc.defaultView.CSS?.highlights;
  registry?.delete(CURRENT); registry?.delete(ALL);
  const selection = doc.getSelection();
  if (fallback.get(doc) && selection?.rangeCount && selection.getRangeAt(0) === fallback.get(doc)) selection.removeAllRanges();
  fallback.delete(doc);
  for (const style of shadowStyles.get(doc) || []) style.remove();
  shadowStyles.delete(doc);
}
export function paintHits(doc,hits,activeIndex) {
  const win = doc.defaultView, active = hits[activeIndex];
  if (!win.CSS?.highlights || !win.Highlight) {
    if (!active) clearHighlights(doc);
    if (active) { const s = doc.getSelection(); s?.removeAllRanges(); s?.addRange(active.range); fallback.set(doc,active.range); }
    return false;
  }
  const all = new win.Highlight(), current = new win.Highlight();
  current.priority = 1;
  const roots = new Set();
  for (const {range} of hits) {
    all.add(range);
    const tree = range.startContainer.getRootNode();
    if (tree.host) roots.add(tree);
  }
  let styles = shadowStyles.get(doc) || [];
  for (const style of styles) if (!roots.has(style.getRootNode())) style.remove();
  styles = styles.filter(s=>s.isConnected);
  for (const tree of roots) if (!styles.some(s=>s.getRootNode()===tree)) {
    const style = doc.createElement('style'); style.setAttribute('data-pane-find-ui',''); style.textContent = highlightCSS;
    tree.append(style); styles.push(style);
  }
  shadowStyles.set(doc,styles);
  if (active) current.add(active.range);
  win.CSS.highlights.set(ALL,all); win.CSS.highlights.set(CURRENT,current);
  return true;
}
export function revealHit(hit) {
  if (!hit?.range.startContainer.isConnected || !hit.range.getClientRects().length) return false;
  const el = hit.range.startContainer.parentElement;
  el?.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  const rect = hit.range.getBoundingClientRect();
  for (let p = el; p; p = p.parentElement || p.getRootNode()?.host) {
    if (p.scrollHeight <= p.clientHeight || !/auto|scroll/.test(p.ownerDocument.defaultView.getComputedStyle(p).overflowY)) continue;
    const box = p.getBoundingClientRect();
    if (rect.top < box.top || rect.bottom > box.bottom) p.scrollTop += rect.top - box.top - box.height / 2;
    break;
  }
  return true;
}
// Watch DOM replacement as well as changes inside the current scope. Plugin-owned
// mutations never queue a search, including appending/removing the overlay itself.
export function observePage(doc, notify) {
  let timer;
  const win = doc.defaultView;
  const queue = () => { if (timer == null) timer = win.setTimeout(()=>{timer=null;notify();},110); };
  const ours = node => (node.nodeType===1 ? node : node.parentElement)?.closest('[data-pane-find-ui]');
  const observer = new win.MutationObserver(records => {
    if (records.some(r => !ours(r.target) && (r.type !== 'childList' || [...r.addedNodes,...r.removedNodes].some(n=>!ours(n))))) queue();
  });
  const config = {childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class','style','open','hidden','inert','aria-hidden','aria-expanded','data-rightbar-collapsed','data-rightbar-fullscreen','data-sidebar-collapsed','data-conversation-session']};
  function watch(shadows = []) {observer.disconnect(); observer.observe(doc.body,config); for (const s of shadows) observer.observe(s,config);}
  watch(); win.addEventListener('resize',queue);
  return {watch, dispose(){win.clearTimeout(timer);observer.disconnect();win.removeEventListener('resize',queue);}};
}
