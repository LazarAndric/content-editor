import {usedTextKeys} from './index.mjs';
import {textFieldDefinitions} from './fields.mjs';

export function diagnoseContent(content,definition={}){
  const issues=[],fields=textFieldDefinitions(content,definition),fieldMap=new Map(fields.map(field=>[field.key,field]));
  const keys=usedTextKeys(content,[...(definition.protectedTextKeys||[]),...fields.map(field=>field.key)]);
  for(const key of keys)for(const {code:language} of content.languages){
    const values=content.texts[key],resolved=[values?.[language],values?.default].some(value=>typeof value==='string'&&value.trim());
    if(!resolved)issues.push({code:values?'missing-translation':'missing-key',severity:fieldMap.get(key)?.required||Object.values(content.media).some(medium=>medium.type==='image'&&medium.decorative===false&&medium.alt===key)?'error':'warning',key,language});
    if(resolved&&fieldMap.get(key)?.type==='message'){
      const source=values[language]?.trim()?values[language]:values.default,field=fieldMap.get(key),stack=[];let invalid;
      for(const match of source.matchAll(/\{(\/?[a-zA-Z][\w-]*)\}/g)){
        const name=match[1];if(name.startsWith('/')){if(stack.pop()!==name.slice(1))invalid=`Unbalanced marker: ${name}`;}
        else{if(field.components&&!field.components.includes(name))invalid=`Unknown marker: ${name}`;if(name!=='br')stack.push(name);}
      }
      if(stack.length)invalid=`Unclosed marker: ${stack.at(-1)}`;
      if(invalid)issues.push({code:'invalid-message',severity:field.required?'error':'warning',key,language,message:invalid});
    }
  }
  for(const [id,medium] of Object.entries(content.media))if(medium.type==='image'&&!medium.decorative&&!medium.alt)issues.push({code:'image-description-unspecified',severity:medium.decorative===false?'error':'warning',media:id});
  for(const node of content.nodes){const roles=new Set();for(const block of node.blocks)if(block.role){if(roles.has(block.role))issues.push({code:'duplicate-block-role',severity:'warning',node:node.id,role:block.role});roles.add(block.role);}}
  return {ok:!issues.some(issue=>issue.severity==='error'),issues};
}
