import {realpath,stat} from 'node:fs/promises';
import path from 'node:path';

export async function publicFile(root,pathname){
  const relative=decodeURIComponent(pathname).replace(/^\/+/, '');
  if(relative.split(/[\\/]/).some(part=>part.startsWith('.')||part==='node_modules'))return null;
  const resolvedRoot=await realpath(root),candidate=path.resolve(resolvedRoot,relative||'index.html');
  if(!candidate.startsWith(resolvedRoot+path.sep))return null;
  let target=await realpath(candidate);
  if(!target.startsWith(resolvedRoot+path.sep))return null;
  if((await stat(target)).isDirectory())target=await realpath(path.join(target,'index.html'));
  return target.startsWith(resolvedRoot+path.sep)?target:null;
}
