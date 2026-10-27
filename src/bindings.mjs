import {createContentFormatter} from './format.mjs';
const attributes=new Set(['placeholder','title','alt','aria-label']);

// Named components are created by the project, never parsed as arbitrary HTML.
export function renderContentMessage(document,text,components={}){
  text=String(text);const fragment=document.createDocumentFragment(),stack=[{name:null,element:fragment}];
  const pattern=/\{(\/?[a-zA-Z][\w-]*)\}/g;let end=0;
  for(const match of text.matchAll(pattern)){
    stack.at(-1).element.append(document.createTextNode(text.slice(end,match.index)));end=match.index+match[0].length;
    const name=match[1];
    if(name.startsWith('/')){if(stack.at(-1).name!==name.slice(1))throw new Error(`Unbalanced message marker: ${name}`);stack.pop();continue;}
    if(!Object.hasOwn(components,name))throw new Error(`Unknown message component: ${name}`);
    const element=components[name](document);
    if(!element?.append||element.ownerDocument!==document)throw new Error(`Message component ${name} must return an element in this document.`);
    stack.at(-1).element.append(element);if(element.tagName!=='BR')stack.push({name,element});
  }
  if(stack.length!==1)throw new Error(`Unclosed message marker: ${stack.at(-1).name}`);
  fragment.append(document.createTextNode(text.slice(end)));return fragment;
}

export function bindContent({root=globalThis.document,store,navigation,language,bindings=[],components={},fallback='',onDiagnostic=()=>{},onReport=()=>{}}={}){
  if(!root||!store)throw new Error('A binding root and content store are required.');
  const document=root.nodeType===9?root:root.ownerDocument,formatter=createContentFormatter(document.defaultView);
  let report=[];
  function collect(){
    const result=[],elements=[...(root.matches?.('[data-content-text],[data-content-rich],[data-content-message],[data-content-attr]')?[root]:[]),...root.querySelectorAll('[data-content-text],[data-content-rich],[data-content-message],[data-content-attr]')];
    for(const element of elements){
      for(const type of ['text','rich','message'])if(element.hasAttribute(`data-content-${type}`))result.push({element,key:element.getAttribute(`data-content-${type}`),type});
      if(element.hasAttribute('data-content-attr'))for(const entry of element.getAttribute('data-content-attr').split(';').filter(Boolean)){const colon=entry.indexOf(':');result.push({element,type:'attribute',attribute:entry.slice(0,colon).trim(),key:entry.slice(colon+1).trim()});}
    }
    for(const binding of bindings){const targets=[...root.querySelectorAll(binding.selector)];if(!targets.length)report.push({code:'missing-element',selector:binding.selector,key:binding.key});for(const element of targets)result.push({...binding,element});}
    return result;
  }
  function render(){
    report=[];const snapshot=store.getSnapshot(),locale=typeof language==='function'?language():language||navigation?.getSnapshot().language||snapshot?.defaultLanguage;
    for(const binding of collect()){
      const {element,key,type='text',attribute}=binding;
      if(type==='attribute'&&!attributes.has(attribute)){report.push({code:'unsupported-attribute',key,attribute});continue;}
      const values=snapshot?.texts[key],value=[values?.[locale],values?.default].find(value=>typeof value==='string'&&value.trim());
      if(value===undefined)report.push({code:values?'missing-translation':'missing-key',key,language:locale});
      const text=value??element.getAttribute('data-content-fallback')??(typeof fallback==='function'?fallback({key,language:locale}):fallback);
      try{
        if(type==='attribute')element.setAttribute(attribute,text);
        else if(type==='rich')element.innerHTML=formatter.html(text);
        else if(type==='message')element.replaceChildren(renderContentMessage(document,text,components));
        else element.textContent=text;
      }catch(error){element.textContent='';report.push({code:'invalid-binding',key,message:error.message});}
    }
    for(const issue of report)onDiagnostic(issue);onReport(report);return report;
  }
  const unsubscribe=(navigation||store).subscribe(render);render();
  return {refresh:render,getReport:()=>report,destroy(){unsubscribe();}};
}

export function mountLanguageSwitcher({select,navigation,persistKey,storage,onError=()=>{}}={}){
  if(!select||!navigation)throw new Error('A select element and navigation are required.');
  const document=select.ownerDocument;let preferences=storage;
  if(persistKey){try{preferences??=document.defaultView.localStorage;const saved=preferences.getItem(persistKey);if(navigation.store.getSnapshot()?.languages.some(item=>item.code===saved))navigation.setLanguage(saved);}catch(error){onError(error);}}
  function render(){
    const content=navigation.store.getSnapshot(),language=navigation.getSnapshot().language;
    select.replaceChildren(...(content?.languages||[]).map(item=>{const option=document.createElement('option');option.value=item.code;option.textContent=item.label;return option;}));select.value=language||'';
    if(language){document.documentElement.lang=language;const configured=content.languages.find(item=>item.code===language)?.dir;document.documentElement.dir=configured||(/^(ar|fa|he|ur|ps|dv|ku)(-|$)/i.test(language)?'rtl':'ltr');}
    if(persistKey&&preferences&&language)try{preferences.setItem(persistKey,language);}catch(error){onError(error);}
  }
  const changed=()=>navigation.setLanguage(select.value);select.addEventListener('change',changed);
  const unsubscribe=navigation.subscribe(render);render();
  return {render,destroy(){unsubscribe();select.removeEventListener('change',changed);}};
}
