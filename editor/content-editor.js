import { contentHtml, storeContentHtml, sanitizeContentHtml } from './content-format.js';
import {textFieldDefinitions,planTextFields} from './content-kit/fields.mjs';
import {diagnoseContent} from './content-kit/diagnostics.mjs';
import {validKey} from './content-kit/model.mjs';

let content, selectedId = null, language = null, tab = 'content', dirty = false, saving = false, changed = 0, timer, conflict = false;
let configuration={title:'Content',groups:{},protectedTextKeys:[],mediaFields:[],fieldLabels:{},preview:false}, selectedGroup=null;
const groupParent=()=>selectedGroup ? configuration.groups[selectedGroup].parentId : null;
const permanentMedia=id=>configuration.mediaFields.some(field=>field.id===id);
let expandedNodes = new Set(), treeInitialized = false, importBusy = false, textQuery = '';
let textUsageFilter = 'all', deletedTexts = null;
// Shared screen/control copy is used independently of the editable node tree.
function usedTextKeys() {
  const used=new Set([...configuration.protectedTextKeys,...textFieldDefinitions(content,configuration).map(field=>field.key)]);
  for(const medium of Object.values(content.media))if(medium.alt)used.add(medium.alt);
  for (const node of content.nodes) {
    used.add(node.label); used.add(node.title);
    for (const block of node.blocks) {
      if (block.key) used.add(block.key);
      if (block.heading) used.add(block.heading);
    }
  }
  return used;
}
function deleteUnusedTexts(keys) {
  const used=usedTextKeys(), removable=keys.filter(key=>Object.hasOwn(content.texts,key) && !used.has(key));
  if (!removable.length) return notice('There are no unused texts to delete.');
  const summary=removable.length===1 ? `Delete unused text "${removable[0]}" and all its translations?`
    : `Delete all ${removable.length} unused texts and all their translations?`;
  if (!confirm(summary + '\nYou can undo the most recent deletion until the editor is reloaded.')) return;
  deletedTexts=Object.fromEntries(removable.map(key=>[key,structuredClone(content.texts[key])]));
  for (const key of removable) { delete content.texts[key]; fieldModes.delete(key); fieldLanguages.delete(key); }
  touch(); renderWorkspace();
}
const searchCollapsedNodes = new Set();
const fieldModes = new Map(), fieldLanguages = new Map(), mediaModes = new Map(), mediaLanguages = new Map();
const $ = selector => document.querySelector(selector);
const uid = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const children = parentId => content.nodes.filter(node => node.parentId === parentId).sort((a,b) => a.order-b.order);
const nodeById = id => content.nodes.find(node => node.id === id);
const value = key => [content.texts[key]?.[language],content.texts[key]?.default].find(text=>typeof text==='string' && text.trim()) || '';
const nodeName = node => value(node.label) || content.texts[node.label]?.[content.defaultLanguage]?.trim() || node.id;
const status = text => { $('#status').textContent = text; };
function notice(message, reload = false) {
  $('#notice').hidden = !message;
  $('#notice').textContent = message;
  if (reload) { const button = document.createElement('button'); button.textContent = 'Load saved version'; button.onclick = () => { if (!dirty || confirm('Discard local unsaved changes and load the saved data?')) load(); }; $('#notice').append(button); }
}
async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return data;
}
function touch() {
  dirty = true; changed++; status('Changes pending…');
  clearTimeout(timer); if (!conflict) timer = setTimeout(save, 550);
}
async function save() {
  syncRichEditors();
  clearTimeout(timer);
  if (!dirty || saving || conflict) return !dirty;
  saving = true; const generation = changed; status('Saving…');
  try {
    const result = await request('/api/content', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRevision: content.revision, content }) });
    content.revision = result.revision; content.updatedAt = result.updatedAt;
    dirty = generation !== changed;
    status(dirty ? 'Saving new changes…' : `Saved · revision ${result.revision} · ${new Date(result.updatedAt).toLocaleTimeString()}`);
    if (!conflict) notice('');
    return !dirty;
  } catch (error) {
    if (error.status === 409) conflict = true;
    notice(error.message + ' Your local changes are preserved. Download them from Data and recovery.', conflict);
    status('Not saved'); return false;
  } finally { saving = false; if (dirty && !conflict && generation !== changed) timer = setTimeout(save, 250); }
}
async function flush() { syncRichEditors(); while (saving) await new Promise(resolve => setTimeout(resolve, 50)); if (dirty && !await save()) return false; return true; }
function languageChoice(id, modes, choices) {
  const all=(modes.get(id) || (content.languages.length<=4 ? 'all' : 'single'))==='all';
  const chosen=content.languages.some(item=>item.code===choices.get(id)) ? choices.get(id) : content.defaultLanguage;
  return {all,chosen,variants:[{code:'default',label:'Default / shared'},...content.languages.filter(item=>all || item.code===chosen)]};
}
function variantControls(id,kind,state) {
  return `<div class="actions"><button class="small" data-${kind}-mode="${escape(id)}">${state.all ? 'Show one language' : 'Show all languages'}</button>${!state.all ? `<select class="field-language" aria-label="Field language ${escape(id)}" data-${kind}-language="${escape(id)}">${content.languages.map(item=>`<option value="${escape(item.code)}" ${item.code===state.chosen ? 'selected' : ''}>${escape(item.label)} (${escape(item.code)})</option>`).join('')}</select>` : ''}</div>`;
}
function textField(key, caption, multiline = false, rich = false, used = null) {
  const state=languageChoice(key,fieldModes,fieldLanguages);
  const heading=rich && content.nodes.some(node=>node.blocks.some(block=>block.type==='heading' && block.key===key));
  const field=textFieldDefinitions(content,configuration).find(field=>field.key===key),registered=Boolean(field);
  if(field?.type==='message'&&field.components?.length)caption+=` · Allowed markers: ${field.components.join(', ')}`;
  const usage=used===null ? '' : `<span class="text-usage ${used ? 'is-used' : 'is-unused'}">${used ? registered?'Registered / protected':'Referenced by content':'Unused'}</span>`;
  const remove=used===false ? `<button class="small danger" data-delete-text="${escape(key)}">Delete text</button>` : '';
  return `<section class="localized-field" data-field-key="${escape(key)}"><div class="heading"><div><h3>${escape(caption)}</h3><span class="key">${escape(key)}</span>${usage}</div><div class="actions">${variantControls(key,'field',state)}${remove}</div></div><div class="translation-grid">${state.variants.map(variant=>{
    const current=content.texts[key]?.[variant.code] ?? '';
    const placeholder=variant.code==='default' ? 'Optional shared value' : content.texts[key]?.default || 'Empty → Default, then a missing-key message';
    const cellTag = rich ? 'div' : 'label';
    return `<${cellTag} class="translation-cell ${variant.code==='default' ? 'default-cell' : ''}">${escape(variant.label)}${variant.code==='default' ? '' : `<span class="language-code">${escape(variant.code)}</span>`}${rich
      ? `<div class="rich-text-editor${heading ? ' rich-heading-editor' : ''}" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${escape(caption)} · ${escape(variant.label)}" data-text="${escape(key)}" data-lang="${escape(variant.code)}" data-placeholder="${escape(placeholder)}">${contentHtml(current)}</div>`
      : multiline
      ? `<textarea data-text="${escape(key)}" data-lang="${escape(variant.code)}" placeholder="${escape(placeholder)}">${escape(current)}</textarea>`
      : `<input data-text="${escape(key)}" data-lang="${escape(variant.code)}" value="${escape(current)}" placeholder="${escape(placeholder)}">`}</${cellTag}>`;
  }).join('')}</div></section>`;
}
const richEditors = new Set();
function storeRichEditorHtml(html) {
  const container=document.createElement('div');container.innerHTML=html;
  // SunEditor moves table dimensions onto its UI wrapper. Preserve those
  // dimensions on the table before the shared sanitizer removes that wrapper.
  for(const wrapper of container.querySelectorAll('figure')){
    const table=wrapper.querySelector(':scope > table');
    if(table)for(const property of ['width','height','margin-left','margin-right']){
      if(!table.style.getPropertyValue(property)&&wrapper.style.getPropertyValue(property))table.style.setProperty(property,wrapper.style.getPropertyValue(property));
    }
  }
  return storeContentHtml(container.innerHTML);
}
function updateRichEditor(record) {
  if (!record.ready || record.content !== content || !record.target.isConnected || !Object.hasOwn(content.texts,record.key)) return;
  const html=record.editor.$.html.get();
  if (html === record.lastHtml) return;
  record.lastHtml=html;
  const stored=storeRichEditorHtml(html);
  if (content.texts[record.key][record.language] === stored) return;
  content.texts[record.key][record.language]=stored;
  touch(); renderTree();
}
function syncRichEditors() { for (const record of richEditors) updateRichEditor(record); }
function destroyRichEditors() {
  syncRichEditors();
  for (const record of richEditors) { record.ready=false; record.editor.destroy(); }
  richEditors.clear();
}
function initRichEditors() {
  const targets=document.querySelectorAll('.rich-text-editor');
  if (!targets.length) return;
  if (!window.SUNEDITOR) { notice('Formatting tools could not be loaded. Refresh the editor.'); return; }
  for (const target of targets) {
    const record={target,key:target.dataset.text,language:target.dataset.lang,content,ready:false};
    try {
      record.editor=window.SUNEDITOR.create(target,{
        plugins:['blockStyle','font','fontSize','fontColor','backgroundColor','align','lineHeight','list','link','table','hr'].map(name=>window.SUNEDITOR.plugins[name]),
        mode:'inline',theme:'dark',height:'auto',minHeight:'110px',statusbar:false,
        value:target.innerHTML,placeholder:target.dataset.placeholder,
        editableFrameAttributes:{role:'textbox','aria-multiline':'true','aria-label':target.getAttribute('aria-label'),spellcheck:'true'},
        strictMode:{tagFilter:true,formatFilter:true,classFilter:true,textStyleTagFilter:true,attrFilter:false,styleFilter:false},
        blockStyle:{items:['p','h1','h2','h3','blockquote','pre']},
        font:{items:['Arial','Georgia','Times New Roman','Courier New']},
        fontSize:{sizeUnit:'em'},
        buttonList:[['undo','redo'],['bold','italic','underline','strike'],['blockStyle','font','fontSize'],['fontColor','backgroundColor'],['align','lineHeight','list','outdent','indent'],['link','table','hr'],['subscript','superscript','dir','removeFormat','codeView']],
        events:{
          onload:({$})=>{
            // Capture the editor's normalized view without rewriting saved strings.
            record.lastHtml=$.html.get();record.ready=true;
          },
          onInput:()=>updateRichEditor(record),
          onChange:()=>updateRichEditor(record),
          onPaste:({event,data})=>{
            const clipboard=event.clipboardData;
            return clipboard && !clipboard.getData('text/html')
              ? contentHtml(clipboard.getData('text/plain')) : sanitizeContentHtml(data);
          },
          onDrop:({data})=>sanitizeContentHtml(data),
        },
      });
      richEditors.add(record);
    } catch(error) { notice('Formatting is unavailable: '+error.message); }
  }
}
function descendants(id) { const found = new Set([id]); for (let previous = -1; previous !== found.size;) { previous = found.size; for (const node of content.nodes) if (found.has(node.parentId)) found.add(node.id); } return found; }
function renderTree() {
  const query = $('#tree-search').value.toLowerCase();
  const show = node => !query || nodeName(node).toLowerCase().includes(query) || node.id.toLowerCase().includes(query) || children(node.id).some(show);
  function branch(parentId) {
    return `<ul>${children(parentId).filter(show).map(node => {
      const childCount=children(node.id).length, expanded=query ? !searchCollapsedNodes.has(node.id) : expandedNodes.has(node.id);
      return `<li><div class="tree-node">${childCount ? `<button class="tree-toggle" aria-label="${expanded ? 'Collapse' : 'Expand'} ${escape(nodeName(node))}" aria-expanded="${expanded}" data-tree-toggle="${escape(node.id)}">${expanded ? '−' : '+'}</button>` : '<span class="tree-spacer"></span>'}<button class="tree-label ${node.id === selectedId ? 'selected' : ''}" data-select="${escape(node.id)}">${escape(nodeName(node))} <small>${node.blocks.length ? `· ${node.blocks.length} bl.` : ''}</small></button></div>${childCount && expanded ? branch(node.id) : ''}</li>`;
    }).join('')}</ul>`;
  }
  $('#tree').innerHTML = content.nodes.length ? branch(groupParent()) : '<p class="empty">Add your first category.</p>';
}
function renderLanguages() {
  if (!content.languages.some(item => item.code === language)) language = content.defaultLanguage;
  $('#language').innerHTML = content.languages.map(item => `<option value="${escape(item.code)}">${escape(item.label)} (${escape(item.code)})</option>`).join('');
  $('#language').value = language;
}
function mediaFields(id, blockId = '') {
  const medium = content.media[id]; if (!medium) return '<p>Media item does not exist.</p>';
  const state=languageChoice(id,mediaModes,mediaLanguages);
  return `<section class="localized-media"><div class="heading"><span class="key">Media: ${escape(id)}${blockId ? ` · Block: ${escape(blockId)}` : ''}</span>${variantControls(id,'media',state)}</div><div class="translation-grid">${state.variants.map(variant=>{
    const own=medium.files[variant.code] || '', file=own || medium.files.default || '';
    return `<div class="translation-cell ${variant.code==='default' ? 'default-cell' : ''}"><h3>${escape(variant.label)} <span class="language-code">${escape(variant.code)}</span></h3><div class="fields"><label>File<input data-file-path="${escape(id)}" data-lang="${escape(variant.code)}" value="${escape(own)}" placeholder="/content-media/… or leave empty to use the shared file"></label><label>Add / replace ${medium.type==='image' ? 'image' : 'video'}<input type="file" data-upload="${escape(id)}" data-lang="${escape(variant.code)}" accept="${medium.type==='image' ? 'image/png,image/jpeg,image/gif,image/webp,image/avif' : 'video/mp4,video/webm,video/quicktime,video/ogg'}"></label></div>
      ${file ? (medium.type==='image' ? `<img class="media-preview" src="${escape(file)}" alt="Preview ${escape(variant.label)}">` : `<video class="media-preview" src="${escape(file)}" controls preload="metadata"></video>`) : '<p class="muted">No file.</p>'}
      ${own ? `<button class="small" data-clear-file="${escape(id)}" data-lang="${escape(variant.code)}">Remove reference</button>` : ''}${!own && file && variant.code!=='default' ? '<p class="muted">Using the shared file.</p>' : ''}</div>`;
  }).join('')}</div>${medium.type==='image'?`<div class="card"><h3>Image description</h3><label><input type="checkbox" data-media-decorative="${escape(id)}" ${medium.decorative?'checked':''}> Decorative image (empty alt text)</label>${!medium.decorative?`<label>Description text key<input data-media-alt="${escape(id)}" value="${escape(medium.alt||'')}" placeholder="media.cover.alt"></label>${medium.alt?textField(medium.alt,'Localized image description',true):`<button data-create-alt="${escape(id)}">Create localized description</button>`}`:''}</div>`:''}</section>`;
}
function permanentMediaFields() {
  return configuration.mediaFields.map(field=>{
    content.media[field.id] ||= {type:field.type,files:{}};
    const candidates=Object.entries(content.media).filter(([id,medium])=>id!==field.id && medium.type===field.type);
    return `<div class="card"><h2>${escape(field.label||field.id)}</h2><p class="muted">${escape(field.description||'')}</p>${candidates.length ? `<label>Copy a file and its language variants from the library<select data-media-copy="${escape(field.id)}"><option value="">Choose an existing media item…</option>${candidates.map(([id])=>`<option value="${escape(id)}">${escape(id)}</option>`).join('')}</select></label>` : ''}${mediaFields(field.id)}</div>`;
  }).join('');
}
function renderNode() {
  const node = nodeById(selectedId);
  if (!node) return '<h1>Categories and content</h1><p class="help">Select an item on the left or add a category. Each item can contain content, child items, or both.</p>';
  const excluded = descendants(node.id), ancestry = []; let ancestor = node;
  while (ancestor) { ancestry.unshift(nodeName(ancestor)); ancestor = nodeById(ancestor.parentId); }
  const iconControl=(configuration.icons||[]).length?`<label>Navigation icon<select data-node-icon="${escape(node.id)}"><option value="">Project default</option>${configuration.icons.map(icon=>`<option value="${escape(icon.id)}" ${node.meta?.icon===icon.id?'selected':''}>${escape(icon.label)}</option>`).join('')}</select></label>`:'';
  const typeControl=(configuration.itemTypes||[]).length?`<label>Content type<select data-node-type="${escape(node.id)}"><option value="">General content</option>${configuration.itemTypes.map(type=>`<option value="${escape(type.id)}" ${node.meta?.contentType===type.id?'selected':''}>${escape(type.label)}</option>`).join('')}</select></label>`:'';
  return `<div class="breadcrumb">${ancestry.map(escape).join(' → ')}</div><div class="heading"><div><h1>${escape(nodeName(node))}</h1><span class="key">ID: ${escape(node.id)}</span></div><div class="actions"><button data-add-child="${escape(node.id)}">+ Child item</button><button class="danger" data-delete-node="${escape(node.id)}">Delete item</button></div></div>
    ${iconControl}
    ${typeControl}
    <div class="card"><div class="fields">${textField(node.label,'Menu label')}${textField(node.title,configuration.fieldLabels.title||'Title')}</div>
    <div class="fields"><label>Parent category / item<select data-parent="${escape(node.id)}"><option value="">Top level</option>${content.nodes.filter(item => !excluded.has(item.id)).map(item => `<option value="${escape(item.id)}" ${node.parentId === item.id ? 'selected' : ''}>${escape(nodeName(item))} · ${escape(item.id)}</option>`).join('')}</select></label>
    <div class="actions"><button data-node-move="-1">↑ Move earlier</button><button data-node-move="1">↓ Move later</button></div></div></div>
    <div class="card"><div class="heading"><h2>Content · ${node.blocks.length} blocks</h2><div class="actions"><button data-add-block="heading">+ Heading</button><button data-add-block="text">+ Text</button><button data-add-block="image">+ Image</button><button data-add-block="video">+ Video</button></div></div>
    <p class="muted">Headings and text are separate blocks with independent translations. Click inside content to show formatting tools. Paste preserves styles; Ctrl+Shift+V pastes plain text. The application determines where each field appears.</p>
    ${node.blocks.map((block,index) => `<div class="block"><div class="heading"><h3>${index+1}. ${escape({ heading:'Heading', text:'Text', image:'Image', video:'Video' }[block.type])}</h3><div class="actions">${['text','heading'].includes(block.type) ? `<button class="small" data-toggle-heading="${escape(block.id)}">${block.type==='heading' ? 'Convert to text' : 'Convert to heading'}</button>` : ''}<button class="small" data-block-move="${escape(block.id)}" data-direction="-1" ${index ? '' : 'disabled'}>↑</button><button class="small" data-block-move="${escape(block.id)}" data-direction="1" ${index < node.blocks.length-1 ? '' : 'disabled'}>↓</button><button class="small danger" data-delete-block="${escape(block.id)}">Remove block</button></div></div>
    <label>Semantic role (optional)<input data-block-role="${escape(block.id)}" value="${escape(block.role||'')}" placeholder="cover, excerpt, tag, body"></label><p class="muted">Roles identify content for project renderers. They do not control position or styling.</p>
    ${block.type==='text' ? textField(block.key,'Block text',true,true) : block.type==='heading' ? textField(block.key,configuration.fieldLabels.heading||'Heading',false,true) : `<label>Media from library<select data-block-media="${escape(block.id)}">${Object.entries(content.media).filter(([, medium]) => medium.type === block.type).map(([id]) => `<option value="${escape(id)}" ${id === block.media ? 'selected' : ''}>${escape(id)}</option>`).join('')}</select></label>${mediaFields(block.media,block.id)}`}</div>`).join('') || '<p class="help">This item has no content yet. Add a block or child items.</p>'}</div>
    <div class="card"><div class="heading"><h2>Child items · ${children(node.id).length}</h2><button data-add-child="${escape(node.id)}">+ Child item</button></div><div class="fields">${children(node.id).map(item => `<button data-select="${escape(item.id)}">${escape(nodeName(item))} →</button>`).join('') || '<p class="muted">No child items. An item can contain content without child items.</p>'}</div></div>`;
}
function renderTexts(query = '') {
  const used=usedTextKeys(), search=query.toLowerCase();
  const list = Object.keys(content.texts).filter(key => (textUsageFilter==='all' || used.has(key)===(textUsageFilter==='used'))
    && (key.toLowerCase().includes(search) || Object.values(content.texts[key]).some(text=>text.toLowerCase().includes(search)))).sort();
  const fields=new Map(textFieldDefinitions(content,configuration).map(field=>[field.key,field]));
  return list.slice(0,250).map(key => textField(key,fields.get(key)?.label||key,true,fields.get(key)?.type==='rich'||content.nodes.some(node=>node.blocks.some(block=>block.key===key || block.heading===key)),used.has(key))).join('')
    + (list.length > 250 ? `<p>Showing 250 of ${list.length} entries. Narrow your search.</p>` : '')
    + (!list.length ? '<p class="empty">No texts match the selected filter and search.</p>' : '');
}
function sharedTexts(){
  const canCreate=configuration.allowSharedTextCreation!==false;
  const declared=new Set((configuration.textFields||[]).map(field=>field.key)),changes=planTextFields(content,configuration);
  return `<h1>Shared texts</h1><p class="help">Edit screen titles, controls and descriptions here. Registered fields are protected from unused-text cleanup.</p>
    ${canCreate&&changes.length?`<div class="card"><h2>Declared field registration</h2><p>Add missing field records and initial translations explicitly. Existing translations are never replaced.</p><pre>${escape(changes.map(change=>`${change.key}: ${change.createText?'create missing text; ':''}${change.register?'register metadata':''}`).join('\n'))}</pre><button id="apply-text-fields">Apply this plan</button></div>`:''}
    ${canCreate?`<form id="new-shared-text" class="card"><h2>Add shared text</h2><div class="fields grid"><label>Stable key<input name="key" required maxlength="200" placeholder="home.hero.title"></label><label>Editor name<input name="label" required maxlength="1000"></label><label>Group<input name="group" maxlength="1000"></label><label>Description<textarea name="description" maxlength="1000"></textarea></label><label>Type<select name="type"><option value="plain">Plain text</option><option value="rich">Rich text</option><option value="message">Named message markers</option></select></label><label><input type="checkbox" name="required"> Required before static export</label></div><div class="translation-grid">${[{code:'default',label:'Default / shared'},...content.languages].map(locale=>`<label>${escape(locale.label)}<textarea name="locale-${escape(locale.code)}"></textarea></label>`).join('')}</div><button class="primary">Add text</button></form>`:''}
    ${textFieldDefinitions(content,configuration).map(field=>`<div class="card"><details><summary>${escape(field.group||'Shared')} · ${escape(field.label||field.key)} · ${escape(field.type||'plain')}${field.required?' · Required':''}</summary><p>${escape(field.description||'')}</p>${declared.has(field.key)?'<p class="muted">Field metadata is declared in project configuration. Change configuration and restart to update it.</p>':`<div class="fields"><label>Name<input data-field-meta="label" data-key="${escape(field.key)}" value="${escape(field.label||'')}"></label><label>Group<input data-field-meta="group" data-key="${escape(field.key)}" value="${escape(field.group||'')}"></label><label>Description<textarea data-field-meta="description" data-key="${escape(field.key)}">${escape(field.description||'')}</textarea></label><label>Type<select data-field-meta="type" data-key="${escape(field.key)}">${['plain','rich','message'].map(type=>`<option ${field.type===type?'selected':''}>${type}</option>`).join('')}</select></label><label><input type="checkbox" data-field-meta="required" data-key="${escape(field.key)}" ${field.required?'checked':''}> Required before export</label><button class="danger" data-delete-shared="${escape(field.key)}">Delete shared text</button></div>`}</details>${field.type==='message'?'<p class="help">Use approved markers such as {accent}highlight{/accent}. The project defines supported marker names; arbitrary HTML is treated as text.</p>':''}${textField(field.key,field.label||field.key,true,field.type==='rich',true)}</div>`).join('')}`;
}
function renderWorkspace() {
  const extension=(configuration.editorTabs||[]).find(item=>item.id===tab);
  document.querySelector('.status').hidden=Boolean(extension);
  for(const id of ['save','preview','xlsx-import-button','xlsx-export']){
    const button=document.getElementById(id);
    if(button)button.hidden=Boolean(extension)||(id==='preview'&&!configuration.preview);
  }
  destroyRichEditors();
  $('#sidebar').hidden = tab !== 'content';
  $('main').style.gridTemplateColumns = tab === 'content' ? '' : 'minmax(0,1fr)';
  for (const button of document.querySelectorAll('[data-tab]')) button.setAttribute('aria-selected',button.dataset.tab === tab);
  let html = '';
  if (tab === 'content') html = renderNode();
  if(tab==='shared')html=sharedTexts();
  if(tab==='diagnostics'){const report=diagnoseContent(content,configuration);html=`<h1>Diagnostics</h1><p class="help">Missing keys, incomplete translations and media descriptions. HTML elements and runtime bindings are checked by bindContent in the site; the editor cannot discover arbitrary JavaScript references.</p><p>${report.issues.length} issues · ${report.ok?'No required fields are missing':'Required fields need attention'}</p>${report.issues.map(issue=>`<div class="card"><strong>${escape(issue.severity)} · ${escape(issue.code)}</strong><p>${escape([issue.key,issue.language,issue.media,issue.node,issue.role].filter(Boolean).join(' · '))}</p></div>`).join('')}`;}
  if (tab === 'texts') {
    const used=usedTextKeys(), unused=Object.keys(content.texts).filter(key=>!used.has(key)).length;
    html = `<h1>All texts</h1><p class="muted">Each field shows Default and translations. Texts used by items, blocks, or shared screens cannot be deleted.</p><div class="actions text-tools"><label>Show<select id="text-usage-filter"><option value="all" ${textUsageFilter==='all' ? 'selected' : ''}>All texts</option><option value="used" ${textUsageFilter==='used' ? 'selected' : ''}>In use</option><option value="unused" ${textUsageFilter==='unused' ? 'selected' : ''}>Unused (${unused})</option></select></label><button class="danger" id="delete-unused-texts" ${unused ? '' : 'disabled'}>Delete all unused (${unused})</button>${deletedTexts ? '<button id="restore-deleted-texts">Undo last deletion</button>' : ''}</div><input id="text-search" value="${escape(textQuery)}" placeholder="Search by key or text in any language…" aria-label="Search texts"><div class="text-list" id="text-list">${renderTexts(textQuery)}</div>`;
  }
  if (tab === 'media') html = `<div class="heading"><h1>Media library</h1><div class="actions"><button data-new-media="image">+ Image</button><button data-new-media="video">+ Video</button></div></div><p class="muted">Edit the shared file and language variants together. A language-specific file takes priority. The same media item can be used in multiple blocks.</p>${permanentMediaFields()}<div class="media-list">${Object.entries(content.media).filter(([id])=>!permanentMedia(id)).map(([id,medium]) => `<div class="card"><div class="heading"><h3>${escape(medium.type === 'image' ? 'Image' : 'Video')}</h3><button class="small danger" data-delete-media="${escape(id)}">Delete entry</button></div>${mediaFields(id)}</div>`).join('') || '<p class="empty">No other media items.</p>'}</div>`;
  if (tab === 'languages') html = `<h1>Languages</h1><p class="help">Adding a language does not change the content structure. Existing translations for a removed language are retained in case it is added again.</p><div class="card"><label>Default language<select id="default-language">${content.languages.map(item => `<option value="${escape(item.code)}" ${item.code === content.defaultLanguage ? 'selected' : ''}>${escape(item.label)}</option>`).join('')}</select></label>${content.languages.map(item => `<div class="lang-row"><code>${escape(item.code)}</code><input aria-label="Language name ${escape(item.code)}" data-language-label="${escape(item.code)}" value="${escape(item.label)}"><button class="danger" data-delete-language="${escape(item.code)}" ${content.languages.length === 1 ? 'disabled' : ''}>Remove</button></div>`).join('')}</div><form id="new-language" class="card"><h2>Add language</h2><div class="grid fields"><label>Code (e.g. fr)<input name="code" required pattern="[a-zA-Z][a-zA-Z0-9-]{0,19}" maxlength="20"></label><label>Name in language selector<input name="label" required maxlength="80"></label></div><button class="primary" style="margin-top:15px">Add language</button></form>`;
  if (tab === 'backup') html = `<h1>Data and recovery</h1><div class="card"><h2>Excel import and export</h2><p class="muted">A full export contains Structure, Blocks, Texts, Media, Languages, and Settings worksheets. Importing it restores all content. The existing languages.xlsx (Translations) updates translations by key and preserves the structure. Empty cells keep existing text; [CLEAR] clears a value.</p><div class="actions"><button id="xlsx-import-backup">Import XLSX file</button><button id="xlsx-export-backup">Export all content to XLSX</button><button id="xlsx-legacy">Import existing languages.xlsx</button></div><p class="muted">Review the import summary before applying it. XLSX contains media references; the files remain in the media folder.</p></div><div class="card"><p>Saved in <code>content-editor.json</code>. The previous version is in <code>content-editor.json.bak</code>. Media files are stored in <code>content-media</code>.</p><p>Edit category counts, hierarchy depth, and blocks here. There are no menu counters in config.js. Existing Excel files and source translations are not overwritten.</p><p class="muted">Revision: ${content.revision} · Last updated: ${escape(content.updatedAt || 'No saved changes yet')}</p><div class="actions"><button id="download">Download JSON (including local changes)</button><button id="reload">Reload saved content</button></div></div><div class="card"><h2>Import a previously downloaded JSON backup</h2><p class="muted">JSON restores the structure, translations, and references. Confirm the import to apply it.</p><input id="import" type="file" accept="application/json,.json"></div>`;
  if(tab==='languages')html+=`<div class="card"><h2>Text direction</h2>${content.languages.map(locale=>`<label>${escape(locale.label)}<select data-language-dir="${escape(locale.code)}"><option value="">Automatic by language</option>${['ltr','rtl','auto'].map(dir=>`<option value="${dir}" ${locale.dir===dir?'selected':''}>${dir}</option>`).join('')}</select></label>`).join('')}</div>`;
  if(extension)html=`<iframe class="editor-extension" src="${escape(extension.url)}" title="${escape(extension.label)}"></iframe>`;
  $('#workspace').innerHTML = html;
  initRichEditors();
}
function render() { renderLanguages(); renderTree(); renderWorkspace(); }
function saveTreeState() { try { localStorage.setItem('visit-content-expanded',JSON.stringify([...expandedNodes])); } catch {} }
function revealAncestors(id) { const visited=new Set(); for (let node=nodeById(id); node?.parentId && !visited.has(node.id); node=nodeById(node.parentId)) { visited.add(node.id); expandedNodes.add(node.parentId); } saveTreeState(); }
function newNode(parentId) {
  const id = uid('item'), label = `${id}.button`, title = `${id}.title`;
  content.texts[label] = { default: parentId ? 'New child item' : 'New category' };
  content.texts[title] = { default: '' };
  content.nodes.push({ id, parentId, order: children(parentId).length, label, title, blocks: [] });
  selectedId = id; revealAncestors(id); tab = 'content'; touch(); render();
}
function newMedia(type) { const id = uid('media'); content.media[id] = { type, files: {} }; return id; }
function moveNode(direction) {
  const node = nodeById(selectedId), siblings = children(node.parentId), index = siblings.findIndex(item => item.id === node.id), target = index+direction;
  if (target < 0 || target >= siblings.length) return;
  [siblings[index],siblings[target]] = [siblings[target],siblings[index]];
  siblings.forEach((item,order) => item.order = order); touch(); render();
}
function setImportBusy(busy) {
  importBusy=busy;
  for (const record of richEditors) record.editor.$.ui.readOnly(busy);
  $('main').inert=busy;
  $('main').setAttribute('aria-busy',String(busy));
  $('.tabs').inert=busy;
  for (const control of document.querySelectorAll('header button,header select')) control.disabled=busy;
}
async function importXlsx(file,existing=false) {
  if (importBusy || !await flush()) return;
  if (file && file.size>20*1024*1024) { notice('XLSX files must not exceed 20 MB.'); return; }
  setImportBusy(true);
  const generation=changed;
  status('Reading XLSX…');
  try {
    const imported=await request(existing ? '/api/xlsx/legacy' : '/api/xlsx/import',{method:'POST',headers:{'Content-Type':'application/octet-stream'},...(file ? {body:file} : {})});
    if (generation!==changed || dirty || content.revision!==imported.baseRevision) throw new Error('Content changed while the file was being read. Retry the import using the latest version.');
    const report=imported.report;
    const summary=`${report.label}\nItems: ${report.nodes} · Languages: ${report.languages}\nTexts: ${report.texts}${report.changedCells!==undefined ? ` · Changed values: ${report.changedCells}` : ''}\n\n${report.message}\n\nApply this import?`;
    if (!confirm(summary)) { status(`Import canceled · revision ${content.revision}`); return; }
    saving=true;
    const result=await request('/api/content',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:imported.baseRevision,content:imported.content})});
    content=imported.content; content.revision=result.revision; content.updatedAt=result.updatedAt; deletedTexts=null;
    dirty=false; if (!nodeById(selectedId)) selectedId=children(groupParent())[0]?.id || null;
    revealAncestors(selectedId); render(); notice(''); status(`XLSX imported · revision ${content.revision}`);
  } catch(error) { notice(`XLSX import failed: ${error.message}`); status('Import not applied'); }
  finally { setImportBusy(false); saving=false; }
}
async function exportXlsx() {
  if (!await flush()) return;
  try {
    const response=await fetch('/api/xlsx/export');
    if (!response.ok) throw new Error((await response.json()).error || 'Export failed.');
    const blob=await response.blob(), url=URL.createObjectURL(blob), link=document.createElement('a');
    link.href=url; link.download=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'content.xlsx'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    status(`XLSX downloaded · revision ${content.revision}`);
  } catch(error) { notice(`XLSX export failed: ${error.message}`); }
}
document.addEventListener('input', event => {
  const target = event.target;
  if(target.dataset.fieldMeta&&target.type!=='checkbox'&&target.tagName!=='SELECT'){content.textFields[target.dataset.key][target.dataset.fieldMeta]=target.value;touch();}
  if (target.dataset.text && !target.classList.contains('rich-text-editor')) {
    (content.texts[target.dataset.text] ||= {})[target.dataset.lang] = target.value; touch(); renderTree();
  }
  if (target.dataset.filePath) { content.media[target.dataset.filePath].files[target.dataset.lang] = target.value; touch(); }
  if (target.dataset.languageLabel) { content.languages.find(item => item.code === target.dataset.languageLabel).label = target.value; touch(); }
  if (target.id === 'tree-search') { searchCollapsedNodes.clear(); renderTree(); }
  if (target.id === 'text-search') { textQuery=target.value; destroyRichEditors(); $('#text-list').innerHTML = renderTexts(textQuery); initRichEditors(); }
});
document.addEventListener('change', async event => {
  const target = event.target;
  if(target.dataset.fieldMeta){content.textFields[target.dataset.key][target.dataset.fieldMeta]=target.type==='checkbox'?target.checked:target.value;touch();if(target.dataset.fieldMeta==='type')renderWorkspace();}
  if(target.dataset.mediaDecorative){content.media[target.dataset.mediaDecorative].decorative=target.checked;touch();renderWorkspace();}
  if(target.dataset.mediaAlt){if(target.value&&!validKey(target.value))return notice('Invalid description key.');const medium=content.media[target.dataset.mediaAlt];if(target.value)medium.alt=target.value;else delete medium.alt;touch();renderWorkspace();}
  if(target.dataset.blockRole){const block=nodeById(selectedId).blocks.find(item=>item.id===target.dataset.blockRole);if(target.value&&!validKey(target.value))return notice('Invalid block role.');if(target.value)block.role=target.value;else delete block.role;touch();}
  if(target.dataset.nodeIcon){const node=nodeById(target.dataset.nodeIcon);(node.meta||={}).icon=target.value;touch();}
  if(target.dataset.nodeType){const node=nodeById(target.dataset.nodeType);(node.meta||={}).contentType=target.value;touch();}
  if(target.dataset.languageDir){const locale=content.languages.find(item=>item.code===target.dataset.languageDir);if(target.value)locale.dir=target.value;else delete locale.dir;touch();}
  if (target.id==='text-usage-filter') { textUsageFilter=target.value; renderWorkspace(); }
  if (target.hasAttribute('data-media-copy') && target.value) {
    const medium=content.media[target.value];
    const field=configuration.mediaFields.find(item=>item.id===target.dataset.mediaCopy);
    if (medium?.type===field?.type) { content.media[field.id]={type:field.type,files:{...medium.files}}; touch(); renderWorkspace(); }
  }
  if(target.id==='content-group'){selectedGroup=target.value;selectedId=children(groupParent())[0]?.id||null;render();}
  if (target.id === 'language') { language = target.value; renderTree(); }
  if (target.dataset.fieldLanguage) { fieldLanguages.set(target.dataset.fieldLanguage,target.value); renderWorkspace(); }
  if (target.dataset.mediaLanguage) { mediaLanguages.set(target.dataset.mediaLanguage,target.value); renderWorkspace(); }
  if (target.dataset.parent) { const node = nodeById(target.dataset.parent); node.parentId = target.value || null; node.order = children(node.parentId).length; revealAncestors(node.id); touch(); render(); }
  if (target.dataset.blockMedia) { nodeById(selectedId).blocks.find(block => block.id === target.dataset.blockMedia).media = target.value; touch(); renderWorkspace(); }
  if (target.id === 'default-language') { content.defaultLanguage = target.value; touch(); }
  if (target.dataset.upload && target.files[0]) {
    const file = target.files[0], id = target.dataset.upload, variant = target.dataset.lang;
    if (file.size > 250*1024*1024) { notice('Media files must not exceed 250 MB.'); return; }
    target.disabled = true; status('Uploading media…');
    try {
      const result = await request('/api/media', { method:'POST', headers: { 'Content-Type':'application/octet-stream', 'X-File-Name':encodeURIComponent(file.name) }, body:file });
      if (!content.media[id] || content.media[id].type !== result.type) throw new Error('The file type does not match the media type.');
      content.media[id].files[variant] = result.file; touch(); renderWorkspace();
    } catch (error) { notice(error.message); status('Media upload failed'); target.disabled = false; }
  }
  if (target.id === 'xlsx-import' && target.files[0]) { await importXlsx(target.files[0]); target.value=''; }
  if (target.id === 'import' && target.files[0]) {
    try {
      const imported = JSON.parse(await target.files[0].text());
      if (!imported || typeof imported !== 'object' || Array.isArray(imported)) throw new Error('Invalid content JSON.');
      if (!confirm('Replace the current content with this JSON file?') || !await flush()) return;
      setImportBusy(true); saving = true; imported.revision = content.revision;
      const result = await request('/api/content', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:content.revision,content:imported})});
      imported.revision = result.revision; imported.updatedAt = result.updatedAt; content = imported; deletedTexts=null;
      selectedId = children(groupParent())[0]?.id || null; dirty = false; render(); notice(''); status(`Imported · revision ${content.revision}`);
    }
    catch(error) { notice(`Import failed: ${error.message}`); }
    finally { setImportBusy(false); saving = false; }
  }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button || !content) return;
  const data = button.dataset;
  if(button.id==='apply-text-fields'){
    if(!await flush())return;
    try{const plan=await request('/api/fields/plan');if(!confirm(`Register these fields without replacing existing translations?\n${plan.changes.map(change=>change.key).join('\n')}`))return;await request('/api/fields/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseRevision:plan.baseRevision})});await load();}catch(error){notice(error.message);}return;
  }
  if(data.createAlt){const medium=content.media[data.createAlt],key=`${data.createAlt}.alt`;medium.alt=key;medium.decorative=false;content.texts[key]||={};(content.textFields||={})[key]={label:'Image description',group:'Media',type:'plain'};touch();renderWorkspace();return;}
  if(data.deleteShared){
    const key=data.deleteShared;
    if(configuration.protectedTextKeys.includes(key)||content.nodes.some(node=>node.label===key||node.title===key||node.blocks.some(block=>block.key===key||block.heading===key))||Object.values(content.media).some(medium=>medium.alt===key))return notice('This key is referenced by content or project configuration. Remove those references first.');
    if(confirm(`Delete ${key} and all its translations? HTML references cannot be discovered here; connected elements will use their configured fallback and report a missing key.`)){delete content.textFields[key];delete content.texts[key];touch();renderWorkspace();}return;
  }
  if (data.deleteText) { deleteUnusedTexts([data.deleteText]); return; }
  if (button.id==='delete-unused-texts') { deleteUnusedTexts(Object.keys(content.texts)); return; }
  if (button.id==='restore-deleted-texts' && deletedTexts) {
    for (const [key,values] of Object.entries(deletedTexts)) if (!Object.hasOwn(content.texts,key)) content.texts[key]=values;
    deletedTexts=null; touch(); renderWorkspace(); return;
  }
  if (data.tab) { tab = data.tab; renderWorkspace(); }
  if (data.select) { selectedId = data.select; revealAncestors(selectedId); tab = 'content'; render(); }
  if (data.treeToggle) {
    if ($('#tree-search').value) { if (searchCollapsedNodes.has(data.treeToggle)) searchCollapsedNodes.delete(data.treeToggle); else searchCollapsedNodes.add(data.treeToggle); }
    else if (expandedNodes.has(data.treeToggle)) expandedNodes.delete(data.treeToggle); else expandedNodes.add(data.treeToggle);
    saveTreeState(); renderTree();
  }
  if (button.id==='expand-all') { searchCollapsedNodes.clear(); expandedNodes=new Set(content.nodes.filter(node=>children(node.id).length).map(node=>node.id)); saveTreeState(); renderTree(); }
  if (button.id==='collapse-all') { if ($('#tree-search').value) for (const node of content.nodes) searchCollapsedNodes.add(node.id); expandedNodes.clear(); saveTreeState(); renderTree(); }
  if (data.fieldMode) { const state=languageChoice(data.fieldMode,fieldModes,fieldLanguages); fieldModes.set(data.fieldMode,state.all ? 'single' : 'all'); renderWorkspace(); }
  if (data.mediaMode) { const state=languageChoice(data.mediaMode,mediaModes,mediaLanguages); mediaModes.set(data.mediaMode,state.all ? 'single' : 'all'); renderWorkspace(); }
  if (['xlsx-import-button','xlsx-import-backup'].includes(button.id)) $('#xlsx-import').click();
  if (['xlsx-export','xlsx-export-backup'].includes(button.id)) exportXlsx();
  if (button.id==='xlsx-legacy') importXlsx(null,true);
  if (button.id === 'add-root') newNode(groupParent());
  if (data.addChild) newNode(data.addChild);
  if (data.deleteNode) { const ids = descendants(data.deleteNode); if (confirm(`Delete this item and its children (${ids.size})? Texts and media remain in the catalog.`)) { const parentId = nodeById(data.deleteNode).parentId; content.nodes = content.nodes.filter(node => !ids.has(node.id)); selectedId = parentId; touch(); render(); } }
  if (data.nodeMove) moveNode(Number(data.nodeMove));
  if (data.addBlock) {
    const id = uid('block'), type = data.addBlock;
    const block = ['text','heading'].includes(type) ? { id,type,key:`${id}.${type}` } : { id,type,media:newMedia(type) };
    if (block.key) content.texts[block.key] = { default:'' };
    nodeById(selectedId).blocks.push(block); touch(); renderWorkspace();
  }
  if (data.deleteBlock) { const node = nodeById(selectedId); node.blocks = node.blocks.filter(block => block.id !== data.deleteBlock); touch(); renderWorkspace(); }
  if (data.toggleHeading) { const block = nodeById(selectedId).blocks.find(block=>block.id===data.toggleHeading); if (block && ['text','heading'].includes(block.type)) { block.type=block.type==='heading' ? 'text' : 'heading'; touch(); renderWorkspace(); } }
  if (data.blockMove) { const blocks = nodeById(selectedId).blocks, index = blocks.findIndex(block => block.id === data.blockMove), next = index+Number(data.direction); if (next>=0 && next<blocks.length) { [blocks[index],blocks[next]] = [blocks[next],blocks[index]]; touch(); renderWorkspace(); } }
  if (data.newMedia) { newMedia(data.newMedia); touch(); renderWorkspace(); }
  if (data.clearFile) { content.media[data.clearFile].files[data.lang] = ''; touch(); renderWorkspace(); }
  if (data.deleteMedia) {
    if (permanentMedia(data.deleteMedia)) return notice('This is a permanent media field. Replace its files or remove its references.');
    if (content.nodes.some(node => node.blocks.some(block => block.media === data.deleteMedia))) return notice('This media item is in use. Remove or replace the blocks that reference it first.');
    if (confirm('Delete this library entry? The file will remain on disk.')) { delete content.media[data.deleteMedia]; touch(); renderWorkspace(); }
  }
  if (data.deleteLanguage && content.languages.length > 1) {
    content.languages = content.languages.filter(item => item.code !== data.deleteLanguage);
    if (content.defaultLanguage === data.deleteLanguage) content.defaultLanguage = content.languages[0].code;
    touch(); render();
  }
  if (button.id === 'save') save();
  if (button.id === 'preview') {
    if (!await flush()) return;
    try { await request('/api/preview', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ nodeId:selectedId, language:language === 'default' ? content.defaultLanguage : language }) }); status('Preview sent to the open application'); }
    catch(error) { notice(error.message); }
  }
  if (button.id === 'download') { const url = URL.createObjectURL(new Blob([JSON.stringify(content,null,2)],{type:'application/json'})); const link = document.createElement('a'); link.href=url; link.download='content-editor.json'; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); }
  if (button.id === 'reload' && (!dirty || confirm('Discard local changes?'))) load();
});
document.addEventListener('submit', event => {
  if(event.target.id==='new-shared-text'){
    if(configuration.allowSharedTextCreation===false){event.preventDefault();return notice('Adding shared texts is disabled for this project.');}
    event.preventDefault();const form=new FormData(event.target),key=String(form.get('key')).trim();
    if(!validKey(key)||Object.hasOwn(content.texts,key)||textFieldDefinitions(content,configuration).some(field=>field.key===key))return notice('Choose a valid, unused stable key.');
    (content.textFields||={})[key]={label:String(form.get('label')).trim(),description:String(form.get('description')),group:String(form.get('group')),type:String(form.get('type')),required:form.has('required')};
    content.texts[key]=Object.fromEntries(['default',...content.languages.map(item=>item.code)].map(code=>[code,String(form.get(`locale-${code}`)||'')]));touch();renderWorkspace();return;
  }
  if (event.target.id !== 'new-language') return;
  event.preventDefault(); const form = new FormData(event.target), code = String(form.get('code')).trim(), label=String(form.get('label')).trim();
  if (['default','__proto__','constructor','prototype'].includes(code) || content.languages.some(item => item.code === code)) return notice('This language code is reserved or already exists.');
  content.languages.push({code,label}); touch(); render();
});
window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue=''; } });
async function load() {
  try { const result = await request('/api/content'); content=result.content; dirty=false; conflict=false; deletedTexts=null; if (!nodeById(selectedId)) selectedId=children(groupParent())[0]?.id || null;
    if (!treeInitialized) { try { const saved=JSON.parse(localStorage.getItem('visit-content-expanded')); expandedNodes=new Set(Array.isArray(saved) ? saved.filter(id=>typeof id==='string') : children(null).map(node=>node.id)); } catch { expandedNodes=new Set(children(null).map(node=>node.id)); } treeInitialized=true; }
    revealAncestors(selectedId); notice(result.warning || ''); render(); status(`Connected · revision ${content.revision}`); }
  catch(error) { notice(`The editor could not load content: ${error.message}`); status('Not connected to the service'); }
}
try {
  configuration=await request('/api/editor-config');
  for(const tab of configuration.editorTabs||[]){
    const button=document.createElement('button');button.dataset.tab=tab.id;button.textContent=tab.label;
    document.querySelector('.tabs').append(button);
  }
  document.title=`${configuration.title} — Content editor`;
  $('#project-title').textContent=configuration.title;
  $('#preview').hidden=!configuration.preview;
  const groups=Object.entries(configuration.groups);selectedGroup=groups[0]?.[0]||null;
  $('#group-picker').hidden=groups.length<2;
  $('#content-group').innerHTML=groups.map(([id,group])=>`<option value="${escape(id)}">${escape(group.label||id)}</option>`).join('');
} catch(error){notice(`The editor configuration could not be loaded: ${error.message}`);}
await load();
const events = new EventSource('/api/events');
events.addEventListener('content', event => {
  const incoming = JSON.parse(event.data);
  if (!content || incoming.revision <= content.revision || saving) return;
  if (dirty) { conflict=true; notice('Content changed in another editor. Load the latest version or download your local changes as JSON.',true); return; }
  content=incoming; deletedTexts=null; if (!nodeById(selectedId)) selectedId=children(groupParent())[0]?.id || null; render(); status(`Connected · revision ${content.revision}`);
});
events.onerror = () => status('Disconnected · reconnecting…');
events.onopen = () => { if (!dirty && !saving && content) status(`Connected · revision ${content.revision}`); };
