// Behavior can be attached independently of the project's DOM structure.
export function bindContentNavigation({container,navigation,render,action='activate',semantics='buttons'}={}){
  if(!container||!navigation)throw new Error('A container and navigation are required.');
  if(!['activate','select'].includes(action))throw new Error('Navigation action must be activate or select.');
  if(!['buttons','tree','none'].includes(semantics))throw new Error('Navigation semantics must be buttons, tree or none.');
  const document=container.ownerDocument;
  const visible=element=>{for(let current=element;current&&current!==container;current=current.parentElement){const style=document.defaultView.getComputedStyle(current);if(current.hidden||style.display==='none'||style.visibility==='hidden')return false;}return true;};
  const entries=()=>[...container.querySelectorAll('[data-content-id]')].filter(visible);
  function update(){
    const active=document.activeElement,focused=container.contains(active)?active.closest('[data-content-id]'):null,id=focused?.dataset.contentId,part=active?.dataset.contentAction;
    render?.();const rows=new Map(navigation.rows().map(row=>[row.item.id,row]));
    for(const element of entries()){
      const row=rows.get(element.dataset.contentId);if(!row)continue;
      const primary=element.matches('button,a,[role="button"]')?element:element.querySelector('[data-content-action="select"],button,a')||element;
      const toggle=element.querySelector('[data-content-action="toggle"]')||primary;
      if(semantics==='tree'){element.setAttribute('role','treeitem');element.setAttribute('aria-selected',String(row.selected));element.setAttribute('aria-level',String(row.depth+1));}
      else if(semantics==='buttons')primary.setAttribute('aria-pressed',String(row.selected));
      const expansion=semantics==='tree'?element:toggle;
      if(semantics!=='none'){if(row.hasChildren)expansion.setAttribute('aria-expanded',String(row.expanded));else expansion.removeAttribute('aria-expanded');}
      if(semantics==='tree')element.tabIndex=row.selected?0:-1;
    }
    if(semantics==='tree'&&!entries().some(element=>element.tabIndex===0))entries()[0]?.setAttribute('tabindex','0');
    if(id){const target=entries().find(element=>element.dataset.contentId===id)||entries().find(element=>element.dataset.contentId===navigation.getSnapshot().selectedId)||entries()[0];const focus=part&&target?.querySelector(`[data-content-action="${part==='toggle'?'toggle':'select'}"]`);(focus||target)?.focus({preventScroll:true});}
  }
  function perform(element,event){const requested=event.target.closest('[data-content-action]')?.dataset.contentAction||action;if(['toggle','select','activate'].includes(requested))navigation[requested](element.dataset.contentId);}
  const click=event=>{if(event.defaultPrevented)return;const element=event.target.closest('[data-content-id]');if(element&&container.contains(element))perform(element,event);};
  const keydown=event=>{
    if(event.defaultPrevented)return;const element=event.target.closest('[data-content-id]');if(!element)return;
    const elements=entries(),index=elements.indexOf(element),row=navigation.rows().find(row=>row.item.id===element.dataset.contentId);if(!row)return;let target;
    if(event.key==='ArrowDown')target=elements[Math.min(index+1,elements.length-1)];else if(event.key==='ArrowUp')target=elements[Math.max(0,index-1)];
    else if(event.key==='Home')target=elements[0];else if(event.key==='End')target=elements.at(-1);
    else if(event.key==='Enter'||event.key===' '){event.preventDefault();perform(element,event);return;}
    else if(event.key==='ArrowRight'){if(row.hasChildren&&!row.expanded)navigation.toggle(row.item.id);else if(row.hasChildren)target=elements[index+1];}
    else if(event.key==='ArrowLeft'){if(row.expanded)navigation.toggle(row.item.id);else target=elements.find(item=>item.dataset.contentId===row.item.parentId);}
    else return;event.preventDefault();target?.focus({preventScroll:true});
  };
  container.addEventListener('click',click);container.addEventListener('keydown',keydown);
  const unsubscribe=navigation.subscribe(update);update();
  return {render:update,destroy(){unsubscribe();container.removeEventListener('click',click);container.removeEventListener('keydown',keydown);}};
}
