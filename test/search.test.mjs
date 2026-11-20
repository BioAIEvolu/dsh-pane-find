import test from 'node:test';
import assert from 'node:assert/strict';
import {literalPattern} from '../src/search.js';
import {combo,fingerprint} from '../src/panel.js';
test('Chinese mixes with case-insensitive literal punctuation',()=>{assert.deepEqual([...('页内[a] 页内[A] 页内a').matchAll(literalPattern('页内[a]'))].map(m=>m.index),[0,6]);assert.equal(literalPattern(''),null);});
test('Unicode folds do not shift UTF-16 offsets into adjacent letters',()=>{const m=literalPattern('x').exec('İ🙂X!');assert.equal(m.index,3);assert.equal(m[0],'X');});
test('literal metacharacters, slash and backslash are searchable',()=>{const all='^$.*+?()[]{}|/\\';for(const char of all)assert.equal(literalPattern(char).exec('a'+char+'b')[0],char);});
test('shortcut capture preserves modifiers and ignores composition/AltGr/typing',()=>{assert.equal(combo({key:'f',metaKey:true}),'Mod+F');assert.equal(combo({key:'j',ctrlKey:true,shiftKey:true}),'Mod+Shift+J');assert.equal(combo({key:'f'}),'');assert.equal(combo({key:'f',ctrlKey:true,isComposing:true}),'');assert.equal(combo({key:'x',altKey:true,getModifierState:()=>true}),'');});
test('saved results detect changed snippets',()=>{assert.notEqual(fingerprint('重复·上'), fingerprint('重复·下'));assert.equal(fingerprint('重复'),fingerprint('重复'));});
