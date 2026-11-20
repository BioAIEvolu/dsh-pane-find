(() => {
  // src/search.js
  var ROW = "[data-chat-node-key],[data-chat-anchor-key]";
  var SKIP = 'script,style,noscript,template,iframe,canvas,svg,textarea,input,select,[contenteditable]:not([contenteditable="false"]),[data-composer-card],[data-pane-find-ui],[aria-hidden="true"],[hidden],[inert]';
  var ALL = "dsh-pane-find-all";
  var CURRENT = "dsh-pane-find-current";
  var ids = /* @__PURE__ */ new WeakMap();
  var sequence = 0;
  function elementId(el) {
    if (!ids.has(el)) ids.set(el, ++sequence);
    return ids.get(el);
  }
  function shown(el) {
    if (!el || el.closest('[hidden],[aria-hidden="true"],[inert]')) return false;
    const box = el.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    return !el.checkVisibility || el.checkVisibility({ visibilityProperty: true, opacityProperty: true });
  }
  function firstVisible(root, selector) {
    return Array.from(root.querySelectorAll(selector)).find(shown) || null;
  }
  function getScopes(doc) {
    const rightCol = doc.querySelector("[data-rightbar-col]");
    const frame = rightCol?.parentElement;
    const full = frame?.hasAttribute("data-rightbar-fullscreen");
    const right = rightCol && (full || !frame?.hasAttribute("data-rightbar-collapsed")) && shown(rightCol) ? rightCol : null;
    const centerCol = rightCol?.previousElementSibling;
    const center = full ? null : firstVisible(centerCol || doc, "[data-conversation-scroll]") || (shown(centerCol) ? centerCol : null);
    let left = firstVisible(doc, '[data-sidebar-col],[data-leftbar-col],[data-workspace-sidebar],[data-slot="sidebar.left"],aside[aria-label]');
    if (left && (rightCol?.contains(left) || centerCol?.contains(left))) left = null;
    if (!left && centerCol) {
      for (let el = centerCol.previousElementSibling; el; el = el.previousElementSibling) {
        if (shown(el) && el.getBoundingClientRect().width > 32 && (el.children.length || el.innerText?.trim())) {
          left = el;
          break;
        }
      }
    }
    if (full || frame?.hasAttribute("data-sidebar-collapsed")) left = null;
    if (left && center && (left === center || left.contains(center))) left = null;
    const roots = [];
    for (const el of [left, right]) {
      if (!el) continue;
      if (roots.some((r) => r === el || r.contains(el))) continue;
      for (let i = roots.length - 1; i >= 0; i--) if (el.contains(roots[i])) roots.splice(i, 1);
      roots.push(el);
    }
    return { center, side: roots.length ? roots : null };
  }
  function literalPattern(query) {
    if (!query) return null;
    const escaped = Array.from(query, (ch) => "^$\\.*+?()[]{}|".includes(ch) ? "\\" + ch : ch).join("");
    return new RegExp(escaped, "giu");
  }
  function nestedText(root) {
    const groups = [], shadows = [], messages = /* @__PURE__ */ new Map();
    let group = null;
    function visit(node, block, row) {
      if (node.nodeType === 3) {
        if (!node.data) return;
        if (!group || group.block !== block || group.row !== row) {
          group = { block, row, nodes: [], length: 0, parts: [] };
          groups.push(group);
          if (row) {
            if (!messages.has(row)) messages.set(row, []);
            messages.get(row).push(group);
          }
        }
        group.nodes.push({ node, base: group.length });
        group.parts.push(node.data);
        group.length += node.data.length;
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.matches(SKIP)) {
        group = null;
        return;
      }
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || style.contentVisibility === "hidden" || style.opacity === "0") {
        group = null;
        return;
      }
      if (node.tagName === "BR" || node.tagName === "HR") {
        group = null;
        return;
      }
      const isBlock = !["inline", "contents", "inline-block", "inline-flex"].includes(style.display);
      const nextBlock = isBlock ? node : block;
      const nextRow = node.matches(ROW) ? node : row;
      if (isBlock || nextRow !== row) group = null;
      if (node.shadowRoot) {
        group = null;
        shadows.push(node.shadowRoot);
        node.shadowRoot.childNodes.forEach((child) => visit(child, node, nextRow));
        group = null;
      } else if (node.localName === "slot" && node.getRootNode()?.host) {
        group = null;
        const assigned = node.assignedNodes({ flatten: true });
        (assigned.length ? assigned : node.childNodes).forEach((child) => visit(child, node, nextRow));
        group = null;
      } else if (node.tagName === "DETAILS" && !node.open) {
        const summary = Array.from(node.children).find((child) => child.tagName === "SUMMARY");
        if (summary) visit(summary, node, nextRow);
      } else node.childNodes.forEach((child) => visit(child, nextBlock, nextRow));
      if (isBlock) group = null;
    }
    if (root) visit(root, root, null);
    for (const group2 of groups) group2.text = group2.parts.join("");
    return { groups, messages, shadows };
  }
  function at(nodes, offset) {
    let lo = 0, hi = nodes.length;
    while (lo + 1 < hi) {
      const mid = lo + hi >>> 1;
      if (nodes[mid].base <= offset) lo = mid;
      else hi = mid;
    }
    return nodes[lo];
  }
  function searchScope(root, query, { limit = 5e3 } = {}) {
    const hits = [], occurrences = /* @__PURE__ */ new Map(), previews = /* @__PURE__ */ new Map(), shadows = [];
    let total = 0;
    const pattern = literalPattern(query);
    for (const scope of Array.isArray(root) ? root : [root]) {
      if (!scope || !pattern) continue;
      const { groups, messages, shadows: more } = nestedText(scope);
      shadows.push(...more);
      for (const group of groups) {
        const owner = group.row || group.block;
        const identity2 = owner.getAttribute("data-chat-node-key") || owner.getAttribute("data-chat-anchor-key") || owner.id;
        const anchor = identity2 ? "k:" + identity2 : "e:" + elementId(owner);
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
          if (!previews.has(owner)) previews.set(owner, group.row ? messages.get(owner).map((g) => g.text).join("\n").trim() : group.text.trim());
          const excerpt = group.text.slice(Math.max(0, index - 32), end + 48).trim();
          hits.push({ key: JSON.stringify([anchor, ordinal]), durable: !!identity2, range, excerpt, fullText: previews.get(owner) });
        }
      }
    }
    return { total, hits, shadows };
  }
  var fallback = /* @__PURE__ */ new WeakMap();
  var shadowStyles = /* @__PURE__ */ new WeakMap();
  var highlightCSS = "::highlight(" + ALL + "){background-color:#ffe194;color:#302200}::highlight(" + CURRENT + "){background-color:#ed8b32;color:#211400}";
  function clearHighlights(doc) {
    const registry = doc.defaultView.CSS?.highlights;
    registry?.delete(CURRENT);
    registry?.delete(ALL);
    const selection = doc.getSelection();
    if (fallback.get(doc) && selection?.rangeCount && selection.getRangeAt(0) === fallback.get(doc)) selection.removeAllRanges();
    fallback.delete(doc);
    for (const style of shadowStyles.get(doc) || []) style.remove();
    shadowStyles.delete(doc);
  }
  function paintHits(doc, hits, activeIndex) {
    const win = doc.defaultView, active = hits[activeIndex];
    if (!win.CSS?.highlights || !win.Highlight) {
      if (!active) clearHighlights(doc);
      if (active) {
        const s = doc.getSelection();
        s?.removeAllRanges();
        s?.addRange(active.range);
        fallback.set(doc, active.range);
      }
      return false;
    }
    const all = new win.Highlight(), current = new win.Highlight();
    current.priority = 1;
    const roots = /* @__PURE__ */ new Set();
    for (const { range } of hits) {
      all.add(range);
      const tree = range.startContainer.getRootNode();
      if (tree.host) roots.add(tree);
    }
    let styles = shadowStyles.get(doc) || [];
    for (const style of styles) if (!roots.has(style.getRootNode())) style.remove();
    styles = styles.filter((s) => s.isConnected);
    for (const tree of roots) if (!styles.some((s) => s.getRootNode() === tree)) {
      const style = doc.createElement("style");
      style.setAttribute("data-pane-find-ui", "");
      style.textContent = highlightCSS;
      tree.append(style);
      styles.push(style);
    }
    shadowStyles.set(doc, styles);
    if (active) current.add(active.range);
    win.CSS.highlights.set(ALL, all);
    win.CSS.highlights.set(CURRENT, current);
    return true;
  }
  function revealHit(hit) {
    if (!hit?.range.startContainer.isConnected || !hit.range.getClientRects().length) return false;
    const el = hit.range.startContainer.parentElement;
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const rect = hit.range.getBoundingClientRect();
    for (let p = el; p; p = p.parentElement || p.getRootNode()?.host) {
      if (p.scrollHeight <= p.clientHeight || !/auto|scroll/.test(p.ownerDocument.defaultView.getComputedStyle(p).overflowY)) continue;
      const box = p.getBoundingClientRect();
      if (rect.top < box.top || rect.bottom > box.bottom) p.scrollTop += rect.top - box.top - box.height / 2;
      break;
    }
    return true;
  }
  function observePage(doc, notify) {
    let timer;
    const win = doc.defaultView;
    const queue = () => {
      if (timer == null) timer = win.setTimeout(() => {
        timer = null;
        notify();
      }, 110);
    };
    const ours = (node) => (node.nodeType === 1 ? node : node.parentElement)?.closest("[data-pane-find-ui]");
    const observer = new win.MutationObserver((records) => {
      if (records.some((r) => !ours(r.target) && (r.type !== "childList" || [...r.addedNodes, ...r.removedNodes].some((n) => !ours(n))))) queue();
    });
    const config = { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open", "hidden", "inert", "aria-hidden", "aria-expanded", "data-rightbar-collapsed", "data-rightbar-fullscreen", "data-sidebar-collapsed", "data-conversation-session"] };
    function watch(shadows = []) {
      observer.disconnect();
      observer.observe(doc.body, config);
      for (const s of shadows) observer.observe(s, config);
    }
    watch();
    win.addEventListener("resize", queue);
    return { watch, dispose() {
      win.clearTimeout(timer);
      observer.disconnect();
      win.removeEventListener("resize", queue);
    } };
  }

  // src/panel.js
  var PREFS = "dsh-pane-find.settings.v1";
  var SAVED = "dsh-pane-find.saved.v1";
  var PAGE = 12;
  var NAMES = { center: "对话", side: "侧栏" };
  function load(win, key) {
    try {
      return JSON.parse(win.localStorage.getItem(key));
    } catch {
      return null;
    }
  }
  function save(win, key, value) {
    try {
      win.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
  function combo(e) {
    const key = e.key?.toLowerCase();
    if (!/^[a-z0-9]$/.test(key) || !e.ctrlKey && !e.metaKey && !e.altKey || e.isComposing || e.getModifierState?.("AltGraph")) return "";
    return [e.ctrlKey || e.metaKey ? "Mod" : "", e.altKey ? "Alt" : "", e.shiftKey ? "Shift" : "", key.toUpperCase()].filter(Boolean).join("+");
  }
  function fingerprint(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(36);
  }
  function element(doc, tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  }
  var panelCSS = highlightCSS + ".pf-trigger,.pf-action,.pf-panel button,.pf-img{font:inherit;color:inherit;cursor:pointer;border:0;background:transparent}.pf-trigger{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:7px;color:var(--dsw-alias-label-secondary,inherit)}.pf-panel,.pf-img{--pf-bg:var(--dsw-alias-bg-layer-2,Canvas);--pf-text:var(--dsw-alias-label-primary,CanvasText);--pf-dim:var(--dsw-alias-label-secondary,GrayText);--pf-line:var(--dsw-alias-border-l2,color-mix(in srgb,currentColor 18%,transparent));--pf-soft:var(--dsw-alias-fill-l1,color-mix(in srgb,currentColor 6%,transparent));--pf-softer:var(--dsw-alias-fill-l2,color-mix(in srgb,currentColor 3%,transparent));--pf-brand:var(--dsw-alias-brand-primary,#4c8bd8);--pf-brand-tint:color-mix(in srgb,var(--pf-brand) 12%,transparent);box-sizing:border-box;position:fixed;z-index:10001;background:var(--pf-bg);color:var(--pf-text);font:13px/1.45 system-ui,sans-serif;border:1px solid var(--pf-line);border-radius:12px;box-shadow:var(--dsw-alias-shadow-l2,0 2px 8px rgba(0,0,0,.08),0 16px 44px rgba(0,0,0,.2));overflow:hidden}.pf-panel{display:flex;flex-direction:column}.pf-panel [hidden],.pf-img[hidden]{display:none!important}.pf-body{display:flex;flex-direction:column;min-height:0;flex:1;overflow-y:auto;padding:6px}.pf-frame{position:absolute;inset:0;pointer-events:none}.pf-dz{position:absolute;pointer-events:auto;cursor:move;touch-action:none}.pf-dz-t{top:0;left:0;right:0;height:7px}.pf-dz-b{bottom:0;left:0;right:0;height:7px}.pf-dz-l{top:0;bottom:0;left:0;width:7px}.pf-dz-r{top:0;bottom:0;right:0;width:7px}body.pf-dragging,body.pf-dragging *{cursor:move!important;user-select:none!important}.pf-panel .pf-row{display:flex;align-items:center;gap:5px;padding:0 2px 5px}.pf-panel .pf-row>*{flex:none}.pf-panel .pf-glyph{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:6px;color:var(--pf-dim);background:var(--pf-softer);flex:none}.pf-panel .pf-glyph svg{display:block}.pf-panel .pf-q{flex:1 1 auto;min-width:36px;background:var(--pf-softer);color:inherit;font:inherit;padding:4px 8px;outline:none;border:0;border-radius:7px;transition:background .15s ease,box-shadow .15s ease}.pf-q::placeholder{color:var(--pf-dim)}.pf-q:focus{background:var(--pf-soft);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--pf-brand) 45%,transparent)}.pf-panel button,.pf-action{border-radius:7px;padding:3px 7px;transition:background .12s ease,color .12s ease}.pf-panel button:hover,.pf-panel button:focus-visible,.pf-trigger:hover,.pf-action:hover{background:var(--dsw-alias-interactive-bg-hover,#8882)}.pf-panel button:focus-visible{outline:2px solid var(--pf-brand);outline-offset:1px}.pf-panel button:disabled{opacity:.4;cursor:default}.pf-panel .pf-scopes{display:flex;background:var(--pf-soft);border-radius:8px;padding:2px;gap:1px;flex:none}.pf-panel .pf-scopes button{font-size:11px;white-space:nowrap;border-radius:6px;padding:3px 9px;color:var(--pf-dim)}.pf-panel .pf-scopes button:hover{color:var(--pf-text)}.pf-panel button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-3,var(--pf-bg));color:var(--pf-text);box-shadow:var(--dsw-alias-shadow-l1,0 1px 3px rgba(0,0,0,.16))}.pf-panel button[aria-current=true]{background:var(--pf-brand-tint);box-shadow:inset 2px 0 0 var(--pf-brand)}.pf-panel .pf-count{font-variant-numeric:tabular-nums;font-size:11px;color:var(--pf-dim);white-space:nowrap;background:var(--pf-softer);border-radius:6px;padding:3px 7px}.pf-panel .pf-results{display:grid;gap:2px;max-height:30vh;overflow:auto;padding-bottom:2px}.pf-panel .pf-hit{text-align:start;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;border-radius:7px;padding:4px 8px}.pf-panel .pf-hit:hover{background:var(--pf-softer)}.pf-panel .pf-preview{border:1px solid var(--pf-line);border-radius:9px;padding:7px 9px;margin-top:3px;background:var(--pf-softer)}.pf-preview pre{font:inherit;line-height:1.6;max-height:16vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 4px}.pf-panel .pf-foot,.pf-panel .pf-settings{padding:5px 2px 2px;border-top:1px solid var(--pf-line);font-size:11px;color:var(--pf-dim)}.pf-panel .pf-foot{justify-content:space-between;margin-top:3px}.pf-panel .pf-note{font-size:11px;color:var(--pf-dim);padding-inline:5px}.pf-img{padding:4px 9px}.pf-action{font-size:12px;margin-inline-end:2px}.pf-body::-webkit-scrollbar,.pf-panel .pf-results::-webkit-scrollbar{width:6px;height:6px}.pf-body::-webkit-scrollbar-thumb,.pf-panel .pf-results::-webkit-scrollbar-thumb{background:var(--pf-line);border-radius:3px}.pf-body::-webkit-scrollbar-track,.pf-panel .pf-results::-webkit-scrollbar-track{background:transparent}";
  function createPanel(doc) {
    const win = doc.defaultView, prefs = load(win, PREFS) || {};
    let preferred = Object.hasOwn(NAMES, prefs.scope) ? prefs.scope : prefs.scope === "left" || prefs.scope === "right" ? "side" : "center";
    let shortcut = /^(?:Mod(?:\+Alt)?|Alt)(?:\+Shift)?\+[A-Z0-9]$/.test(prefs.shortcut) ? prefs.shortcut : "Mod+F";
    const validPos = (p) => p && Number.isFinite(p.left) && Number.isFinite(p.top);
    let pos = validPos(prefs.position) ? { left: prefs.position.left, top: prefs.position.top } : null;
    let dragging = false, stopDrag = null;
    let ui, watch, resize, originalFocus, timer, result, active, scope, session, recording = false, lastQuery = "", pageStart = 0;
    function persistPrefs() {
      return save(win, PREFS, { scope: preferred, shortcut, position: pos });
    }
    function sessionId() {
      return doc.querySelector("[data-conversation-session]")?.getAttribute("data-conversation-session") || "";
    }
    function shortcutLabel() {
      return shortcut.replace("Mod", /Mac|iPhone|iPad/.test(win.navigator.platform) ? "⌘" : "Ctrl");
    }
    function saved() {
      const x = load(win, SAVED);
      return Array.isArray(x) ? x.filter((v) => v && typeof v.query === "string" && typeof v.session === "string").map((v) => ({ ...v, scope: v.scope === "center" ? "center" : "side" })).filter((v) => Object.hasOwn(NAMES, v.scope)).slice(0, 20) : [];
    }
    function note(msg) {
      if (ui) ui.note.textContent = msg;
    }
    function button(parent, label, action, text = label) {
      const b = element(doc, "button", "", text);
      b.type = "button";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.onclick = action;
      parent.append(b);
      return b;
    }
    function baseWidth() {
      const anchor = doc.querySelector("[data-composer-card]")?.getBoundingClientRect();
      return Math.min(Math.max(0, win.innerWidth - 16), Math.min(560, anchor?.width > 100 ? anchor.width : 480));
    }
    function textUnits(s) {
      let u = 0;
      for (const ch of s) {
        const c = ch.codePointAt(0);
        u += c >= 11904 && c <= 40959 || c >= 63744 && c <= 64255 || c >= 65281 && c <= 65376 || c >= 12288 && c <= 12351 ? 1 : 0.58;
      }
      return u;
    }
    function syncWidth() {
      if (!ui || dragging) return;
      let chrome = 0;
      for (const child of ui.row.children) {
        if (child === ui.q) continue;
        const r = child.getBoundingClientRect();
        if (r.width) chrome += r.width;
      }
      chrome += 4 * ui.row.children.length;
      const upper = baseWidth();
      const need = chrome + 18 + Math.max(84, textUnits(ui.q.value || ui.q.placeholder) * 13 + 8);
      ui.box.style.width = Math.round(Math.max(Math.min(400, upper), Math.min(upper, need))) + "px";
    }
    function clampPos(p, w) {
      return { left: Math.max(6, Math.min(win.innerWidth - w - 6, p.left)), top: Math.max(6, Math.min(win.innerHeight - 180, p.top)) };
    }
    function magnifierPos(w) {
      const t = doc.querySelector('button[data-pane-find-ui="trigger"]');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      if (!r.width) return null;
      const top = Math.max(8, r.top);
      let left = r.left - w - 12;
      if (left < 8) left = Math.max(8, Math.min(win.innerWidth - w - 8, r.left));
      return { left, top };
    }
    function applyPosition() {
      if (!ui || dragging) return;
      syncWidth();
      const w = ui.box.offsetWidth;
      if (pos) {
        ui.box.style.bottom = "auto";
        const p = clampPos(pos, w);
        ui.box.style.left = p.left + "px";
        ui.box.style.top = p.top + "px";
        ui.box.style.maxHeight = Math.max(90, win.innerHeight - p.top - 6) + "px";
        pos = p;
      } else {
        const anchor = doc.querySelector("[data-composer-card]")?.getBoundingClientRect();
        const bottom = anchor && anchor.top > 120 ? Math.max(8, win.innerHeight - anchor.top + 8) : 12;
        ui.box.style.top = "auto";
        ui.box.style.left = Math.max(8, Math.min(win.innerWidth - w - 8, anchor ? anchor.left + (anchor.width - w) / 2 : (win.innerWidth - w) / 2)) + "px";
        ui.box.style.bottom = bottom + "px";
        ui.box.style.maxHeight = Math.max(90, win.innerHeight - bottom - 8) + "px";
      }
    }
    function startDrag(e) {
      if (e.button !== 0 || !ui) return;
      const rect = ui.box.getBoundingClientRect();
      const sx = e.clientX, sy = e.clientY, ol = rect.left, ot = rect.top, w = rect.width;
      dragging = true;
      doc.body.classList.add("pf-dragging");
      e.preventDefault();
      const shield = element(doc, "div", "");
      shield.setAttribute("data-pane-find-ui", "drag-shield");
      shield.style.cssText = "position:fixed;inset:0;z-index:2147483600;cursor:move";
      doc.body.append(shield);
      const move = (ev) => {
        if (!ui) return;
        const p = clampPos({ left: ol + (ev.clientX - sx), top: ot + (ev.clientY - sy) }, w);
        pos = p;
        ui.box.style.left = p.left + "px";
        ui.box.style.top = p.top + "px";
        ui.box.style.bottom = "auto";
      };
      let done = false;
      const end = () => {
        if (done) return;
        done = true;
        win.removeEventListener("pointermove", move, true);
        win.removeEventListener("pointerup", end, true);
        win.removeEventListener("pointercancel", end, true);
        shield.remove();
        doc.body.classList.remove("pf-dragging");
        dragging = false;
        stopDrag = null;
        persistPrefs();
      };
      stopDrag = () => {
        if (done) return;
        done = true;
        dragging = false;
        shield.remove();
        doc.body.classList.remove("pf-dragging");
        stopDrag = null;
      };
      win.addEventListener("pointermove", move, true);
      win.addEventListener("pointerup", end, true);
      win.addEventListener("pointercancel", end, true);
    }
    function preview(hit) {
      ui.pre.textContent = hit.fullText;
      ui.preview.hidden = false;
      ui.copy.textContent = "复制整条";
    }
    function draw() {
      const { hits, total } = result;
      const painted = paintHits(doc, hits, active);
      ui.count.textContent = (hits.length ? active + 1 : 0) + " / " + total;
      ui.prev.disabled = ui.next.disabled = !hits.length;
      ui.list.replaceChildren();
      for (let i = pageStart; i < Math.min(hits.length, pageStart + PAGE); i++) {
        const h = hits[i], b = button(ui.list, "定位第 " + (i + 1) + " 处", () => activate(i), h.excerpt);
        b.className = "pf-hit";
        b.setAttribute("aria-current", String(i === active));
        b.onpointerenter = b.onfocus = () => preview(h);
      }
      ui.foot.hidden = !ui.q.value;
      ui.summary.textContent = total ? "共 " + total + " 处 · 列出 " + (pageStart + 1) + "–" + Math.min(pageStart + PAGE, hits.length) + (total > hits.length ? " · 可定位前 " + hits.length + " 处" : "") : "没有匹配";
      ui.pages.hidden = hits.length <= PAGE;
      ui.pgPrev.disabled = pageStart === 0;
      ui.pgNext.disabled = pageStart + PAGE >= hits.length;
      if (!painted && hits.length) note("当前浏览器仅标出所选匹配");
    }
    function activate(index) {
      const n = result.hits.length;
      if (!n) return;
      const i = (index % n + n) % n, hit = result.hits[i];
      if (!revealHit(hit)) {
        refresh();
        note("内容已变化，请重新选择结果");
        return;
      }
      active = i;
      pageStart = Math.floor(i / PAGE) * PAGE;
      draw();
      preview(hit);
    }
    function refresh() {
      if (!ui) return;
      const sid = sessionId();
      if (sid !== session) {
        close();
        return;
      }
      const scopes = getScopes(doc);
      const next = scopes[preferred] ? preferred : scopes.center ? "center" : scopes.side ? "side" : "center";
      const oldKey = next === scope && lastQuery === ui.q.value ? result?.hits[active]?.key : null;
      const oldPreview = !ui.preview.hidden;
      scope = next;
      lastQuery = ui.q.value;
      for (const [id, b] of Object.entries(ui.buttons)) {
        b.hidden = !scopes[id];
        b.setAttribute("aria-pressed", String(id === scope));
      }
      result = searchScope(scopes[scope], lastQuery);
      watch?.watch(result.shadows);
      const found = oldKey == null ? -1 : result.hits.findIndex((h) => h.key === oldKey);
      active = Math.max(0, found);
      pageStart = Math.floor(active / PAGE) * PAGE;
      ui.preview.hidden = true;
      if (found >= 0 && oldPreview) preview(result.hits[found]);
      draw();
      applyPosition();
    }
    function queue() {
      win.clearTimeout(timer);
      timer = win.setTimeout(refresh, 70);
    }
    const onScroll = () => {
      if (!pos) applyPosition();
    };
    function close(restore2 = true) {
      if (!ui) return;
      win.clearTimeout(timer);
      watch?.dispose();
      resize?.disconnect();
      if (stopDrag) stopDrag();
      win.removeEventListener("scroll", onScroll, true);
      clearHighlights(doc);
      ui.box.remove();
      ui = null;
      result = null;
      watch = null;
      resize = null;
      recording = false;
      lastQuery = "";
      if (restore2 && originalFocus?.isConnected) originalFocus.focus({ preventScroll: true });
      originalFocus = null;
    }
    function saveResult() {
      if (lastQuery !== ui.q.value) refresh();
      const query = ui.q.value, hit = result.hits[active];
      if (!query || !hit) {
        note("选中一个匹配后再保存");
        return;
      }
      const item = { session, scope, query: query.slice(0, 512), key: hit.durable ? hit.key : null, hash: hit.durable ? fingerprint(hit.excerpt) : null };
      const items = saved().filter((s) => !(s.session === session && s.scope === scope && s.query === item.query && s.key === item.key));
      const ok = save(win, SAVED, [item, ...items].slice(0, 20));
      note(ok ? "已保存到本机" : "浏览器未允许保存");
      renderSettings();
    }
    function restore(item) {
      preferred = item.scope;
      ui.q.value = item.query;
      refresh();
      if (scope !== item.scope) {
        note("保存的栏当前收起");
        return;
      }
      const index = item.key && result.hits.findIndex((h) => h.key === item.key && fingerprint(h.excerpt) === item.hash);
      if (typeof index === "number" && index >= 0) {
        activate(index);
        note("已定位保存的结果");
      } else note("已重新查找，请从当前结果选择位置");
    }
    function renderSettings() {
      const box = ui.settings;
      box.replaceChildren();
      button(box, "修改查找快捷键", () => {
        recording = true;
        renderSettings();
      }, recording ? "请按组合键 · Esc 取消" : shortcutLabel());
      button(box, "恢复默认快捷键", () => {
        shortcut = "Mod+F";
        recording = false;
        persistPrefs();
        renderSettings();
      }, "默认键");
      button(box, "保存当前结果", saveResult, "保存结果");
      const items = saved(), visible = items.filter((x) => x.session === session);
      if (visible.length) {
        button(box, "清除此会话保存的结果", () => {
          const ok = save(win, SAVED, items.filter((x) => x.session !== session));
          note(ok ? "已清除" : "清除失败");
          renderSettings();
        }, "清除已存");
      }
      for (const item of visible) button(box, "恢复 " + item.query, () => restore(item), NAMES[item.scope] + " · " + item.query);
    }
    function open(origin = "shortcut") {
      if (ui) {
        ui.q.focus();
        ui.q.select();
        return;
      }
      const prefill = String(doc.getSelection() || "").trim().slice(0, 512);
      originalFocus = doc.activeElement;
      session = sessionId();
      const box = element(doc, "section", "pf-panel");
      box.setAttribute("data-pane-find-ui", "panel");
      box.setAttribute("role", "search");
      box.setAttribute("aria-label", "页内查找");
      doc.body.append(box);
      const frame = element(doc, "div", "pf-frame");
      for (const c of ["t", "l", "r", "b"]) {
        const s = element(doc, "div", "pf-dz pf-dz-" + c);
        s.setAttribute("data-pane-find-ui", "drag");
        s.addEventListener("pointerdown", startDrag);
        frame.append(s);
      }
      const body = element(doc, "div", "pf-body");
      box.append(frame, body);
      const row = element(doc, "div", "pf-row"), q = element(doc, "input", "pf-q");
      q.type = "text";
      q.placeholder = "查找此栏…";
      q.setAttribute("aria-label", "查找内容");
      q.maxLength = 512;
      q.value = prefill;
      q.oninput = () => {
        note("");
        syncWidth();
        queue();
      };
      const glyph = element(doc, "span", "pf-glyph");
      glyph.setAttribute("data-pane-find-ui", "glyph");
      glyph.innerHTML = '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="8.2" cy="8.2" r="5.5"></circle><path d="m12.5 12.5 4.5 4.5" stroke-linecap="round"></path></svg>';
      const scopes = element(doc, "div", "pf-scopes"), count = element(doc, "span", "pf-count");
      count.setAttribute("aria-live", "polite");
      row.append(glyph, q, scopes, count);
      body.append(row);
      const buttons = {};
      for (const [id, name] of Object.entries(NAMES)) buttons[id] = button(scopes, "查找" + name, () => {
        preferred = id;
        persistPrefs();
        refresh();
        q.focus();
      }, name);
      const prev = button(row, "上一处", () => activate(active - 1), "↑"), next = button(row, "下一处", () => activate(active + 1), "↓");
      button(row, "查找设置及保存的结果", () => {
        ui.settings.hidden = !ui.settings.hidden;
        recording = false;
        renderSettings();
      }, "⋯");
      button(row, "关闭查找", () => close(), "×");
      const list = element(doc, "div", "pf-results"), previewBox = element(doc, "div", "pf-preview"), pre = element(doc, "pre");
      previewBox.hidden = true;
      previewBox.append(pre);
      const copy = button(previewBox, "复制整条", async () => {
        try {
          await win.navigator.clipboard.writeText(pre.textContent);
          copy.textContent = "已复制";
        } catch {
          copy.textContent = "复制失败";
        }
      });
      const foot = element(doc, "div", "pf-foot"), summary = element(doc, "span"), pages = element(doc, "span"), settings = element(doc, "div", "pf-settings"), info = element(doc, "div", "pf-note");
      settings.hidden = true;
      info.setAttribute("role", "status");
      const pgPrev = button(pages, "上一批结果", () => activate(pageStart - PAGE), "‹"), pgNext = button(pages, "下一批结果", () => activate(pageStart + PAGE), "›");
      foot.append(summary, pages);
      body.append(list, previewBox, foot, settings, info);
      ui = { box, row, q, buttons, count, prev, next, list, foot, summary, pages, pgPrev, pgNext, settings, note: info, preview: previewBox, pre, copy };
      result = { hits: [], total: 0 };
      active = 0;
      syncWidth();
      if (origin === "icon") {
        const p = magnifierPos(ui.box.offsetWidth);
        if (p) {
          pos = p;
          persistPrefs();
        }
      }
      watch = observePage(doc, refresh);
      const card = doc.querySelector("[data-composer-card]");
      if (card && win.ResizeObserver) {
        resize = new win.ResizeObserver(applyPosition);
        resize.observe(card);
      }
      win.addEventListener("scroll", onScroll, true);
      renderSettings();
      refresh();
      applyPosition();
      q.focus();
      q.select();
    }
    function onKey(e) {
      if (e.defaultPrevented || e.isComposing) return;
      const c = combo(e), key = e.key;
      const take = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (recording && ui) {
        take();
        if (key === "Escape") {
          recording = false;
        } else if (c) {
          shortcut = c;
          recording = false;
          persistPrefs();
        }
        renderSettings();
        return;
      }
      if (c === shortcut) {
        take();
        open();
        return;
      }
      if (!ui) return;
      if (key === "Escape") {
        take();
        close();
        return;
      }
      if (key === "F3" || c === "Mod+G" || c === "Mod+Shift+G" || key === "Enter" && e.target === ui.q) {
        take();
        if (lastQuery !== ui.q.value) refresh();
        activate(active + (e.shiftKey ? -1 : 1));
      }
    }
    win.addEventListener("keydown", onKey, true);
    return { open, close, dispose() {
      close(false);
      win.removeEventListener("keydown", onKey, true);
    } };
  }

  // src/file-recall.js
  var MAX_BYTES = 64 * 1024 * 1024;
  var MAX_ENTRIES = 32;
  var fileRef = (ref) => typeof ref?.name === "string" && ref.name.length > 0 && !ref.mediaType && Number.isSafeInteger(ref.bytes) && ref.bytes >= 0 && /^sha256:[0-9a-f]{64}$/.test(ref.attachmentId);
  var identity = (ref) => JSON.stringify([ref.attachmentId, ref.name, ref.bytes]);
  var matches = (file, ref) => file?.name === ref.name && file?.size === ref.bytes;
  function createFileRecall({ maxBytes = MAX_BYTES, maxEntries = MAX_ENTRIES, choose = chooseOriginals } = {}) {
    const entries = /* @__PURE__ */ new Map();
    let retained = 0, disposed = false;
    const key = (sid, ref) => JSON.stringify([sid, identity(ref)]);
    function remember(sid, ref, file) {
      if (disposed || !sid || !fileRef(ref) || !matches(file, ref) || file.size > maxBytes) return;
      const id = key(sid, ref);
      if (entries.has(id)) {
        retained -= entries.get(id).size;
        entries.delete(id);
      }
      entries.set(id, file);
      retained += file.size;
      while (entries.size > maxEntries || retained > maxBytes) {
        const oldest = entries.keys().next().value;
        retained -= entries.get(oldest).size;
        entries.delete(oldest);
      }
    }
    return {
      capture(sid, service, ids2) {
        if (!ids2?.length || !service?.resolveDraftAttachments || !service.fileUploads?.getSnapshot) return;
        const uploads = service.fileUploads.getSnapshot();
        for (const draft of service.resolveDraftAttachments(ids2)) {
          const state = uploads[draft.id];
          if (draft.kind === "file" && state?.status === "ready") remember(sid, state.file, draft.file);
        }
      },
      async resolve(sid, refs, valid) {
        const current = () => !disposed && valid();
        if (!sid || !current() || refs.some((ref) => !fileRef(ref))) return null;
        const files = /* @__PURE__ */ new Map(), missing = /* @__PURE__ */ new Map();
        for (const ref of refs) {
          const id = identity(ref), file = entries.get(key(sid, ref));
          if (file) files.set(id, file);
          else missing.set(id, ref);
        }
        if (missing.size) {
          const required = [...missing.values()];
          if (required.some((ref) => ref.bytes > maxBytes)) throw Error("附件超出恢复容量，请在输入框重新添加。");
          const selected = await choose(required, current);
          if (!current() || !selected) return null;
          const pending = new Map(missing);
          for (const file of selected) {
            const candidates = [...pending.values()].filter((ref2) => matches(file, ref2));
            if (!candidates.length) throw Error("所选文件的名称或大小与原附件不同。");
            const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
            if (!current()) return null;
            const digest = "sha256:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
            const ref = candidates.find((r) => r.attachmentId === digest);
            if (!ref) throw Error("所选文件的内容与原附件不同。");
            pending.delete(identity(ref));
            files.set(identity(ref), file);
          }
          if (pending.size) throw Error("请选齐列出的原附件。");
          for (const ref of required) remember(sid, ref, files.get(identity(ref)));
        }
        return current() ? refs.map((ref) => files.get(identity(ref))) : null;
      },
      dispose() {
        disposed = true;
        entries.clear();
        retained = 0;
      }
    };
  }
  function uploadsReady(store, pairs, valid, timeoutMs = 3e4) {
    if (!pairs.length) return Promise.resolve(valid());
    if (!store?.getSnapshot || !store.subscribe) return Promise.resolve(false);
    return new Promise((resolve) => {
      let done = false, unsubscribe, tick, deadline;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearInterval(tick);
        clearTimeout(deadline);
        unsubscribe?.();
        resolve(value);
      };
      function check() {
        try {
          if (!valid()) {
            finish(false);
            return;
          }
          const snapshot = store.getSnapshot();
          let ready = true;
          for (const [id, expected] of pairs) {
            const state = snapshot[id];
            if (state?.status === "error") {
              finish(false);
              return;
            }
            if (state?.status !== "ready") {
              ready = false;
              continue;
            }
            if (!fileRef(state.file) || identity(state.file) !== identity(expected)) {
              finish(false);
              return;
            }
          }
          if (ready) finish(true);
        } catch {
          finish(false);
        }
      }
      tick = setInterval(check, 150);
      deadline = setTimeout(() => finish(false), timeoutMs);
      try {
        unsubscribe = store.subscribe(check);
        if (done) unsubscribe?.();
        else check();
      } catch {
        finish(false);
      }
    });
  }
  function chooseOriginals(refs, valid) {
    if (!globalThis.document?.body || !valid()) return Promise.resolve(null);
    return new Promise((resolve) => {
      const doc = document, dialog = doc.createElement("dialog");
      const title = doc.createElement("strong"), list = doc.createElement("ul"), picker = doc.createElement("input"), cancel = doc.createElement("button");
      dialog.setAttribute("data-pane-find-ui", "file-reselect");
      dialog.setAttribute("aria-label", "重新选择原附件");
      dialog.style.cssText = "max-width:min(28rem,90vw);max-height:70vh;overflow:auto;padding:16px;border:1px solid var(--dsw-alias-border-l2,GrayText);border-radius:10px;background:var(--dsw-alias-bg-overlay,Canvas);color:var(--dsw-alias-label-primary,CanvasText);font:inherit";
      title.textContent = "重新选择原附件";
      for (const ref of refs) {
        const row = doc.createElement("li");
        row.textContent = ref.name + " · " + ref.bytes + " 字节";
        list.append(row);
      }
      picker.type = "file";
      picker.multiple = refs.length > 1;
      picker.setAttribute("aria-label", "选择原文件");
      cancel.textContent = "取消";
      cancel.type = "button";
      dialog.append(title, list, picker, cancel);
      doc.body.append(dialog);
      let timer, deadline, done = false;
      const finish = (selected) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        clearTimeout(deadline);
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(selected);
      };
      picker.onchange = () => finish(Array.from(picker.files || []));
      cancel.onclick = () => finish(null);
      dialog.oncancel = (e) => {
        e.preventDefault();
        finish(null);
      };
      dialog.onclose = () => finish(null);
      timer = setInterval(() => {
        if (!valid()) finish(null);
      }, 200);
      deadline = setTimeout(() => finish(null), 12e4);
      try {
        dialog.showModal();
      } catch {
        finish(null);
      }
    });
  }

  // src/conversation.js
  /*! Adapted chat-node and image helpers from Ernesto-yuan/dsh-conversation-tools, MIT. See licenses/dsh-conversation-tools.txt. */
  function textOfContent(content) {
    if (!Array.isArray(content)) return "";
    let text = "";
    for (const block of content) {
      if (block !== null && typeof block === "object" && block.type === "text" && typeof block.text === "string") text += block.text;
    }
    return text;
  }
  function nodeEntries(snapshot) {
    const entries = [];
    if (snapshot === null || typeof snapshot !== "object") return entries;
    const nodes = snapshot.nodes;
    if (nodes === void 0 || nodes === null || typeof nodes.get !== "function") return entries;
    const order = snapshot.order;
    const keys = Array.isArray(order) ? order : order !== null && typeof order === "object" && typeof order[Symbol.iterator] === "function" ? Array.from(order) : [];
    for (const key of keys) {
      const node = nodes.get(key);
      if (node !== void 0 && node !== null && typeof node === "object") entries.push({ key, node });
    }
    return entries;
  }
  function seqOf(node) {
    return typeof node.anchorSeq === "number" ? node.anchorSeq : 0;
  }
  function attachmentsOfContent(content) {
    if (!Array.isArray(content)) return [];
    const refs = [];
    for (const block of content) {
      if (block === null || typeof block !== "object") continue;
      if (block.type !== "image" && block.type !== "file") continue;
      const ref = block.attachment;
      if (ref === null || ref === void 0 || typeof ref !== "object") continue;
      if (typeof ref.attachmentId !== "string") continue;
      refs.push({ ...ref });
    }
    return refs;
  }
  function userHistory(snapshot) {
    const items = [];
    for (const { key, node } of nodeEntries(snapshot)) {
      if (node.kind !== "user" && node.kind !== "steering") continue;
      const content = node.data === void 0 ? void 0 : node.data.content;
      const text = textOfContent(content);
      const attachments = attachmentsOfContent(content);
      if (text === "" && attachments.length === 0) continue;
      items.push({ key, seq: seqOf(node), text, attachments });
    }
    items.sort((left, right) => left.seq - right.seq);
    return items;
  }
  function contentForAnswer(snapshot, messageId) {
    const entries = nodeEntries(snapshot);
    const tail = entries.find(({ node }) => node.kind === "turn-tail" && node.data?.closing?.finalNode?.messageId === messageId)?.node;
    if (!tail) return null;
    const seq = tail.data.closing.finalNode.seq ?? seqOf(tail);
    let opening;
    for (const { node } of entries) {
      const opensExchange = node.kind === "user" || node.kind === "steering" && node.groupTree === "exchange";
      if (!opensExchange || seqOf(node) > seq) continue;
      const position = node.location?.turn;
      const turn = typeof position === "number" ? position : position?.turn ?? node.data?.turn;
      if (tail.data.turn != null && turn !== tail.data.turn) continue;
      if (!opening || seqOf(node) >= seqOf(opening)) opening = node;
    }
    return opening?.data?.content ?? null;
  }
  function lastAssistantMessageId(snapshot) {
    let last = null;
    let lastSeq = -1;
    for (const { node } of nodeEntries(snapshot)) {
      if (node.kind !== "turn-tail") continue;
      const closing = node.data === void 0 ? void 0 : node.data.closing;
      const finalNode = closing === null || closing === void 0 ? void 0 : closing.finalNode;
      if (finalNode === null || finalNode === void 0 || typeof finalNode.messageId !== "string") continue;
      const seq = typeof finalNode.seq === "number" ? finalNode.seq : seqOf(node);
      if (seq >= lastSeq) {
        lastSeq = seq;
        last = finalNode.messageId;
      }
    }
    return last;
  }
  var IMAGE_MIN_SIZE = 56;
  function chatImageAt(target) {
    if (target === null || typeof target !== "object" || typeof target.closest !== "function") return null;
    const img = target.closest("img");
    if (img === null || img === void 0 || typeof img.closest !== "function") return null;
    if (img.closest("[data-chat-flow],[data-conversation-scroll]") === null) return null;
    const rect = typeof img.getBoundingClientRect === "function" ? img.getBoundingClientRect() : null;
    if (rect === null || rect.width < IMAGE_MIN_SIZE || rect.height < IMAGE_MIN_SIZE) return null;
    return img;
  }
  function canvasPng(width, height, draw) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d");
    if (context === null || context === void 0) throw new Error("canvas 2d context unavailable");
    draw(context);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob === null || blob === void 0) reject(new Error("canvas.toBlob returned null"));
        else resolve(blob);
      }, "image/png");
    });
  }
  async function imageBlob(img) {
    const src = typeof img.currentSrc === "string" && img.currentSrc !== "" ? img.currentSrc : img.src;
    if (typeof src === "string" && src !== "") {
      try {
        const address = new URL(src, document.baseURI);
        if (!["http:", "https:", "blob:", "data:"].includes(address.protocol)) throw new Error("unsupported image source");
        const response = await fetch(address, { credentials: "same-origin", referrerPolicy: "no-referrer" });
        if (response.ok) {
          const blob = await response.blob();
          if (typeof blob.type === "string" && blob.type.startsWith("image/")) return blob;
        }
      } catch (error) {
      }
    }
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) throw new Error("image has no size yet");
    return canvasPng(width, height, (context) => context.drawImage(img, 0, 0, width, height));
  }
  async function pngBlob(blob) {
    if (blob.type === "image/png") return blob;
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(blob);
      try {
        return await canvasPng(bitmap.width, bitmap.height, (context) => context.drawImage(bitmap, 0, 0));
      } finally {
        if (typeof bitmap.close === "function") bitmap.close();
      }
    }
    const url = URL.createObjectURL(blob);
    try {
      const image = await new Promise((resolve, reject) => {
        const element2 = new Image();
        element2.onload = () => resolve(element2);
        element2.onerror = () => reject(new Error("image could not be decoded"));
        element2.src = url;
      });
      return await canvasPng(image.naturalWidth, image.naturalHeight, (context) => context.drawImage(image, 0, 0));
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  async function copyImage(img) {
    if (navigator.clipboard === void 0 || typeof navigator.clipboard.write !== "function" || typeof ClipboardItem !== "function") {
      throw new Error("this browser cannot write images to the clipboard");
    }
    const png = await pngBlob(await imageBlob(img));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  }
  function installImageCopy(translate) {
    if (typeof document === "undefined" || document.body === null) return () => {
    };
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pf-img";
    button.setAttribute("data-pane-find-ui", "image");
    button.hidden = true;
    button.setAttribute("aria-label", translate("image.copy"));
    const label = document.createElement("span");
    label.textContent = translate("image.copy");
    button.appendChild(label);
    document.body.appendChild(button);
    let hovered = null;
    let hideTimer = 0;
    let labelTimer = 0;
    let busy = false;
    const clearHide = () => {
      if (hideTimer) {
        window.clearTimeout(hideTimer);
        hideTimer = 0;
      }
    };
    const hide = () => {
      clearHide();
      hovered = null;
      button.hidden = true;
    };
    const scheduleHide = () => {
      clearHide();
      hideTimer = window.setTimeout(hide, 180);
    };
    const resetLabel = () => {
      label.textContent = translate("image.copy");
      button.classList.remove("pf-img-failed");
    };
    const flash = (text, failed) => {
      if (labelTimer) window.clearTimeout(labelTimer);
      label.textContent = text;
      button.classList.toggle("pf-img-failed", failed === true);
      labelTimer = window.setTimeout(resetLabel, 1400);
    };
    const place = (img) => {
      const rect = img.getBoundingClientRect();
      const width = button.offsetWidth || 96;
      const left = Math.min(Math.max(6, window.innerWidth - width - 6), Math.max(6, rect.right - width - 8));
      button.style.left = left + "px";
      button.style.top = Math.max(6, rect.top + 8) + "px";
    };
    let pointer = null;
    const show = (img) => {
      clearHide();
      hovered = img;
      button.hidden = false;
      place(img);
    };
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
      if (button.contains(event.target) === true) {
        scheduleHide();
        return;
      }
      const related = event.relatedTarget;
      if (related !== null && related !== void 0) {
        if (related === hovered || button.contains(related) === true) return;
        if (typeof related.closest === "function" && related.closest("img") === hovered) return;
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
        flash(translate("image.copied"), false);
      } catch (error) {
        flash(translate("image.failed"), true);
      } finally {
        busy = false;
      }
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointermove", onOver, true);
    document.addEventListener("pointerout", onOut, true);
    document.addEventListener("pointerleave", onLeaveWindow, true);
    document.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    button.addEventListener("pointerenter", clearHide);
    button.addEventListener("pointerleave", scheduleHide);
    button.addEventListener("click", onButtonClick);
    return () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      if (labelTimer) window.clearTimeout(labelTimer);
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointermove", onOver, true);
      document.removeEventListener("pointerout", onOut, true);
      document.removeEventListener("pointerleave", onLeaveWindow, true);
      document.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      button.remove();
    };
  }
  async function restoreFiles(ctx, sessionId, references, actions, valid, requireAll = false, recall) {
    if (requireAll && references.length > 6) return [];
    const service = ctx.get("conversation");
    if (!service?.createDrafts || !actions?.addAttachments || !valid()) return [];
    const selected = references.slice(0, 6);
    const ordinary = selected.filter((ref) => !ref.mediaType);
    const originals = ordinary.length && recall ? await recall.resolve(sessionId, ordinary, valid) : null;
    if (!valid() || requireAll && ordinary.length && originals?.length !== ordinary.length) return [];
    const session = ctx.get("sessions")?.binding?.(sessionId)?.session;
    const files = [], pending = [];
    let ordinaryIndex = 0;
    for (const ref of selected) {
      if (!valid()) return [];
      if (!ref.mediaType) {
        const file = originals?.[ordinaryIndex++];
        if (file) {
          pending.push([files.length, ref]);
          files.push(new File([file], ref.name, { type: "application/octet-stream" }));
        }
        continue;
      }
      try {
        const result = await session?.readAttachment?.(ref);
        if (result?.ok && result.value?.data != null) {
          const meta = result.value.attachment || ref;
          files.push(new File([Uint8Array.from(result.value.data)], meta.name || "attachment", { type: meta.mediaType }));
        }
      } catch {
      }
    }
    if (!valid() || !files.length || requireAll && files.length !== references.length) return [];
    const drafts = service.createDrafts(sessionId, files, false);
    let admitted = false;
    try {
      if (drafts.length !== files.length) return [];
      const ids2 = drafts.map((d) => d.id);
      if (pending.length && !await uploadsReady(service.fileUploads, pending.map(([index, ref]) => [ids2[index], ref]), valid)) return [];
      admitted = valid() && actions.addAttachments(ids2) === true;
      return admitted ? ids2 : [];
    } finally {
      if (!admitted) service.releaseDraftAttachments?.(drafts);
    }
  }
  async function replayPrompt(ctx, sessionId, content, actions, valid, recall) {
    if (!Array.isArray(content) || !valid([])) return false;
    if (content.some((block) => !block || !(block.type === "text" || ["image", "file"].includes(block.type) && block.attachment?.attachmentId))) return false;
    const refs = attachmentsOfContent(content), text = textOfContent(content);
    if (!text.trim() && !refs.length) return false;
    const ids2 = refs.length ? await restoreFiles(ctx, sessionId, refs, actions, () => valid([]), true, recall) : [];
    if (ids2.length !== refs.length || !valid(ids2)) {
      for (const id of ids2) actions.removeAttachment(id);
      return false;
    }
    actions.setDraft(text);
    actions.submit();
    return true;
  }
  function allowRecallTarget(target, sid) {
    if (!target?.isContentEditable) return false;
    const card = target.closest("[data-composer-card]");
    if (!card) return false;
    const root = card.closest("[data-conversation-session]") || document.querySelector("[data-conversation-session]");
    return root?.getAttribute("data-conversation-session") === sid;
  }
  function nextHistory(cursor, history, draft, step) {
    if (!history.length || !cursor && (step > 0 || draft !== "") || cursor && draft !== cursor.text) return null;
    const pos = cursor ? history.findIndex((entry) => entry.key === cursor.key) : history.length;
    if (pos < 0 || pos + step < 0) return null;
    return { entry: history[pos + step] || null };
  }
  function contribute(slots, name, id, order, component) {
    slots.inject(name, () => slots.register({ name, id: "pane-find-" + id, order }, component));
  }
  function installConversation(ctx, React) {
    const slots = ctx.get("slots"), h = React.createElement;
    const locks = /* @__PURE__ */ new WeakMap();
    const recall = createFileRecall();
    ctx.effect(() => () => recall.dispose(), "pane-find session file references");
    const status = { "image.copy": "复制图片", "image.copied": "已复制图片", "image.failed": "复制失败" };
    ctx.effect(() => installImageCopy((k) => status[k]), "pane-find image clipboard");
    function History(props) {
      const order = props.useChat((s) => s.order), nodes = props.useChat((s) => s.nodes);
      const history = userHistory({ order, nodes });
      const input = props.useInput((s) => s);
      const latest = React.useRef();
      latest.current = { history, input };
      const [notice, setNotice] = React.useState("");
      React.useEffect(() => {
        const ids2 = input.attachmentIds, sid = props.sessionId, service = ctx.get("conversation");
        if (!ids2?.length || !service?.fileUploads?.subscribe) return;
        const capture = () => recall.capture(sid, service, ids2);
        const unsubscribe = service.fileUploads.subscribe(capture);
        capture();
        return unsubscribe;
      }, [props.sessionId, input.attachmentIds]);
      React.useEffect(() => {
        const actions = props.inputActions, sid = props.sessionId;
        let cursor = null, generation = 0, disposed = false, added = [];
        function drop() {
          for (const id of added) actions.removeAttachment(id);
          added = [];
        }
        function onInput(e) {
          if (allowRecallTarget(e.target, sid)) {
            generation++;
            cursor = null;
            added = [];
            setNotice("");
          }
        }
        function onKey(e) {
          if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          if (!allowRecallTarget(e.target, sid)) return;
          const { input: input2, history: history2 } = latest.current;
          if (input2.phase !== "plain" || !cursor && input2.attachmentIds?.length) return;
          const move = nextHistory(cursor, history2, input2.draft, e.key === "ArrowUp" ? -1 : 1);
          if (!move) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          const gen = ++generation, entry = move.entry;
          setNotice("");
          if (!entry?.attachments.length) {
            drop();
            cursor = entry;
            actions.setDraft(entry?.text || "");
            return;
          }
          const original = input2.draft, revision = input2.draftRev, prevIds = input2.attachmentIds || [];
          const valid = (extra = []) => {
            const live = latest.current.input;
            return !disposed && generation === gen && live.phase === "plain" && live.draft === original && live.draftRev === revision && (live.attachmentIds || []).every((id) => prevIds.includes(id) || extra.includes(id)) && prevIds.every((id) => (live.attachmentIds || []).includes(id));
          };
          setNotice("正在取回原附件…");
          void restoreFiles(ctx, sid, entry.attachments, actions, valid, true, recall).then((ids2) => {
            if (!valid(ids2)) {
              for (const id of ids2) actions.removeAttachment(id);
              return;
            }
            if (ids2.length !== entry.attachments.length) {
              setNotice("附件未完整取回，请重新选择原文件。");
              return;
            }
            drop();
            cursor = entry;
            added = ids2;
            actions.setDraft(entry.text);
            setNotice("");
          }).catch((error) => {
            if (valid()) setNotice(error?.message || "附件未能取回。");
          });
        }
        document.addEventListener("input", onInput, true);
        document.addEventListener("keydown", onKey, true);
        return () => {
          disposed = true;
          generation++;
          document.removeEventListener("input", onInput, true);
          document.removeEventListener("keydown", onKey, true);
        };
      }, [props.sessionId, props.inputActions]);
      return notice ? h("span", { "data-pane-find-ui": "file-status", role: "status" }, notice) : null;
    }
    function Actions(props) {
      const content = props.useChat((s) => contentForAnswer(s, props.messageId));
      const last = props.useChat(lastAssistantMessageId);
      const input = props.useInput((s) => s);
      const running = props.useSession((s) => s.running === true);
      const actions = props.inputActions;
      const [notice, setNotice] = React.useState("");
      const view = React.useRef();
      view.current = { input, running, session: props.sessionId };
      React.useEffect(() => () => {
        view.current = null;
      }, [props.sessionId]);
      const busy = running || input.phase !== "plain" || !!input.draft || !!input.attachmentIds?.length;
      function button(label, blocks) {
        return h("button", {
          type: "button",
          className: "pf-action",
          "data-pane-find-ui": "action",
          disabled: busy,
          title: busy ? "请先完成当前输入或等待回答结束" : label,
          onClick: async () => {
            const gate = locks.get(actions);
            if (busy || gate?.inFlight || gate?.lastAnswer === last && gate?.until > Date.now()) return;
            const sid = props.sessionId, rev = view.current?.input.draftRev;
            const valid = (ids2) => {
              const v = view.current;
              return !!v && v.session === sid && !v.running && v.input.phase === "plain" && !v.input.draft && v.input.draftRev === rev && (v.input.attachmentIds || []).every((id) => ids2.includes(id));
            };
            locks.set(actions, { inFlight: true });
            let sent = false;
            try {
              setNotice("");
              sent = await replayPrompt(ctx, sid, blocks, actions, valid, recall);
              if (!sent && view.current?.session === sid) setNotice("未发送：请检查原附件和当前草稿");
            } catch {
              if (view.current?.session === sid) setNotice("提交失败，请检查当前草稿");
            } finally {
              if (sent) locks.set(actions, { lastAnswer: last, until: Date.now() + 650 });
              else locks.delete(actions);
            }
          }
        }, label);
      }
      return h(
        React.Fragment,
        null,
        content ? button("重新生成", content) : null,
        last && last === props.messageId ? button("继续生成", [{ type: "text", text: "继续" }]) : null,
        notice ? h("span", { "data-pane-find-ui": "notice", role: "status" }, notice) : null
      );
    }
    contribute(slots, "conversation.input.dock", "history", 40, History);
    contribute(slots, "conversation.chat.assistant-actions", "actions", 21, Actions);
  }

  // src/client.js
  window.__ModuleLoader__.load({
    id: "dsh-pane-find",
    factory(require2) {
      const React = require2("react"), h = React.createElement;
      return { inject: ["slots"], apply(ctx) {
        let panel;
        ctx.effect(() => {
          const style = document.createElement("style");
          style.setAttribute("data-pane-find-ui", "style");
          style.textContent = panelCSS;
          document.head.append(style);
          panel = createPanel(document);
          return () => {
            panel.dispose();
            style.remove();
          };
        }, "pane-find overlay");
        contribute(ctx.get("slots"), "conversation.session.header.utilities", "trigger", -10, () => h("button", {
          type: "button",
          className: "pf-trigger",
          "data-pane-find-ui": "trigger",
          "aria-label": "页内查找",
          title: "页内查找",
          onClick: () => panel?.open("icon")
        }, h("svg", { viewBox: "0 0 20 20", width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true }, h("circle", { cx: 8.2, cy: 8.2, r: 5.5 }), h("path", { d: "m12.5 12.5 4.5 4.5", strokeLinecap: "round" }))));
        installConversation(ctx, React);
      } };
    }
  });
})();
