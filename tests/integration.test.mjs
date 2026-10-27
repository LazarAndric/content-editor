import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {createContent,createContentStore} from '../src/index.mjs';
import {createContentNavigation} from '../src/navigation.mjs';
import {createContentClient} from '../src/client.mjs';
import {mountContentTree,mountContentBlocks} from '../src/vanilla.mjs';
import {initContentProject} from '../src/init.mjs';
import {exportContentSite} from '../src/export-site.mjs';
import {startContentServer} from '../src/server.mjs';
import {run} from '../src/cli.mjs';

const definition={groups:{main:{label:'Main',parentId:null}}};
const fixture=()=>createContent({languages:[{code:'en',label:'English'},{code:'sr',label:'Srpski'}],nodes:[
  {id:'a',parentId:null,order:0,label:'a',title:'a',blocks:[{id:'body',type:'text',key:'body'}]},
  {id:'a1',parentId:'a',order:0,label:'a1',title:'a1',blocks:[]},
  {id:'a2',parentId:'a1',order:0,label:'a2',title:'a2',blocks:[]},
  {id:'b',parentId:null,order:1,label:'b',title:'b',blocks:[]},
  {id:'b1',parentId:'b',order:0,label:'b1',title:'b1',blocks:[]},
],texts:{a:{en:'Alpha',sr:'Alfa'},a1:{en:'Child'},a2:{en:'Deep'},b:{en:'Beta'},b1:{en:'Other child'},body:{en:'**Bold** body'}}});
async function temp(t){const root=await mkdtemp(path.join(tmpdir(),'kit-integration-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;}
function setup(){const store=createContentStore({content:fixture(),definition});return {store,navigation:createContentNavigation({store,group:'main'})};}
async function close(server){await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});}

test('accordion selection expands ancestors, repeat activation collapses, and branches remain mutually exclusive',()=>{
  const {store,navigation:nav}=setup();
  assert.equal(nav.getSnapshot().selectedId,'a');assert.deepEqual(nav.getSnapshot().expandedIds,['a']);
  nav.select('a2');assert.deepEqual(nav.getSnapshot().expandedIds,['a','a1']);
  assert.equal(nav.rows().find(row=>row.item.id==='a').active,true);
  nav.activate('b');assert.deepEqual(nav.getSnapshot().expandedIds,['b']);
  nav.activate('b');assert.deepEqual(nav.getSnapshot().expandedIds,[]);
  const next=fixture();next.texts.a.en='Updated';store.setContent(next);
  assert.deepEqual(nav.getSnapshot().expandedIds,[]);assert.equal(nav.getSnapshot().selectedId,'b');
  assert.throws(()=>nav.select('missing'),/Unknown/);nav.destroy();
});

test('live updates preserve state; deleted selection falls back to ancestor then first root, languages reconcile',()=>{
  const {store,navigation:nav}=setup();nav.select('a2');nav.setLanguage('sr');
  const next=fixture();next.nodes=next.nodes.filter(node=>node.id!=='a2');store.setContent(next);
  assert.equal(nav.getSnapshot().selectedId,'a1');
  next.nodes=next.nodes.filter(node=>!['a','a1'].includes(node.id));next.languages=[{code:'en',label:'English'}];store.setContent(next);
  assert.equal(nav.getSnapshot().selectedId,'b');assert.equal(nav.getSnapshot().language,'en');
  assert.deepEqual(nav.getSnapshot().expandedIds,['b']);
  next.nodes=[];store.setContent(next);assert.equal(nav.getSnapshot().selectedId,null);nav.destroy();
});

test('named collection stays scoped and tree mode permits independent open branches',()=>{
  const store=createContentStore({content:fixture(),definition:{groups:{nested:{parentId:'a'}}}});
  const nav=createContentNavigation({store,group:'nested',selectFirst:false,mode:'tree'});
  assert.equal(nav.getSnapshot().selectedId,null);assert.throws(()=>nav.select('b'),/Unknown/);
  nav.select('a2');assert.deepEqual(nav.rows().map(row=>row.item.id),['a1','a2']);nav.destroy();
  const root=createContentNavigation({store,mode:'tree'});root.select('b');assert.deepEqual(root.getSnapshot().expandedIds,['a','b']);root.destroy();
});

test('vanilla adapter retains project classes, focus, active ancestors and keyboard control through updates',()=>{
  const dom=new JSDOM('<nav></nav>'),document=dom.window.document,{store,navigation:nav}=setup();
  const mounted=mountContentTree({container:document.querySelector('nav'),navigation:nav,renderItem:({item,active})=>{
    const button=document.createElement('button');button.className=active?'project active':'project';button.textContent=item.label;return button;
  }});
  document.querySelector('[data-content-id="a1"]').click();
  let button=document.querySelector('[data-content-id="a1"]');button.focus();
  const next=fixture();next.texts.a1.en='Changed child';store.setContent(next);
  assert.equal(document.activeElement.dataset.contentId,'a1');assert.equal(document.activeElement.textContent,'Changed child');
  assert.equal(document.querySelector('[data-content-id="a"]').className,'project active');
  document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
  assert.equal(document.activeElement.dataset.contentId,'a2');
  document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
  assert.equal(nav.getSnapshot().selectedId,'a2');
  mounted.destroy();nav.destroy();dom.window.close();
});

test('block rendering sanitizes text, reports empty states, resolves variants and handles missing media files',()=>{
  const dom=new JSDOM('<section></section>');
  const data=fixture();data.nodes[0].blocks.push({id:'photo',type:'image',media:'photo'});data.media.photo={type:'image',files:{en:'/content-media/one.png',sr:'/content-media/two.png'}};
  const store=createContentStore({content:data,definition}),nav=createContentNavigation({store,group:'main'});
  const container=dom.window.document.querySelector('section'),mounted=mountContentBlocks({container,store,navigation:nav});
  assert.equal(container.querySelector('strong').textContent,'Bold');nav.setLanguage('sr');
  assert.equal(container.querySelector('img').getAttribute('src'),'/content-media/two.png');
  container.querySelector('img').dispatchEvent(new dom.window.Event('error'));assert.match(container.textContent,/Missing media: photo/);
  nav.select('a1');assert.equal(container.dataset.contentState,'children-only');
  nav.select('a2');assert.equal(container.dataset.contentState,'empty');
  mounted.destroy();nav.destroy();dom.window.close();
});

test('starter initialization is non-destructive and generates one dev command with no Python',async t=>{
  const root=await temp(t);await initContentProject({directory:root});
  const metadata=JSON.parse(await readFile(path.join(root,'package.json')));assert.equal(metadata.scripts.dev,'content-kit dev');
  const ownMetadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.ok(metadata.dependencies[ownMetadata.name]);
  assert.ok((await readFile(path.join(root,'content-kit.config.mjs'),'utf8')).includes(`from '${ownMetadata.name}'`));
  const original=await readFile(path.join(root,'public/index.html'),'utf8');assert.ok(!original.includes('python'));
  await assert.rejects(initContentProject({directory:root}),/already exists/);assert.equal(await readFile(path.join(root,'public/index.html'),'utf8'),original);
  const existing=path.join(root,'existing');await mkdir(path.join(existing,'public'),{recursive:true});await writeFile(path.join(existing,'public/index.html'),'Keep this');
  await assert.rejects(initContentProject({directory:existing}),/File already exists/);
  await assert.rejects(access(path.join(existing,'content-kit.config.mjs')));
});

test('one server serves site, editor, complete browser modules, media and live updates; private files stay outside public root',async t=>{
  const root=await temp(t),site=path.join(root,'public'),directory=path.join(root,'data');await mkdir(site);await writeFile(path.join(site,'index.html'),'<h1>Existing site</h1>');
  await writeFile(path.join(root,'secret.txt'),'private');await symlink(path.join(root,'secret.txt'),path.join(site,'escape.txt'));
  const server=await startContentServer({directory,siteDirectory:site,initialContent:fixture(),definition,port:0});t.after(()=>close(server));
  const base=`http://127.0.0.1:${server.address().port}/`;
  assert.match(await(await fetch(base)).text(),/Existing site/);assert.equal((await fetch(base+'editor')).status,200);
  const editorFormat=await(await fetch(base+'content-format.js')).text();
  assert.ok(editorFormat.includes('./compatibility.mjs'));
  assert.equal((await fetch(new URL('./compatibility.mjs',base+'content-format.js'))).status,200);
  assert.equal((await fetch(base+'escape.txt')).status,404);assert.equal((await fetch(base+'.env')).status,404);
  // Follow every relative import from the supported browser entry point.
  const pending=['content-kit/browser.mjs'],visited=new Set();
  while(pending.length){const url=new URL(pending.pop(),base).href;if(visited.has(url))continue;visited.add(url);const response=await fetch(url);assert.equal(response.status,200,url);const source=await response.text();for(const match of source.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g)){assert.ok(match[1].startsWith('.'),`Unexpected bare import: ${match[1]}`);pending.push(new URL(match[1],url).href);}}
  assert.ok(visited.size>=9);
  const events=await fetch(base+'api/events'),reader=events.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/event: content/);
  const content=fixture();content.texts.a.en='Live change';
  const saved=await fetch(base+'api/content',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:0,content})});assert.equal(saved.status,200);
  assert.match(new TextDecoder().decode((await reader.read()).value),/Live change/);await reader.cancel();
});

