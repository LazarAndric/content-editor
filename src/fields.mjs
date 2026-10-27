import {validateTextField,validateContent} from './model.mjs';

export function textFieldDefinitions(content,definition={}){
  const fields=new Map(Object.entries(content?.textFields||{}).map(([key,value])=>[key,{...value,key}]));
  for(const field of definition.textFields||[])fields.set(field.key,{...fields.get(field.key),...field});
  return [...fields.values()];
}
export function planTextFields(content,definition={}){
  return textFieldDefinitions(content,definition).map(field=>{
    const {key,initialValues={},...metadata}=validateTextField(field);
    return {key,metadata,values:structuredClone(initialValues),createText:!Object.hasOwn(content.texts,key),register:!Object.hasOwn(content.textFields||{},key)};
  }).filter(item=>item.createText||item.register);
}
export function applyTextFields(content,definition={}){
  const next=structuredClone(content);
  for(const item of planTextFields(next,definition)){
    if(item.createText)next.texts[item.key]=item.values;
    if(item.register)(next.textFields||={})[item.key]=item.metadata;
  }
  return validateContent(next);
}
