import {readFile,writeFile,mkdir,cp,rename,rm,mkdtemp,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {normalizeDefinition,validateDefinitionContent} from './index.mjs';
import {browserAsset,browserAssetFiles} from './browser-assets.mjs';
import {publicFile} from './static-files.mjs';
import {diagnoseContent} from './diagnostics.mjs';

export async function exportContentSite({directory,siteDirectory,outDirectory,definition={},initialContent}={}){
  if(!directory||!outDirectory)throw new Error('Content and output directories are required.');
  const canonical=async filename=>{try{return await realpath(filename);}catch(error){if(error.code!=='ENOENT')throw error;return path.join(await canonical(path.dirname(filename)),path.basename(filename));}};
  const output=await canonical(path.resolve(outDirectory)),source=await canonical(path.resolve(directory)),site=siteDirectory&&await canonical(path.resolve(siteDirectory));
  const within=(a,b)=>{if(process.platform==='win32'){a=a.toLowerCase();b=b.toLowerCase();}return a===b||a.startsWith(b+path.sep);};
  if(within(output,source)||within(source,output)||(site&&(within(output,site)||within(site,output))))throw new Error(`Export output ${output} overlaps a source directory. Keep sources intact and choose --out with a fresh sibling folder, for example site-export-001.`);
  try{await lstat(output);throw new Error('Export output already exists. Choose a new output directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
  const configuration=normalizeDefinition(definition);
  let saved;
  try{saved=JSON.parse(await readFile(path.join(source,'content-editor.json'),'utf8'));}
  catch(error){if(error.code!=='ENOENT'||!initialContent)throw error;saved=structuredClone(initialContent);}
  const content=validateDefinitionContent(saved,configuration);
  const diagnostics=diagnoseContent(content,configuration);
  if(!diagnostics.ok)throw new Error(`Required content is incomplete: ${diagnostics.issues.filter(issue=>issue.severity==='error').map(issue=>`${issue.key}/${issue.language}`).join(', ')}`);
  // Check every declared file, including variants that are not the active language.
  const files=new Map();
  for(const [id,medium] of Object.entries(content.media))for(const file of Object.values(medium.files))if(file){
    const filename=await publicFile(source,file);
    if(!filename)throw new Error(`Missing or unsafe media: ${id} (${file})`);
    files.set(file,filename);
  }
  await mkdir(path.dirname(output),{recursive:true});
  const temporary=await mkdtemp(path.join(path.dirname(output),'.content-kit-export-'));
  try{
    if(site){
      await cp(site,temporary,{recursive:true,verbatimSymlinks:true,filter:async filename=>{
        if((await lstat(filename)).isSymbolicLink())throw new Error(`Static export does not accept symlinks: ${filename}`);
        return filename===site||!path.relative(site,filename).split(path.sep).some(part=>part.startsWith('.')||part==='node_modules');
      }});
    }
    await mkdir(path.join(temporary,'content-kit','vendor'),{recursive:true});
    for(const name of browserAssetFiles().keys())await writeFile(path.join(temporary,'content-kit',name),await browserAsset(name));
    await writeFile(path.join(temporary,'content-kit/runtime.mjs'),"export const contentOptions = {staticUrl: './content.json'};\n");
    await writeFile(path.join(temporary,'content.json'),JSON.stringify({definition:configuration,content},null,2));
    for(const [file,filename] of files){const target=path.join(temporary,file.slice(1));await mkdir(path.dirname(target),{recursive:true});await cp(filename,target);}
    await rename(temporary,output);
  }catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
  return {directory:output,items:content.nodes.length,mediaFiles:files.size};
}