test('client connects live by default, resolves media on the same origin, and closes the connection',async()=>{
  const instances=[];class Events{constructor(url){this.url=url;this.handlers={};instances.push(this);}addEventListener(name,fn){this.handlers[name]=fn;}close(){this.closed=true;}}
  const content=fixture();content.media.photo={type:'image',files:{default:'/content-media/photo.png'}};
  const client=await createContentClient({baseUrl:'http://example.test/',EventSource:Events,fetch:async url=>({ok:true,json:async()=>String(url).endsWith('api/content')?{content}:definition})});
  assert.equal(instances[0].url,'http://example.test/api/events');assert.equal(client.store.media('photo').url,'http://example.test/content-media/photo.png');
  const next=fixture();next.texts.a.en='Updated';instances[0].handlers.content({data:JSON.stringify(next)});assert.equal(client.store.item('a').label,'Updated');
  client.close();assert.equal(instances[0].closed,true);
});

test('static export includes client and all language media; static client never contacts editor or localhost',async t=>{
  const root=await temp(t),directory=path.join(root,'data');await mkdir(path.join(directory,'content-media'),{recursive:true});
  const content=fixture();content.media.photo={type:'image',files:{en:'/content-media/en.png',sr:'/content-media/sr.png'}};
  await writeFile(path.join(directory,'content-editor.json'),JSON.stringify(content));
  for(const name of ['en','sr'])await writeFile(path.join(directory,`content-media/${name}.png`),name);
  const output=path.join(root,'dist');await exportContentSite({directory,outDirectory:output,definition});
  assert.equal(await readFile(path.join(output,'content-media/sr.png'),'utf8'),'sr');
  assert.match(await readFile(path.join(output,'content-kit/runtime.mjs'),'utf8'),/staticUrl/);
  assert.match(await readFile(path.join(output,'content-kit/vendor/marked.LICENSE.txt'),'utf8'),/MIT/);
  assert.ok((await readFile(path.join(output,'content-kit/vendor/dompurify.LICENSE.txt'),'utf8')).length>100);
  assert.ok(!(await readFile(path.join(output,'content-kit/format.mjs'),'utf8')).includes("from 'dompurify'"));
  const urls=[],client=await createContentClient({baseUrl:'https://example.test/sub/',staticUrl:'./content.json',EventSource:class{constructor(){assert.fail('Static mode must not open SSE');}},fetch:async url=>{urls.push(String(url));return {ok:true,json:async()=>JSON.parse(await readFile(path.join(output,'content.json'),'utf8'))};}});
  assert.deepEqual(urls,['https://example.test/sub/content.json']);assert.equal(client.store.media('photo','sr').url,'https://example.test/sub/content-media/sr.png');client.close();
  await assert.rejects(exportContentSite({directory,outDirectory:output,definition}),/already exists/);
  content.media.photo.files.sr='/content-media/missing.png';await writeFile(path.join(directory,'content-editor.json'),JSON.stringify(content));
  await assert.rejects(exportContentSite({directory,outDirectory:path.join(root,'bad'),definition}));await assert.rejects(access(path.join(root,'bad')));
});

