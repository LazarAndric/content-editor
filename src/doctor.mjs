import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {normalizeDefinition,validateDefinitionContent} from './index.mjs';
import {diagnoseContent} from './diagnostics.mjs';
import {planTextFields} from './fields.mjs';
import {publicFile} from './static-files.mjs';

export async function inspectContentProject({directory,siteDirectory,definition={},initialContent}={}){
  const configuration=normalizeDefinition(definition),issues=[];let content;
  try{content=JSON.parse(await readFile(path.join(directory,'content-editor.json'),'utf8'));}
  catch(error){if(error.code==='ENOENT'&&initialContent)content=initialContent;else return {ok:false,issues:[{severity:'error',code:'content-load',message:error.message}]};}
  try{validateDefinitionContent(content,configuration);}catch(error){return {ok:false,issues:[{severity:'error',code:'content-validation',message:error.message}]};}
  issues.push(...diagnoseContent(content,configuration).issues);
  for(const [id,medium] of Object.entries(content.media))for(const file of Object.values(medium.files))if(file)try{if(!await publicFile(directory,file))throw new Error('Unsafe path.');}catch(error){issues.push({severity:'error',code:'media-file',media:id,file,message:error.message});}
  if(siteDirectory)try{
    const html=await readFile(path.join(siteDirectory,'index.html'),'utf8');
    const keys=new Set([...html.matchAll(/data-content-(?:text|rich|message)\s*=\s*["']([^"']+)["']/g)].map(match=>match[1]));
    for(const match of html.matchAll(/data-content-attr\s*=\s*["']([^"']+)["']/g))for(const part of match[1].split(';'))if(part.includes(':'))keys.add(part.slice(part.indexOf(':')+1).trim());
    for(const key of keys)if(!Object.hasOwn(content.texts,key))issues.push({severity:'warning',code:'html-missing-key',key});
  }catch(error){issues.push({severity:'error',code:'site-entry',message:error.message});}
  const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  return {version,ok:!issues.some(issue=>issue.severity==='error'),issues,fieldPlan:planTextFields(content,configuration)};
}
