import { createElement, Fragment, useEffect, useSyncExternalStore } from 'react';

export function useContent(store,connect) {
  const content=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getSnapshot);
  useEffect(()=>connect?.(),[connect]);
  return content;
}
export function createContentBindings(source) {
  const store=source.store||source;
  const connect=source.connect?.bind(source);
  function useStoreContent(){return useContent(store,connect);}
  function ContentItems({group,parentId=null,language,renderItem}) {
    const content=useStoreContent();if(!content)return null;
    const items=group?store.group(group,language):store.children(parentId,language);
    return createElement(Fragment,null,...items.map(item=>createElement(Fragment,{key:item.id},renderItem(item))));
  }
  return {useContent:useStoreContent,ContentItems};
}
