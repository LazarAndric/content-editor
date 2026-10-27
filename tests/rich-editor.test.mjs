import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {startContentServer} from '../src/server.mjs';

const require=createRequire(import.meta.url);
test('real MIT editor keeps untouched legacy HTML and flushes rich changes before tab teardown',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'content-editor-rich-'));
  const initial=JSON.parse(await readFile(new URL('./fixtures/v0.3-content.json',import.meta.url),'utf8'));
  initial.texts['root.body'].fr+='<table style="width: 100%"><tbody><tr><td>Existing cell</td></tr></tbody></table>';
  const filename=path.join(root,'content-editor.json'),original=JSON.stringify(initial,null,3);
  await writeFile(filename,original);
  const server=await startContentServer({directory:root,port:0});
  const base=`http://127.0.0.1:${server.address().port}`;
  const html=await(await fetch(base+'/editor')).text();
  const dom=new JSDOM(html,{url:base+'/editor',runScripts:'outside-only',pretendToBeVisual:true});
  dom.window.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}};
  dom.window.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  dom.window.visualViewport={width:1280,height:800,offsetLeft:0,offsetTop:0,addEventListener(){},removeEventListener(){}};
  Object.defineProperty(dom.window.HTMLElement.prototype,'innerText',{get(){return this.textContent;},set(value){this.textContent=value;}});
  // jsdom has no layout or canvas; editor rendering is checked in a real browser.
  dom.window.HTMLCanvasElement.prototype.getContext=()=>({
    createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),putImageData(){},
    getImageData:()=>({data:new Uint8ClampedArray([0,0,0,255])}),
    createLinearGradient:()=>({addColorStop(){}}),fillRect(){},clearRect(){},drawImage(){},beginPath(){},arc(){},fill(){},
  });
  const errors=[];dom.window.addEventListener('error',event=>{errors.push(event.error);event.preventDefault();});
  const vendor=await fetch(base+'/vendor/suneditor/suneditor.min.js');assert.equal(vendor.status,200);
  assert.match(await(await fetch(base+'/vendor/suneditor/LICENSE.txt')).text(),/MIT License/);
  dom.window.eval(await vendor.text());
  const instances=[],create=dom.window.SUNEDITOR.create;
  dom.window.SUNEDITOR.create=function(target,options){
    const result=create.call(this,target,options);instances.push({target,editor:result});return result;
  };
  const globals=['window','document','EventSource','FormData','confirm','localStorage','fetch','setTimeout'];
  const saved=Object.fromEntries(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  const nativeFetch=globalThis.fetch,nativeTimeout=globalThis.setTimeout,timers=new Set();
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,EventSource:class{addEventListener(){}},
    FormData:dom.window.FormData,confirm:()=>true,localStorage:dom.window.localStorage,
    fetch:(url,options)=>nativeFetch(new URL(url,base),options),
    setTimeout:(fn,delay,...args)=>{const timer=nativeTimeout(fn,delay,...args);timers.add(timer);return timer;}});
  t.after(async()=>{
    for(const timer of timers)clearTimeout(timer);
    for(const [key,value] of Object.entries(saved))if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];
    dom.window.close();await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
    await rm(root,{recursive:true,force:true});
  });
  const waitFor=async predicate=>{for(let attempt=0;attempt<100;attempt++){if(await predicate())return;await new Promise(resolve=>nativeTimeout(resolve,10));}assert.fail('Timed out waiting for the editor');};
  let source=await readFile(new URL('../editor/content-editor.js',import.meta.url),'utf8');
  for(const [from,to] of [['./content-format.js','format.mjs'],['./content-kit/fields.mjs','fields.mjs'],['./content-kit/diagnostics.mjs','diagnostics.mjs'],['./content-kit/model.mjs','model.mjs']])source=source.replace(from,new URL('../src/'+to,import.meta.url).href);
  const moduleFile=path.join(root,'editor.mjs');await writeFile(moduleFile,source);await import(pathToFileURL(moduleFile));
  await waitFor(()=>instances.length===3&&dom.window.document.querySelectorAll('.sun-editor-editable').length===3);
  await new Promise(resolve=>nativeTimeout(resolve,30));
  assert.equal(await readFile(filename,'utf8'),original,'Opening must not rewrite content');
  const body=instances.find(record=>record.target.dataset.lang==='fr');
  assert.match(body.editor.$.html.get(),/Existing cell/);
  const plain=dom.window.document.querySelector('[data-text="root.label"][data-lang="fr"]');
  plain.value='Changed label';plain.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  dom.window.document.querySelector('#save').click();
  await waitFor(async()=>JSON.parse(await readFile(filename,'utf8')).revision===1);
  assert.equal(JSON.parse(await readFile(filename,'utf8')).texts['root.body'].fr,initial.texts['root.body'].fr);
  body.editor.$.html.set('<p><strong>Edited</strong> <span style="color: #ff0000">red</span></p><table style="width: 75%"><tbody><tr><td>Kept cell</td></tr></tbody></table>');
  dom.window.document.querySelector('[data-tab="texts"]').click();
  dom.window.document.querySelector('#save').click();
  await waitFor(async()=>JSON.parse(await readFile(filename,'utf8')).revision===2);
  const content=JSON.parse(await readFile(filename,'utf8'));
  assert.match(content.texts['root.body'].fr,/Edited/);assert.match(content.texts['root.body'].fr,/<table/);
  assert.match(content.texts['root.body'].fr,/Kept cell/);assert.match(content.texts['root.body'].fr,/color:/);
  assert.match(content.texts['root.body'].fr,/width: 75%/);
  assert.equal(content.texts['root.label'].fr,'Changed label');
  assert.deepEqual(content.media,initial.media);assert.deepEqual(errors,[]);
});
