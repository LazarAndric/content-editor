import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateContent,createContent } from './model.mjs';

export async function openLocalContent({directory,initialContent=createContent(),validate=validateContent}) {
  if(!directory)throw new Error('A local content directory is required.');
  await fs.mkdir(directory,{recursive:true});
  const filename=path.join(directory,'content-editor.json');
  let content,warning='',queue=Promise.resolve();const listeners=new Set();
  for(const source of [filename,`${filename}.bak`]){
    try{content=validate(JSON.parse(await fs.readFile(source,'utf8')));if(source.endsWith('.bak'))warning='Recovered the previous valid version (.bak).';break;}
    catch(error){if(error.code!=='ENOENT')warning=`Invalid saved content: ${error.message}`;}
  }
  if(!content){if(warning)throw new Error(`${warning} Original files are preserved; the editor was not started.`);content=validate(structuredClone(initialContent));}
  return {
    getSnapshot:()=>content,
    getWarning:()=>warning,
    subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},
    save(candidate,baseRevision){
      const operation=queue.then(async()=>{
        if(baseRevision!==content.revision)throw Object.assign(new Error('Content changed in another editor. Load the latest version before saving.'),{status:409,revision:content.revision});
        const next=validate(structuredClone(candidate));next.revision=content.revision+1;next.updatedAt=new Date().toISOString();
        const temporary=`${filename}.${randomUUID()}.tmp`;
        try{
          await fs.writeFile(temporary,JSON.stringify(next,null,2),{encoding:'utf8',flag:'wx'});
          await fs.writeFile(`${filename}.bak.tmp`,JSON.stringify(content,null,2),'utf8');
          await fs.rename(`${filename}.bak.tmp`,`${filename}.bak`);await fs.rename(temporary,filename);
        }catch(error){await fs.rm(temporary,{force:true}).catch(()=>{});throw error;}
        content=next;warning='';for(const listener of listeners)listener(content);
        return {revision:content.revision,updatedAt:content.updatedAt};
      });
      queue=operation.catch(()=>{});return operation;
    },
  };
}
