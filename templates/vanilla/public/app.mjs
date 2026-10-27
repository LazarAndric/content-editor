import {createContentClient,createContentNavigation,mountContentTree,mountContentBlocks,contentPath,bindContent,mountLanguageSwitcher} from './content-kit/browser.mjs';
import {contentOptions} from './content-kit/runtime.mjs';

const $=selector=>document.querySelector(selector);
let client,navigation,tree,blocks,unsubscribe,bindings,languages,phase='load';
try {
  client=await createContentClient({...contentOptions,onError:error=>{$('#status').textContent=error.message;}});
  const {store}=client;
  phase='render';
  navigation=createContentNavigation({store,group:'main',mode:'accordion',selectFirst:true});
  bindings=bindContent({root:document,store,navigation,onDiagnostic:issue=>console.warn('Content binding:',issue)});
  languages=mountLanguageSwitcher({select:$('#language'),navigation,persistKey:'content-kit-language'});
  const text=key=>store.text(key,navigation.getSnapshot().language);
  // Project-owned markup, classes and icons can be changed without editing the module.
  tree=mountContentTree({container:$('#menu'),navigation,renderItem:({item,selected,active,expanded,hasChildren})=>{
    const button=document.createElement('button');button.type='button';
    button.className=`menu-item${selected?' selected':''}${active?' active':''}`;
    const label=document.createElement('span');label.textContent=item.label;
    const arrow=document.createElement('span');arrow.textContent=hasChildren?(expanded?'−':'+'):'';arrow.setAttribute('aria-hidden','true');
    button.append(label,arrow);return button;
  }});
  blocks=mountContentBlocks({container:$('#blocks'),store,navigation,messages:{'no-selection':()=>text('ui.select'),'children-only':()=>text('ui.children'),empty:()=>text('ui.empty'),'missing-media':()=>text('ui.media')}});
  function render(){
    const state=navigation.getSnapshot(),content=store.getSnapshot(),item=store.item(state.selectedId,state.language);
    $('#title').textContent=item?.title||'';
    $('#path').textContent=contentPath(content,state.selectedId).map(node=>store.item(node.id,state.language).label).join(' / ');
    $('#status').textContent=text(contentOptions.staticUrl?'ui.static':'ui.connected');
  }
  unsubscribe=navigation.subscribe(render);render();
  if(contentOptions.staticUrl)$('#editor-link').hidden=true;
}catch(error){$('#status').textContent=phase==='load'?'Could not connect to content.':'Could not render content.';console.error(`Content ${phase} phase failed:`,error);}
window.addEventListener('pagehide',()=>{unsubscribe?.();bindings?.destroy();languages?.destroy();tree?.destroy();blocks?.destroy();navigation?.destroy();client?.close();},{once:true});
