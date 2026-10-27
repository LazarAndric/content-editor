export function createLiveSource({store,url,EventSource:Source=globalThis.EventSource,onPreview=()=>{},onError=error=>console.warn('Content update rejected:',error)}) {
  let connection=null,users=0,generation=0;
  const disconnect=()=>{connection?.close();connection=null;};
  return {
    store,
    connect(){
      if(!Source)throw new Error('EventSource is unavailable. Supply a source implementation or use local content.');
      users++;const currentGeneration=generation;
      if(!connection){
        connection=new Source(url);
        connection.addEventListener('content',event=>{try{store.setContent(JSON.parse(event.data));}catch(error){onError(error);}});
        connection.addEventListener('preview',event=>{try{onPreview(JSON.parse(event.data));}catch(error){onError(error);}});
      }
      let active=true;
      return ()=>{if(!active)return;active=false;if(currentGeneration!==generation)return;if(--users===0)disconnect();};
    },
    close(){disconnect();users=0;generation++;},
  };
}
