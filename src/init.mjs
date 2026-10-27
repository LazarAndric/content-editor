import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';

const templateRoot=new URL('../templates/vanilla/',import.meta.url);
export async function initContentProject({directory=process.cwd(),template='vanilla',packageSource}={}){
  if(template!=='vanilla')throw new Error('Supported template: vanilla.');
  const root=path.resolve(directory),packageFile=path.join(root,'package.json');
  let metadata;
  try{metadata=JSON.parse(await readFile(packageFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  metadata=metadata||{name:path.basename(root).toLowerCase().replace(/[^a-z0-9-]/g,'-')||'content-kit-demo',version:'1.0.0',private:true,type:'module'};
  for(const key of ['dev','content:export'])if(metadata.scripts?.[key])throw new Error(`The ${key} script already exists. Initialize in a new directory or configure the existing project manually.`);
  const files=['content-kit.config.mjs','public/index.html','public/app.mjs','public/style.css'];
  // Preflight every collision before creating or modifying project files.
  for(const name of files){try{await access(path.join(root,name));throw new Error(`File already exists: ${name}. Initialize in a new directory to avoid overwriting your site.`);}catch(error){if(error.code!=='ENOENT')throw error;}}
  const ownMetadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const dependency=packageSource||(ownMetadata.private?pathToFileURL(fileURLToPath(new URL('../',import.meta.url))).href:`^${ownMetadata.version}`);
  metadata.dependencies={...metadata.dependencies,[ownMetadata.name]:metadata.dependencies?.[ownMetadata.name]||dependency};
  metadata.scripts={...metadata.scripts,dev:'content-kit dev','content:check':metadata.scripts?.['content:check']||'content-kit doctor','content:fields':metadata.scripts?.['content:fields']||'content-kit fields','content:export':'content-kit export --out dist'};
  await mkdir(path.join(root,'public'),{recursive:true});
  for(const name of files){
    const source=(await readFile(new URL(name,templateRoot),'utf8')).replaceAll('__CONTENT_EDITOR_PACKAGE__',ownMetadata.name);
    await writeFile(path.join(root,name),source,{flag:'wx'});
  }
  await writeFile(packageFile,JSON.stringify(metadata,null,2)+'\n');
  try{await writeFile(path.join(root,'.npmrc'),'install-links=true\n',{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  return {directory:root};
}
