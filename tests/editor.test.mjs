import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {createContent} from '../src/index.mjs';
import {startContentServer} from '../src/server.mjs';

test('editor creates shared text with translations, exposes declared fields and persists metadata through normal saves',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'kit-editor-ui-'));
  const server=await startContentServer({directory:path.join(root,'content'),initialContent:createContent(),definition:{textFields:[{key:'declared',label:'Declared title',initialValues:{en:'Initial'}}]},port:0});
  const base=`http://127.0.0.1:${server.address().port}`,html=await readFile(new URL('../editor/content-editor.html',import.meta.url),'utf8'),dom=new JSDOM(html,{url:base+'/editor'});
  const globals=['window','document','EventSource','FormData','confirm','localStorage','fetch','setTimeout'],saved=Object.fromEntries(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)])),nativeFetch=globalThis.fetch,nativeTimeout=globalThis.setTimeout,timers=new Set();
  const errors=[];dom.window.addEventListener('error',event=>{errors.push(event.error);event.preventDefault();});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,EventSource:class{addEventListener(){}},FormData:dom.window.FormData,confirm:()=>true,localStorage:dom.window.localStorage,fetch:(url,options)=>nativeFetch(new URL(url,base),options),setTimeout:(fn,delay,...args)=>{const timer=nativeTimeout(fn,delay,...args);timers.add(timer);return timer;}});
  t.after(async()=>{for(const timer of timers)clearTimeout(timer);for(const [key,value] of Object.entries(saved))if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];dom.window.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});await rm(root,{recursive:true,force:true});});
  let source=await readFile(new URL('../editor/content-editor.js',import.meta.url),'utf8');
  for(const [from,to] of [['./content-format.js','format.mjs'],['./content-kit/fields.mjs','fields.mjs'],['./content-kit/diagnostics.mjs','diagnostics.mjs'],['./content-kit/model.mjs','model.mjs']])source=source.replace(from,new URL('../src/'+to,import.meta.url).href);
  const moduleFile=path.join(root,'editor.mjs');await writeFile(moduleFile,source);await import(pathToFileURL(moduleFile));
  const document=dom.window.document;document.querySelector('[data-tab="shared"]').click();
  assert.match(document.querySelector('#workspace').textContent,/Declared title/);assert.ok(document.querySelector('#apply-text-fields'));
  const form=document.querySelector('#new-shared-text');form.elements.namedItem('key').value='home.hero.title';form.elements.namedItem('label').value='Hero';form.elements.namedItem('locale-en').value='Editor-created title';
  form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  assert.ok(document.querySelector('[data-field-key="home.hero.title"]'));
  document.querySelector('#save').click();
  let stored;for(let attempt=0;attempt<30;attempt++){stored=(await(await nativeFetch(base+'/api/content')).json()).content;if(stored.texts['home.hero.title'])break;await new Promise(resolve=>nativeTimeout(resolve,15));}
  assert.equal(stored.texts['home.hero.title'].en,'Editor-created title');assert.equal(stored.textFields['home.hero.title'].label,'Hero');
  const apply=document.querySelector('#apply-text-fields');apply.click();
  for(let attempt=0;attempt<30;attempt++){stored=(await(await nativeFetch(base+'/api/content')).json()).content;if(stored.texts.declared)break;await new Promise(resolve=>nativeTimeout(resolve,15));}
  assert.equal(stored.texts.declared.en,'Initial');assert.equal(stored.texts['home.hero.title'].en,'Editor-created title');assert.deepEqual(errors,[]);
});
