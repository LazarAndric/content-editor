// Optional UI state; content and component design stay independent.
export function createContentNavigation({store,group,mode='accordion',selectFirst=true,language}={}) {
  if(!store)throw new Error('A content store is required.');
  if(!['accordion','tree'].includes(mode))throw new Error('Navigation mode must be accordion or tree.');
  if(group && !Object.hasOwn(store.definition.groups,group))throw new Error(`Unknown content group: ${group}`);
  const listeners=new Set();
  let selectedId=null,expanded=new Set(),previousParents=new Map(),snapshot;
  const parentId=group?store.definition.groups[group].parentId:null;
  function nodes() {
    const result=new Map(),visit=parent=>{for(const item of store.children(parent,language)){result.set(item.id,item);visit(item.id);}};
    visit(parentId);return result;
  }
  function publish(){snapshot=Object.freeze({selectedId,expandedIds:Object.freeze([...expanded]),language:language||store.getSnapshot()?.defaultLanguage});for(const listener of listeners)listener();}
  function openPath(id,items,includeSelf=true){
    const path=[];for(let item=items.get(id);item;item=items.get(item.parentId))path.unshift(item);
    if(mode==='accordion'){
      for(const item of path){
        for(const other of items.values())if(other.parentId===item.parentId && other.id!==item.id)collapse(other.id,items);
      }
    }
    for(const item of path)if(item.hasChildren && (includeSelf||item.id!==id))expanded.add(item.id);
  }
  function collapse(id,items){expanded.delete(id);for(const item of items.values())if(item.parentId===id)collapse(item.id,items);}
  function reconcile(){
    const items=nodes(),oldSelected=selectedId;
    if(language && !store.getSnapshot()?.languages.some(item=>item.code===language))language=store.getSnapshot()?.defaultLanguage;
    while(selectedId && !items.has(selectedId))selectedId=previousParents.get(selectedId)||null;
    if(!selectedId && selectFirst)selectedId=items.values().next().value?.id||null;
    expanded=new Set([...expanded].filter(id=>items.get(id)?.hasChildren));
    // Preserve deliberate collapse; reveal only a replacement selection.
    if(selectedId && (oldSelected!==selectedId||!previousParents.has(selectedId)))openPath(selectedId,items);
    previousParents=new Map([...items].map(([id,item])=>[id,item.parentId]));publish();
  }
  const navigation={store,group,
    getSnapshot:()=>snapshot,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    select(id){const items=nodes();if(!items.has(id))throw new Error(`Unknown navigation item: ${id}`);selectedId=id;openPath(id,items);publish();},
    toggle(id){const items=nodes(),item=items.get(id);if(!item)throw new Error(`Unknown navigation item: ${id}`);if(!item.hasChildren)return;if(expanded.has(id))collapse(id,items);else openPath(id,items);publish();},
    activate(id){const item=nodes().get(id);if(!item)throw new Error(`Unknown navigation item: ${id}`);if(selectedId===id && item.hasChildren)navigation.toggle(id);else navigation.select(id);},
    setLanguage(next){if(!store.getSnapshot()?.languages.some(item=>item.code===next))throw new Error(`Unknown language: ${next}`);language=next;publish();},
    rows(){
      const items=nodes(),ancestors=new Set();
      for(let item=items.get(selectedId);item;item=items.get(item.parentId))ancestors.add(item.id);
      const result=[],visit=(parent,depth)=>{for(const item of store.children(parent,language)){result.push({item,depth,selected:item.id===selectedId,active:ancestors.has(item.id),expanded:expanded.has(item.id),hasChildren:item.hasChildren});if(expanded.has(item.id))visit(item.id,depth+1);}};
      visit(parentId,0);return result;
    },
    destroy(){unsubscribe();listeners.clear();},
  };
  const unsubscribe=store.subscribe(reconcile);reconcile();return navigation;
}