test('generated vanilla project starts through the CLI and exports the same site without requiring a prior editor save',async t=>{
  const root=await temp(t);await initContentProject({directory:root});
  const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const destination=path.join(root,'node_modules',metadata.name);await mkdir(path.dirname(destination),{recursive:true});
  await symlink(fileURLToPath(new URL('../',import.meta.url)),destination,process.platform==='win32'?'junction':'dir');
  const config=path.join(root,'content-kit.config.mjs');
  const server=await run(['dev','--config',config,'--port','0']);
  try{const base=`http://127.0.0.1:${server.address().port}/`;assert.match(await(await fetch(base)).text(),/Content Kit example/);assert.equal((await fetch(base+'editor')).status,200);assert.match(await(await fetch(base+'app.mjs')).text(),/mountContentTree/);}finally{await close(server);}
  const settings=(await import(pathToFileURL(config))).default;
  await exportContentSite({...settings,directory:path.join(root,'content'),siteDirectory:path.join(root,'public'),outDirectory:path.join(root,'dist')});
  assert.match(await readFile(path.join(root,'dist/index.html'),'utf8'),/Content Kit example/);
  const manifest=JSON.parse(await readFile(path.join(root,'dist/content.json'),'utf8'));assert.equal(manifest.content.nodes.length,3);
});
