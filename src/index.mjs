import { validateContent, createContent, flattenMessages,validateTextField } from './model.mjs';
export { validateContent, createContent, flattenMessages };

export function contentText(content,key,language=content?.defaultLanguage) {
  if(!key)return '';
  const values=content?.texts[key];
  for(const value of [values?.[language],values?.default])if(typeof value==='string' && value.trim())return value;
  return `Missing text for key ${key} (${language} / Default).`;
}
export const contentChildren=(content,parentId)=>content?.nodes.filter(node=>node.parentId===parentId).sort((a,b)=>a.order-b.order)||[];
export function contentPath(content,id) {
  const nodes=new Map((content?.nodes||[]).map(node=>[node.id,node])), result=[],visited=new Set();
  for(let node=nodes.get(id);node&&!visited.has(node.id);node=nodes.get(node.parentId)){visited.add(node.id);result.unshift(node);}
  return result;
}
export function resolveMedia(content,id,language=content?.defaultLanguage,resolveUrl=file=>file) {
  const medium=content && Object.hasOwn(content.media,id)?content.media[id]:undefined;
  const preferred=medium?.files?.[language];
  const file=typeof preferred==='string' && preferred ? preferred : medium?.files.default||null;
  return {id,type:medium?.type||null,file,url:file?resolveUrl(file):null,missing:!file};
}
export function normalizeDefinition({title='Content',groups={},protectedTextKeys=[],mediaFields=[],preview=false,fieldLabels={},textFields=[],icons=[],itemTypes=[],allowSharedTextCreation=true,editorTabs=[]}={}) {
  if(typeof allowSharedTextCreation!=='boolean')throw new Error('allowSharedTextCreation must be a boolean.');
  if(!Array.isArray(editorTabs))throw new Error('editorTabs must be an array.');
  const tabIds=new Set(['content','shared','texts','media','languages','diagnostics','backup']);
  for(const tab of editorTabs){
    if(!tab||!validEditorTab(tab)||tabIds.has(tab.id))throw new Error('Invalid or duplicate editor tab.');
    tabIds.add(tab.id);
  }
  for(const [name,list] of Object.entries({protectedTextKeys,mediaFields,textFields,icons,itemTypes}))if(!Array.isArray(list))throw new Error(`Project ${name} must be an array.`);
  for(const [name,group] of Object.entries(groups)) {
    if(!/^[a-zA-Z0-9_.:-]+$/.test(name)||!group||!Object.hasOwn(group,'parentId')||!(group.parentId===null||typeof group.parentId==='string'))throw new Error(`Invalid content group: ${name}`);
  }
  for(const field of mediaFields)if(!field||typeof field.id!=='string'||!['image','video'].includes(field.type))throw new Error('Invalid permanent media field.');
  const keys=new Set();for(const field of textFields){validateTextField(field);if(keys.has(field.key))throw new Error(`Duplicate text field: ${field.key}`);keys.add(field.key);}
  for(const icon of icons)if(!icon||typeof icon.id!=='string'||typeof icon.label!=='string')throw new Error('Invalid icon definition.');
  for(const type of itemTypes)if(!type||typeof type.id!=='string'||typeof type.label!=='string')throw new Error('Invalid item type definition.');
  return structuredClone({title,groups,protectedTextKeys,mediaFields,preview,fieldLabels,textFields,icons,itemTypes,allowSharedTextCreation,editorTabs});
}
const validEditorTab=tab=>typeof tab.id==='string'&&/^[a-z][a-z0-9-]{0,49}$/.test(tab.id)
  &&typeof tab.label==='string'&&tab.label.trim().length>0&&tab.label.length<=80
  &&typeof tab.url==='string'&&/^\/[a-zA-Z0-9_/-]+$/.test(tab.url)&&!tab.url.includes('//');
export function usedTextKeys(content,additional=[]) {
  const keys=new Set(additional);
  for(const key of Object.keys(content.textFields||{}))keys.add(key);
  for(const medium of Object.values(content.media))if(medium.alt)keys.add(medium.alt);
  for(const node of content.nodes){keys.add(node.label);keys.add(node.title);for(const block of node.blocks){if(block.key)keys.add(block.key);if(block.heading)keys.add(block.heading);}}
  return keys;
}
export function validateDefinitionContent(content,definition) {
  validateContent(content);
  for(const [name,group] of Object.entries(definition.groups))if(group.parentId!==null && !content.nodes.some(node=>node.id===group.parentId))throw new Error(`The content group ${name} references a missing item: ${group.parentId}`);
  for(const field of definition.mediaFields)if(content.media[field.id] && content.media[field.id].type!==field.type)throw new Error(`The media field ${field.id} must have type ${field.type}.`);
  return content;
}
export function createContentStore({content=null,definition={},resolveMediaUrl=file=>file,onMissingText,missingText}={}) {
  const configuration=normalizeDefinition(definition),listeners=new Set();
  let snapshot=content===null?null:validateDefinitionContent(structuredClone(content),configuration);
  const store={
    definition:configuration,
    getSnapshot:()=>snapshot,
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    setContent(next){snapshot=next===null?null:validateDefinitionContent(structuredClone(next),configuration);for(const listener of listeners)listener();},
    text(key,language=snapshot?.defaultLanguage){
      const values=snapshot?.texts[key],found=[values?.[language],values?.default].some(value=>typeof value==='string'&&value.trim());
      if(key&&!found){const context={key,language,code:Object.hasOwn(snapshot?.texts||{},key)?'missing-translation':'missing-key'};onMissingText?.(context);if(missingText!==undefined)return typeof missingText==='function'?missingText(context):missingText;}
      return contentText(snapshot,key,language);
    },
    media(id,language=snapshot?.defaultLanguage){const asset=resolveMedia(snapshot,id,language,resolveMediaUrl),medium=snapshot?.media[id];return {...asset,decorative:medium?.decorative??!medium?.alt,alt:medium?.decorative?'':medium?.alt?store.text(medium.alt,language):''};},
    item(id,language=snapshot?.defaultLanguage){
      const node=snapshot?.nodes.find(item=>item.id===id);if(!node)return null;
      return {...node,label:store.text(node.label,language),title:store.text(node.title,language),
        hasChildren:contentChildren(snapshot,id).length>0,
        blocks:node.blocks.map(block=>['heading','text'].includes(block.type)
          ? {...block,text:store.text(block.key,language),...(block.heading?{headingText:store.text(block.heading,language)}:{})}
          : {...block,asset:store.media(block.media,language)})};
    },
    children:(parentId,language)=>contentChildren(snapshot,parentId).map(node=>store.item(node.id,language)),
    group(name,language){if(!Object.hasOwn(configuration.groups,name))throw new Error(`Unknown content group: ${name}`);return store.children(configuration.groups[name].parentId,language);},
  };
  return store;
}
