const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export const validKey = value => typeof value === 'string' && value.length > 0 && value.length <= 200
  && /^[a-zA-Z0-9_.:-]+$/.test(value) && !value.split(/[.:]/).some(part => forbidden.has(part));
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export function flattenMessages(messages, prefix = '', result = {}) {
  for (const [key, value] of Object.entries(messages)) {
    const id = prefix ? `${prefix}.${key}` : key;
    if (plain(value) && Object.values(value).some(text=>typeof text==='string') && Object.values(value).every(text=>typeof text==='string')) result[id] = { default: '', ...value };
    else if (plain(value)) flattenMessages(value, id, result);
  }
  return result;
}

export function createContent({languages=[{code:'en',label:'English'}],defaultLanguage=languages[0]?.code,nodes=[],texts={},media={}}={}) {
  return validateContent(structuredClone({version:1,revision:0,defaultLanguage,languages,nodes,texts,media}));
}

export function validateContent(candidate) {
  requireValue(plain(candidate) && candidate.version === 1, 'Unknown content format.');
  requireValue(Number.isSafeInteger(candidate.revision) && candidate.revision >= 0, 'Invalid revision.');
  requireValue(Array.isArray(candidate.languages) && candidate.languages.length > 0 && candidate.languages.length <= 30, 'Between 1 and 30 languages are required.');
  const languages = new Set();
  for (const language of candidate.languages) {
    if(language?.dir!==undefined)requireValue(['ltr','rtl','auto'].includes(language.dir),`Invalid language direction: ${language.code}`);
    requireValue(plain(language) && /^[a-z][a-z0-9-]{0,19}$/i.test(language.code)
      && !forbidden.has(language.code) && language.code !== 'default'
      && typeof language.label === 'string' && language.label.trim().length > 0 && language.label.length <= 80,
    'Each language must have a unique code and name.');
    requireValue(!languages.has(language.code), `Duplicate language: ${language.code}`);
    languages.add(language.code);
  }
  requireValue(languages.has(candidate.defaultLanguage), 'The default language must be one of the configured languages.');
  requireValue(Array.isArray(candidate.nodes) && candidate.nodes.length <= 2000, 'A maximum of 2000 items is allowed.');
  requireValue(plain(candidate.texts) && Object.keys(candidate.texts).length <= 20000, 'Invalid text catalog.');
  requireValue(plain(candidate.media) && Object.keys(candidate.media).length <= 10000, 'Invalid media catalog.');
  if(candidate.textFields!==undefined){
    requireValue(plain(candidate.textFields)&&Object.keys(candidate.textFields).length<=20000,'Invalid shared text fields.');
    for(const [key,field] of Object.entries(candidate.textFields)){requireValue(plain(field),`Invalid shared text field: ${key}`);validateTextField({...field,key});}
  }
  for (const [key, values] of Object.entries(candidate.texts)) {
    requireValue(validKey(key) && plain(values), `Invalid text key: ${key}`);
    for (const [language, text] of Object.entries(values)) {
      requireValue((language === 'default' || /^[a-z][a-z0-9-]{0,19}$/i.test(language))
        && !forbidden.has(language) && typeof text === 'string' && text.length <= 200000, `Invalid text: ${key}/${language}`);
    }
  }
  for (const [key, medium] of Object.entries(candidate.media)) {
    requireValue(validKey(key) && plain(medium) && ['image', 'video'].includes(medium.type) && plain(medium.files), `Invalid media item: ${key}`);
    if(medium.alt!==undefined)requireValue(validKey(medium.alt),`Invalid media description key: ${key}`);
    if(medium.decorative!==undefined)requireValue(typeof medium.decorative==='boolean',`Invalid decorative flag: ${key}`);
    for (const [language, file] of Object.entries(medium.files)) {
      requireValue((language === 'default' || /^[a-z][a-z0-9-]{0,19}$/i.test(language)) && !forbidden.has(language)
        && typeof file === 'string' && (file === '' || /^\/content-media\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|gif|webp|avif|mp4|webm|mov|m4v|ogg)$/i.test(file)), `Invalid path: ${key}/${language}`);
    }
  }
  const nodes = new Map(), blocks = new Set();
  for (const node of candidate.nodes) {
    requireValue(plain(node) && validKey(node.id) && !nodes.has(node.id), `Invalid or duplicate item ID: ${node?.id}`);
    requireValue(node.parentId === null || validKey(node.parentId), `Invalid parent: ${node.id}`);
    requireValue(Number.isFinite(node.order) && validKey(node.label) && validKey(node.title), `Invalid item fields: ${node.id}`);
    requireValue(Array.isArray(node.blocks) && node.blocks.length <= 500, `Invalid blocks: ${node.id}`);
    if(node.meta!==undefined)requireValue(plain(node.meta)&&Object.entries(node.meta).length<=50&&Object.entries(node.meta).every(([key,value])=>validKey(key)&&['string','number','boolean'].includes(typeof value)&&(typeof value!=='string'||value.length<=1000)),`Invalid item metadata: ${node.id}`);
    for (const block of node.blocks) {
      requireValue(plain(block) && validKey(block.id) && !blocks.has(block.id), `Invalid or duplicate block ID: ${block?.id}`);
      blocks.add(block.id);
      requireValue(['heading', 'text', 'image', 'video'].includes(block.type), `Unknown block type: ${block.id}`);
      if(block.role!==undefined)requireValue(block.role===''||validKey(block.role),`Invalid block role: ${block.id}`);
      if (block.type === 'text' || block.type === 'heading') requireValue(validKey(block.key), `Invalid key: ${block.id}`);
      else requireValue(validKey(block.media) && candidate.media[block.media]?.type === block.type, `Media does not exist or has the wrong type: ${block.id}`);
      if (block.heading !== undefined) requireValue(['text','heading'].includes(block.type) && validKey(block.heading), `Invalid block heading key: ${block.id}`);
    }
    nodes.set(node.id, node);
  }
  for (const node of candidate.nodes) {
    let parent = node.parentId;
    const visited = new Set([node.id]);
    while (parent !== null) {
      requireValue(nodes.has(parent), `Parent ${parent} does not exist (${node.id}).`);
      requireValue(!visited.has(parent), `Circular hierarchy: ${node.id}`);
      visited.add(parent);
      parent = nodes.get(parent).parentId;
    }
  }
  return candidate;
}

export function validateTextField(field){
  requireValue(plain(field)&&validKey(field.key),'Invalid shared text key.');
  for(const key of ['label','description','group'])if(field[key]!==undefined)requireValue(typeof field[key]==='string'&&field[key].length<=1000,`Invalid ${key}: ${field.key}`);
  requireValue(field.type===undefined||['plain','rich','message'].includes(field.type),`Invalid text field type: ${field.key}`);
  requireValue(field.required===undefined||typeof field.required==='boolean',`Invalid required flag: ${field.key}`);
  if(field.components!==undefined)requireValue(Array.isArray(field.components)&&field.components.length<=30&&field.components.every(validKey),`Invalid message components: ${field.key}`);
  if(field.initialValues!==undefined){requireValue(plain(field.initialValues),'Invalid initial translations.');for(const [code,text] of Object.entries(field.initialValues))requireValue((code==='default'||/^[a-z][a-z0-9-]{0,19}$/i.test(code))&&!forbidden.has(code)&&typeof text==='string'&&text.length<=200000,`Invalid initial translation: ${field.key}/${code}`);}
  return field;
}
