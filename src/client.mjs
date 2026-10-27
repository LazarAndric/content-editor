import {createContentStore} from './index.mjs';
import {createLiveSource} from './live.mjs';

// URLs are relative to the hosting page unless a base URL is supplied explicitly.
export async function createContentClient({baseUrl,staticUrl,definition,fetch:request=globalThis.fetch,EventSource,onError=error=>console.warn('Content update rejected:',error),onMissingText,missingText}={}) {
  if(!request)throw new Error('Fetch is unavailable.');
  const base=new URL(baseUrl||'./',globalThis.location?.href||'http://localhost/');
  const get=async url=>{const response=await request(url);if(!response.ok)throw new Error(`Content request failed (${response.status}): ${url}`);return response.json();};
  let content,configuration,mediaBase;
  if(staticUrl){
    const manifestUrl=new URL(staticUrl,base),manifest=await get(manifestUrl);
    configuration=definition||manifest.definition;content=manifest.content;mediaBase=manifestUrl;
  }else{
    const [config,result]=await Promise.all([definition||get(new URL('api/editor-config',base)),get(new URL('api/content',base))]);
    configuration=config;content=result.content;mediaBase=base;
  }
  const store=createContentStore({content,definition:configuration,onMissingText,missingText,resolveMediaUrl:file=>new URL(file.replace(/^\//,''),mediaBase).href});
  const source=staticUrl?null:createLiveSource({store,url:new URL('api/events',base).href,EventSource,onError});
  const disconnect=source?.connect();
  return {store,close(){disconnect?.();source?.close();}};
}
