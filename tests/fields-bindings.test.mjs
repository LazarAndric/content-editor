import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {JSDOM} from 'jsdom';
import {createContent,createContentStore,validateContent} from '../src/index.mjs';
import {applyTextFields,planTextFields} from '../src/fields.mjs';
import {diagnoseContent} from '../src/diagnostics.mjs';
import {bindContent,renderContentMessage,mountLanguageSwitcher} from '../src/bindings.mjs';
import {createContentNavigation} from '../src/navigation.mjs';
import {mountContentTree,mountContentBlocks} from '../src/vanilla.mjs';
import {exportContentWorkbook,importContentWorkbook} from '../src/xlsx.mjs';
import {startContentServer} from '../src/server.mjs';
import {exportContentSite} from '../src/export-site.mjs';
import {inspectContentProject} from '../src/doctor.mjs';

const definition={groups:{main:{parentId:null}},textFields:[{key:'hero',label:'Heading',type:'message',components:['accent'],required:true,initialValues:{en:'Hello {accent}world{/accent}'}}]};
const fixture=()=>createContent({languages:[{code:'en',label:'English'},{code:'ar',label:'العربية',dir:'rtl'}],nodes:[{id:'a',parentId:null,order:0,label:'a',title:'a',blocks:[]},{id:'b',parentId:'a',order:0,label:'b',title:'b',blocks:[]}],texts:{a:{default:'A'},b:{default:'B'}}});
const temp=async t=>{const root=await mkdtemp(path.join(tmpdir(),'kit-bindings-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;};

test('field registration is explicit, idempotent, protects metadata and never replaces existing translations',()=>{
  const original=fixture();original.texts.hero={en:'Existing',ar:'موجود'};
  const plan=planTextFields(original,definition);assert.equal(plan[0].createText,false);assert.equal(original.textFields,undefined);
  const next=applyTextFields(original,definition);assert.deepEqual(next.texts.hero,original.texts.hero);assert.equal(next.textFields.hero.label,'Heading');assert.deepEqual(planTextFields(next,definition),[]);
  assert.throws(()=>validateContent({...next,textFields:{hero:null}}),/Invalid/);
});

test('binder handles plain, rich, named markers and safe attributes across language changes and live deletion',()=>{
  const dom=new JSDOM('<h1 data-content-message="hero"></h1><p data-content-text="plain"></p><div data-content-rich="rich"></div><input data-content-attr="placeholder:plain; onclick:plain"><span data-content-text="absent" data-content-fallback="Fallback"></span>');
  const data=applyTextFields(fixture(),definition);data.texts.hero.ar='{accent}العالم{/accent} مرحبا';data.texts.plain={en:'<img src=x onerror=alert(1)>',ar:'Arabic'};data.texts.rich={default:'**Bold** <script>alert(1)</script>'};
  const store=createContentStore({content:data,definition}),navigation=createContentNavigation({store,group:'main'}),components={accent:doc=>doc.createElement('em')};
  const bound=bindContent({root:dom.window.document,store,navigation,components,bindings:[{selector:'#missing',key:'plain'}]});
  assert.equal(dom.window.document.querySelector('h1 em').textContent,'world');assert.equal(dom.window.document.querySelector('p').textContent,data.texts.plain.en);assert.equal(dom.window.document.querySelector('p img'),null);
  assert.equal(dom.window.document.querySelector('input').getAttribute('placeholder'),data.texts.plain.en);assert.equal(dom.window.document.querySelector('input').hasAttribute('onclick'),false);
  assert.ok(dom.window.document.querySelector('strong'));assert.equal(dom.window.document.querySelector('script'),null);
  assert.equal(dom.window.document.querySelector('span[data-content-text]').textContent,'Fallback');assert.ok(bound.getReport().some(issue=>issue.code==='missing-element'));assert.ok(bound.getReport().some(issue=>issue.code==='unsupported-attribute'));
  navigation.setLanguage('ar');assert.ok(dom.window.document.querySelector('h1').textContent.startsWith('العالم'));
  const next=structuredClone(data);delete next.texts.plain;store.setContent(next);assert.equal(dom.window.document.querySelector('p').textContent,'');assert.ok(bound.getReport().some(issue=>issue.key==='plain'&&issue.code==='missing-key'));
  bound.destroy();navigation.destroy();dom.window.close();
});

test('message components are an allowlist and malformed nesting is rejected',()=>{
  const dom=new JSDOM();assert.throws(()=>renderContentMessage(dom.window.document,'{script}bad{/script}',{}),/Unknown/);assert.throws(()=>renderContentMessage(dom.window.document,'{accent}bad',{accent:doc=>doc.createElement('em')}),/Unclosed/);
  const content=applyTextFields(fixture(),definition);content.texts.hero={default:'{unknown}Text{/unknown}'};assert.equal(diagnoseContent(content,definition).ok,false);dom.window.close();
});

test('language switcher shares navigation state, persists choice and updates lang and direction after removal',()=>{
  const dom=new JSDOM('<select></select>',{url:'http://example.test'}),data=fixture(),store=createContentStore({content:data}),navigation=createContentNavigation({store});
  dom.window.localStorage.setItem('lang','ar');const mounted=mountLanguageSwitcher({select:dom.window.document.querySelector('select'),navigation,persistKey:'lang'});
  assert.equal(navigation.getSnapshot().language,'ar');assert.equal(dom.window.document.documentElement.dir,'rtl');
  const next=fixture();next.languages=next.languages.filter(locale=>locale.code!=='ar');store.setContent(next);
  assert.equal(navigation.getSnapshot().language,'en');assert.equal(dom.window.document.documentElement.lang,'en');assert.equal(dom.window.localStorage.getItem('lang'),'en');mounted.destroy();navigation.destroy();dom.window.close();
});

test('tree wrapper hooks keep div markup and separate name/toggle actions without nested buttons',()=>{
  const dom=new JSDOM('<nav></nav>'),document=dom.window.document,store=createContentStore({content:fixture()}),navigation=createContentNavigation({store});
  const tree=mountContentTree({container:document.querySelector('nav'),navigation,semantics:'buttons',action:'select',createTree:()=>document.createDocumentFragment(),createItem:()=>document.createElement('div'),createGroup:()=>document.createElement('div'),renderItem:({item,hasChildren})=>{
    const row=document.createElement('div'),select=document.createElement('button');select.dataset.contentAction='select';select.textContent=item.label;row.append(select);if(hasChildren){const toggle=document.createElement('button');toggle.dataset.contentAction='toggle';toggle.setAttribute('aria-label','Toggle children');row.append(toggle);}row.tabIndex=0;return row;
  }});
  assert.equal(document.querySelector('ul'),null);document.querySelector('[data-content-action="toggle"]').click();assert.deepEqual(navigation.getSnapshot().expandedIds,[]);
  document.querySelector('[data-content-action="select"]').click();assert.deepEqual(navigation.getSnapshot().expandedIds,['a']);assert.equal(document.querySelector('button button'),null);tree.destroy();navigation.destroy();dom.window.close();
});

test('block expansion updates preserve video elements; localized alt, styling hooks and message callbacks work',()=>{
  const dom=new JSDOM('<section></section>'),document=dom.window.document,data=fixture();
  data.media.movie={type:'video',files:{default:'/content-media/video.mp4'}};data.media.photo={type:'image',files:{default:'/content-media/photo.png'},alt:'photo.alt',decorative:false};data.texts['photo.alt']={default:'A mountain'};
  data.nodes[0].blocks=[{id:'copy',type:'text',key:'copy'},{id:'movie',type:'video',media:'movie'},{id:'image',type:'image',media:'photo'}];data.texts.copy={default:'Original'};
  const store=createContentStore({content:data}),navigation=createContentNavigation({store}),container=document.querySelector('section');
  const mounted=mountContentBlocks({container,store,navigation,classNames:{video:'project-video'},wrapBlock:({element})=>{const wrapper=document.createElement('article');wrapper.append(element);return wrapper;},messages:{'missing-media':({block})=>`Unavailable ${block.id}`}});
  const video=container.querySelector('video');assert.equal(video.className,'project-video');assert.equal(container.querySelector('img').alt,'A mountain');navigation.toggle('a');assert.equal(container.querySelector('video'),video);
  const next=structuredClone(data);next.texts.unrelated={en:'Changed'};store.setContent(next);assert.equal(container.querySelector('video'),video);
  const observer=new dom.window.MutationObserver(()=>{});observer.observe(container,{childList:true});next.texts.copy.default='Updated paragraph';store.setContent(next);assert.equal(container.querySelector('video'),video);assert.match(container.textContent,/Updated paragraph/);assert.ok(observer.takeRecords().every(record=>![...record.removedNodes].some(node=>node===video||node.contains?.(video))));observer.disconnect();
  container.querySelector('img').dispatchEvent(new dom.window.Event('error'));assert.match(container.textContent,/Unavailable image/);mounted.destroy();navigation.destroy();dom.window.close();
});

test('optional fields, image descriptions, roles, icon metadata and directions survive full Excel round-trip',async()=>{
  const content=applyTextFields(fixture(),definition);content.nodes[0].meta={icon:'travel',contentType:'article'};content.media.cover={type:'image',files:{default:'/content-media/cover.png'},alt:'cover.alt',decorative:false};content.texts['cover.alt']={default:'Cover'};content.nodes[0].blocks=[{id:'cover',type:'image',media:'cover',role:'cover'}];
  const imported=(await importContentWorkbook(await exportContentWorkbook(content),content)).content;
  assert.deepEqual(imported.textFields,content.textFields);assert.deepEqual(imported.media,content.media);assert.deepEqual(imported.nodes,content.nodes);assert.deepEqual(imported.languages,content.languages);
});

test('registration HTTP plan applies with revision protection, and required fields block static export',async t=>{
  const root=await temp(t),directory=path.join(root,'data'),server=await startContentServer({directory,initialContent:fixture(),definition,port:0});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));const base=`http://127.0.0.1:${server.address().port}`;
  const plan=await(await fetch(base+'/api/fields/plan')).json();assert.equal(plan.changes[0].key,'hero');
  const response=await fetch(base+'/api/fields/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:0})});assert.equal(response.status,200);
  const stale=await fetch(base+'/api/fields/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:0})});assert.equal(stale.status,409);
  const diagnostics=await(await fetch(base+'/api/diagnostics')).json();assert.equal(diagnostics.ok,false); // Arabic required title is still missing.
  await assert.rejects(exportContentSite({directory,outDirectory:path.join(root,'export'),definition}),/Required content/);
});

test('doctor identifies missing HTML keys, file references and valid registered content without starting a server',async t=>{
  const root=await temp(t),directory=path.join(root,'data'),site=path.join(root,'site');await mkdir(directory);await mkdir(site);await writeFile(path.join(site,'index.html'),'<h1 data-content-text="missing"></h1>');
  const content=applyTextFields(fixture(),definition);content.texts.hero.default='Hello';content.media.test={type:'video',files:{default:'/content-media/missing.mp4'}};
  await writeFile(path.join(directory,'content-editor.json'),JSON.stringify(content));const report=await inspectContentProject({directory,siteDirectory:site,definition});assert.equal(report.ok,false);assert.ok(report.issues.some(issue=>issue.code==='html-missing-key'));assert.ok(report.issues.some(issue=>issue.code==='media-file'));
});
