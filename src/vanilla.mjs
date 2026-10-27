import {createContentFormatter} from './format.mjs';
import {bindContentNavigation} from './navigation-dom.mjs';
export {bindContentNavigation};

export function mountContentTree({container,navigation,renderItem,createTree,createItem,createGroup,action='activate',semantics='tree'}={}){
  if(!container||!navigation)throw new Error('A container and navigation are required.');
  const document=container.ownerDocument;
  return bindContentNavigation({container,navigation,action,semantics,render(){
    const tree=createTree?createTree({document}):document.createElement('ul');if(semantics==='tree')tree.setAttribute('role','tree');const levels=[tree];
    for(const row of navigation.rows()){
      const element=renderItem?renderItem({...row,document}):document.createElement('button');
      if(!element?.setAttribute)throw new Error('renderItem must return an element.');
      if(!renderItem){element.type='button';element.textContent=`${row.hasChildren?(row.expanded?'− ':'+ '):''}${row.item.label}`;}
      element.dataset.contentId=row.item.id;
      const wrapper=createItem?createItem({...row,document}):document.createElement('li');if(semantics==='tree')wrapper.setAttribute('role','none');
      wrapper.append(element);levels[row.depth].append(wrapper);
      if(row.expanded&&row.hasChildren){const group=createGroup?createGroup({...row,document}):document.createElement('ul');if(semantics==='tree')group.setAttribute('role','group');wrapper.append(group);levels[row.depth+1]=group;}
    }
    container.replaceChildren(tree);
  }});
}

export function mountContentBlocks({container,store,navigation,item,language,renderers={},messages={},classNames={},wrapBlock,afterRender,onState=()=>{}}={}) {
  if(!container)throw new Error('A block container is required.');
  const document=container.ownerDocument,formatter=createContentFormatter(document.defaultView);let lastSignature,lastSnapshot,lastItemId,cache=new Map();
  const message=(text,state,context={})=>{const element=document.createElement('p'),custom=messages[state];element.textContent=typeof custom==='function'?custom(context):custom??text;element.dataset.contentState=state;return element;};
  function render(force=false){
    const state=navigation?.getSnapshot(),current=store&&navigation?store.item(state.selectedId,language||state.language):item;
    // Menu expansion does not replace unchanged videos, focused controls or custom widgets.
    const signature=JSON.stringify([current?.id,current?.hasChildren,current?.blocks,language||state?.language]),snapshot=store?.getSnapshot();
    if(!force&&signature===lastSignature&&snapshot===lastSnapshot)return;lastSignature=signature;lastSnapshot=snapshot;
    if(force||current?.id!==lastItemId)cache.clear();lastItemId=current?.id;const nextCache=new Map();
    const nodes=[];let status;
    if(!current){status='no-selection';nodes.push(message('Select an item to see its content.',status));}
    else if(!current.blocks.length){status=current.hasChildren?'children-only':'empty';nodes.push(message(current.hasChildren?'Choose a subcategory to see its content.':'This item has no content yet.',status,{item:current}));}
    else{status='content';for(const block of current.blocks){
      const context={block,item:current,document,language:language||state?.language};let elements=[];
      const missingCopy=typeof messages['missing-media']==='function'?messages['missing-media'](context):messages['missing-media'];
      const fingerprint=JSON.stringify([block,context.language,missingCopy,renderers[block.type]?current:null]);
      const previous=cache.get(block.id);
      if(previous?.fingerprint===fingerprint){nodes.push(...previous.elements);nextCache.set(block.id,previous);continue;}
      if(renderers[block.type]){const element=renderers[block.type](context);if(element)elements=[element];}
      else if(block.type==='heading'){const element=document.createElement('h2');element.innerHTML=formatter.html(block.text);elements=[element];}
      else if(block.type==='text'){
        if(block.headingText){const heading=document.createElement('h2');heading.innerHTML=formatter.html(block.headingText);elements.push(heading);}
        const element=document.createElement('div');element.innerHTML=formatter.html(block.text);elements.push(element);
      }else{
        const missing=()=>message(`Missing media: ${block.media}`,'missing-media',context);
        if(!block.asset?.url||block.asset.missing)elements=[missing()];else{
          const element=document.createElement(block.type==='image'?'img':'video');if(block.type==='video')element.controls=true;else element.alt=block.asset.alt||'';
          element.addEventListener('error',()=>{const fallback=missing();element.replaceWith(fallback);const entry=cache.get(block.id);if(entry)entry.elements=entry.elements.map(node=>node===element?fallback:node);},{once:true});element.src=block.asset.url;elements=[element];
        }
      }
      const rendered=[];for(const element of elements){if(classNames[block.type])element.classList.add(...classNames[block.type].split(/\s+/).filter(Boolean));afterRender?.({...context,element});rendered.push(wrapBlock?.({...context,element})||element);}nodes.push(...rendered);nextCache.set(block.id,{fingerprint,elements:rendered});
    }}
    cache=nextCache;container.dataset.contentState=status;
    // Retain unchanged nodes in place, rather than disconnecting media on every update.
    const keep=new Set(nodes);for(const node of [...container.childNodes])if(!keep.has(node))node.remove();
    for(let index=0;index<nodes.length;index++)if(container.childNodes[index]!==nodes[index])container.insertBefore(nodes[index],container.childNodes[index]||null);
    onState({state:status,item:current});
  }
  const unsubscribe=(navigation||store)?.subscribe(()=>render());render();
  return {render:()=>render(true),update(next){item=next;render();},destroy(){unsubscribe?.();}};
}

// A card contract is explicit: each profile names unique semantic block roles.
export function contentCard(item,{cover='cover',excerpt='excerpt',tag='tag'}={}){
  if(!item)return null;const role=name=>{const matches=item.blocks.filter(block=>block.role===name);if(matches.length>1)throw new Error(`Ambiguous card role ${name}: ${item.id}`);return matches[0];};
  return {id:item.id,title:item.title,cover:role(cover)?.asset||null,excerpt:role(excerpt)?.text||'',tag:role(tag)?.text||'',item};
}
