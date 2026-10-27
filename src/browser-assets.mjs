import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
const require=createRequire(import.meta.url);
const modules=['browser.mjs','index.mjs','model.mjs','client.mjs','live.mjs','navigation.mjs','vanilla.mjs','format.mjs','compatibility.mjs','bindings.mjs','navigation-dom.mjs','fields.mjs','diagnostics.mjs'];
export function browserAssetFiles(){
  return new Map([
    ...modules.map(name=>[name,new URL(name,import.meta.url)]),
    ['LICENSE.txt',new URL('../LICENSE',import.meta.url)],
    ['THIRD-PARTY-NOTICES.txt',new URL('../THIRD-PARTY-NOTICES.md',import.meta.url)],
    ['vendor/purify.es.mjs',path.join(path.dirname(require.resolve('dompurify')),'purify.es.mjs')],
    ['vendor/marked.esm.js',require.resolve('marked')],
    ['vendor/dompurify.LICENSE.txt',path.join(path.dirname(require.resolve('dompurify')),'../LICENSE')],
    ['vendor/dompurify.LICENSE-MPL.txt',path.join(path.dirname(require.resolve('dompurify')),'../LICENSE-MPL')],
    ['vendor/marked.LICENSE.txt',path.join(path.dirname(require.resolve('marked')),'../LICENSE')],
  ]);
}
export async function browserAsset(name){
  const file=browserAssetFiles().get(name);if(!file)return null;
  let source=await readFile(file,'utf8');
  if(name==='format.mjs')source=source.replace("from 'dompurify'","from './vendor/purify.es.mjs'").replace("from 'marked'","from './vendor/marked.esm.js'");
  return source;
}
