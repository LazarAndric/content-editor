import ExcelJS from 'exceljs';
import { validateContent } from './model.mjs';
import { createExcelTextFormatter, excelToContent, textCellView, addTextFormatting, readTextFormatting, unicodeSafeWorkbook } from './xlsx-format.mjs';

import {workbookFormat as FORMAT} from './compatibility.mjs';
const SHEETS = ['Structure', 'Blocks', 'Texts', 'Media', 'Languages', 'Settings'];
const TEXT_METADATA = ['key','Context','Field'];
const languageCode = header => header==='Default' ? 'default' : header==='English' ? 'en' : ['Chinese','中文'].includes(header) ? 'cn' : header.match(/\(([a-z][a-z0-9-]{0,19})\)$/i)?.[1] || header;
// Read historical Serbian exports; always write the canonical English format.
const LEGACY_SHEETS = {Structure:'Struktura',Blocks:'Blokovi',Texts:'Tekstovi',Media:'Mediji',Languages:'Jezici',Settings:'Podesavanja'};
function normalizeWorksheets(workbook) {
  for (const [name,legacyName] of Object.entries(LEGACY_SHEETS)) {
    const current=workbook.getWorksheet(name), legacy=workbook.getWorksheet(legacyName);
    requireValue(!(current && legacy),`Ambiguous worksheets: ${name} and ${legacyName}. Keep only one.`);
    if (legacy) legacy.name=name;
  }
}
const safeKey = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(value)
  && !value.split(/[.:]/).some(part => ['__proto__','prototype','constructor'].includes(part));
const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

function cellValue(cell, location, numeric = false) {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (numeric && typeof value === 'number' && Number.isFinite(value)) return value;
  if (value.richText) return value.richText.map(run => run.text).join('');
  throw new Error(`${location}: expected ${numeric ? 'a number or text' : 'text'}, without formulas or links.`);
}
function rowsOf(sheet, required, formatting = null) {
  requireValue(sheet && sheet.rowCount <= 20001, `Missing worksheet or too many rows: ${sheet?.name || required.join(', ')}`);
  const columns = new Map();
  sheet.getRow(1).eachCell((cell, index) => {
    const header = String(cellValue(cell, `${sheet.name}, header ${index}`)).trim();
    requireValue(header && !columns.has(header), `${sheet.name}: empty or duplicate header ${header}.`);
    columns.set(header,index);
  });
  for (const header of required) requireValue(columns.has(header), `${sheet.name}: missing column ${header}.`);
  const rows = [];
  const themeXml=formatting ? sheet.workbook.model.themes?.theme1 : undefined;
  for (let index=2; index<=sheet.rowCount; index++) {
    const row = sheet.getRow(index);
    if (!row.hasValues) continue;
    const values = Object.create(null);
    const key=formatting ? cellValue(row.getCell(columns.get('key')),`${sheet.name}, row ${index}, key`) : '';
    for (const [header,column] of columns) {
      const cell=row.getCell(column), location=`${sheet.name}, row ${index}, ${header}`;
      const reference=formatting?.get(key)?.[languageCode(header)];
      const styled=cell.value?.richText || cell.font?.bold || cell.font?.italic || cell.font?.underline || cell.font?.strike;
      values[header]=formatting && !TEXT_METADATA.includes(header) && (reference || styled)
        ? excelToContent(cell,reference,location,themeXml) : cellValue(cell,location,header==='order');
    }
    if (Object.values(values).every(value=>value==='')) continue;
    rows.push({values,index});
  }
  return {rows,headers:[...columns.keys()]};
}

function addSheet(workbook, name, headers, records) {
  requireValue(records.length<=20000,`${name}: XLSX supports a maximum of 20000 rows per worksheet.`);
  for (const row of records) for (const value of row) requireValue((typeof value==='string' ? value.length : value?.richText?.reduce((length,run)=>length+run.text.length,0)||0)<=32767,`${name}: text exceeds the Excel limit of 32767 characters per cell. Use JSON export for this content.`);
  const sheet = workbook.addWorksheet(name,{views:[{state:'frozen',xSplit:1,ySplit:1}],properties:{tabColor:{argb:'FF277D85'}}});
  sheet.columns = headers.map(header=>({header,key:header,width:['key','id','nodeId','labelKey','titleKey','textKey','mediaId','parentId'].includes(header) ? 42 : ['order','type','code'].includes(header) ? 13 : header==='label' ? 24 : 58}));
  for (const record of records) sheet.addRow(record);
  sheet.autoFilter = {from:{row:1,column:1},to:{row:Math.max(1,sheet.rowCount),column:headers.length}};
  sheet.getRow(1).height = 27;
  sheet.getRow(1).eachCell(cell=>{cell.font={name:'Calibri',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF183E4A'}};});
  for (let index=2; index<=sheet.rowCount; index++) {
    const row=sheet.getRow(index); row.height=name==='Texts' ? 48 : 27;
    row.eachCell({includeEmpty:true},cell=>{
      cell.font={name:'Calibri',size:11,color:{argb:'FF173644'}};
      cell.alignment={vertical:'top',wrapText:true};
      if (index%2===0) cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F6F8'}};
      if (typeof cell.value==='number') cell.numFmt='0';
    });
  }
  return sheet;
}

export async function exportContentWorkbook(content) {
  validateContent(content);
  const contentToExcel=await createExcelTextFormatter();
  const workbook = new ExcelJS.Workbook();
  workbook.creator='Content Editor'; workbook.title='Content';
  workbook.views=[{activeTab:0,firstSheet:0}];
  const languages = [...new Set([...content.languages.map(item=>item.code),
    ...Object.values(content.texts).flatMap(values=>Object.keys(values)),
    ...Object.values(content.media).flatMap(medium=>Object.keys(medium.files))])].filter(code=>code!=='default');
  const nodes = [];
  const visit = parent => content.nodes.filter(node=>node.parentId===parent).sort((a,b)=>a.order-b.order).forEach(node=>{nodes.push(node);visit(node.id);});
  visit(null);
  const references=new Map(), orderedKeys=[];
  const refer=(key,context,field,heading=false)=>{
    if(!key || !Object.hasOwn(content.texts,key))return;
    if(!references.has(key)){references.set(key,[]);orderedKeys.push(key);}
    references.get(key).push({context,field,heading});
  };
  const label=node=>{
    const source=String(content.texts[node.label]?.[content.defaultLanguage]||content.texts[node.label]?.default||node.id);
    const prepared=contentToExcel(source).value;
    return typeof prepared==='string' ? prepared : prepared.richText.map(run=>run.text).join('');
  };
  const paths=new Map();
  for(const node of nodes) {
    const context=[paths.get(node.parentId),label(node)].filter(Boolean).join(' / ');paths.set(node.id,context);
    refer(node.label,context,'Menu label');refer(node.title,context,'Outer title');
    node.blocks.forEach((block,index)=>{
      refer(block.heading,context,`Block ${index+1} heading`,true);
      refer(block.key,context,`Block ${index+1} ${block.type==='heading'?'heading':'text'}`,block.type==='heading');
    });
  }
  for(const key of Object.keys(content.texts))if(!references.has(key)){
    const field=content.textFields?.[key];
    refer(key,field?.group||'Shared text',field?.label||key);
  }
  const localeColumns=['default',...languages], metadata=new Map();
  const records=orderedKeys.map(key=>{
    const refs=references.get(key), source=content.texts[key];
    const cells=localeColumns.map(code=>source[code] ? contentToExcel(source[code],refs.some(ref=>ref.heading)) : {value:'',editable:true,alignment:'left'});
    metadata.set(key,Object.fromEntries(localeColumns.filter(code=>source[code]).map(code=>[code,{source:source[code],editable:cells[localeColumns.indexOf(code)].editable}])));
    return [[...new Set(refs.map(ref=>ref.context))].join('; '),[...new Set(refs.map(ref=>ref.field))].join('; '),...cells.map(cell=>cell.value),key];
  });
  const headers=['Context','Field','Default',...languages.map(code=>`${code==='en'?'English':code==='cn'?'Chinese':content.languages.find(item=>item.code===code)?.label||code} (${code})`),'key'];
  const texts=addSheet(workbook,'Texts',headers,records);
  texts.views=[{state:'frozen',xSplit:2,ySplit:1,showGridLines:false}];
  texts.getColumn(1).width=40;texts.getColumn(2).width=23;texts.getColumn(3).width=32;
  texts.getColumn(headers.length).hidden=true;
  for(let index=0;index<orderedKeys.length;index++) {
    const row=texts.getRow(index+2), key=orderedKeys[index], refs=references.get(key);
    let lines=1;
    localeColumns.forEach((code,column)=>{
      const cell=row.getCell(column+3), source=content.texts[key][code];
      if(!source)return;
      const prepared=contentToExcel(source,refs.some(ref=>ref.heading));
      cell.font={name:'Arial',size:11,color:{argb:'FF243247'}};
      cell.alignment={vertical:'top',wrapText:true,horizontal:prepared.alignment};
      metadata.get(key)[code].view=textCellView(cell);
      lines=Math.max(lines,...[cell.text.split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil(line.length/(column===0?29:55))),0)]);
    });
    row.height=Math.min(409,Math.max(30,lines*15+12));
  }
  addSheet(workbook,'Structure',['id','parentId','order','labelKey','titleKey'],nodes.map(node=>[node.id,node.parentId || '',node.order,node.label,node.title]));
  addSheet(workbook,'Blocks',['id','nodeId','order','type','textKey','mediaId','headingKey'],nodes.flatMap(node=>node.blocks.map((block,index)=>[block.id,node.id,index,block.type,block.key || '',block.media || '',block.heading || ''])));
  addSheet(workbook,'Media',['id','type','Default',...languages],Object.entries(content.media).map(([id,medium])=>[id,medium.type,medium.files.default || '',...languages.map(code=>medium.files[code] || '')]));
  addSheet(workbook,'Languages',['code','label'],content.languages.map(item=>[item.code,item.label]));
  addSheet(workbook,'Settings',['key','value'],[['format',FORMAT],['defaultLanguage',content.defaultLanguage],['textEncoding','excel-rich-text-v1']]);
  addTextFormatting(workbook,metadata);
  // Optional metadata sheets preserve editor field definitions and project semantics.
  if(content.textFields)addSheet(workbook,'SharedFields',['key','metadata'],Object.entries(content.textFields).map(([key,value])=>[key,JSON.stringify(value)]));
  const extraNodes=content.nodes.filter(node=>node.meta!==undefined);
  if(extraNodes.length)addSheet(workbook,'ItemMetadata',['id','metadata'],extraNodes.map(node=>[node.id,JSON.stringify(node.meta)]));
  const roles=content.nodes.flatMap(node=>node.blocks.filter(block=>block.role!==undefined));
  if(roles.length)addSheet(workbook,'BlockRoles',['id','role'],roles.map(block=>[block.id,block.role]));
  const descriptions=Object.entries(content.media).filter(([,medium])=>medium.alt!==undefined||medium.decorative!==undefined);
  if(descriptions.length)addSheet(workbook,'MediaDetails',['id','metadata'],descriptions.map(([id,{alt,decorative}])=>[id,JSON.stringify({alt,decorative})]));
  const directions=content.languages.filter(language=>language.dir!==undefined);
  if(directions.length)addSheet(workbook,'LanguageDetails',['code','dir'],directions.map(language=>[language.code,language.dir]));
  return unicodeSafeWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
}

function readLocalized(values, headers, ignored) {
  const result = {}, seen = new Set();
  for (const header of headers.filter(header=>!ignored.includes(header))) {
    const code=languageCode(header);
    requireValue(/^[a-z][a-z0-9-]{0,19}$/i.test(code) && !['constructor','prototype','__proto__'].includes(code),`Unknown language column: ${header}`);
    requireValue(!seen.has(code),`Duplicate language column: ${header}`); seen.add(code);
    if (values[header] !== '') result[code]=values[header];
  }
  return result;
}
function changedTextCount(before, after) {
  return Object.keys(after).filter(key=>JSON.stringify(before[key] || {})!==JSON.stringify(after[key])).length;
}
function parseFull(workbook,current) {
  for (const name of SHEETS) requireValue(workbook.getWorksheet(name),`A full XLSX must contain worksheet ${name}.`);
  const settings = Object.create(null);
  for (const {values} of rowsOf(workbook.getWorksheet('Settings'),['key','value']).rows) {
    requireValue(!Object.hasOwn(settings,values.key),`Duplicate setting: ${values.key}`); settings[values.key]=values.value;
  }
  requireValue(settings.format===FORMAT,'Unknown full-content XLSX format.');
  requireValue(!settings.textEncoding || settings.textEncoding==='excel-rich-text-v1','Unknown text encoding.');
  requireValue(!settings.textEncoding || workbook.getWorksheet('TextFormatting'),'Missing TextFormatting metadata. Re-export the content before importing it.');
  const content = {version:1,revision:current.revision,defaultLanguage:settings.defaultLanguage,languages:[],nodes:[],texts:{},media:{}};
  content.languages=rowsOf(workbook.getWorksheet('Languages'),['code','label']).rows.map(({values})=>({code:values.code,label:values.label}));
  const nodeMap=new Map();
  for (const {values} of rowsOf(workbook.getWorksheet('Structure'),['id','parentId','order','labelKey','titleKey']).rows) {
    requireValue(!nodeMap.has(values.id),`Duplicate item ID: ${values.id}`);
    requireValue(values.order!=='' && Number.isFinite(Number(values.order)),`Invalid order: ${values.id}`);
    const node={id:values.id,parentId:values.parentId || null,order:Number(values.order),label:values.labelKey,title:values.titleKey,blocks:[]};
    content.nodes.push(node); nodeMap.set(node.id,node);
  }
  const blocks=[];
  for (const {values} of rowsOf(workbook.getWorksheet('Blocks'),['id','nodeId','order','type','textKey','mediaId']).rows) {
    requireValue(nodeMap.has(values.nodeId),`The block parent item does not exist: ${values.id}`);
    requireValue(values.order!=='' && Number.isFinite(Number(values.order)),`Invalid block order: ${values.id}`);
    blocks.push({...values,order:Number(values.order)});
  }
  blocks.sort((a,b)=>a.order-b.order).forEach(values=>nodeMap.get(values.nodeId).blocks.push(['text','heading'].includes(values.type)
    ? {id:values.id,type:values.type,key:values.textKey,...(values.headingKey ? {heading:values.headingKey} : {})} : {id:values.id,type:values.type,media:values.mediaId}));
  const texts=rowsOf(workbook.getWorksheet('Texts'),['key','Default'],readTextFormatting(workbook));
  for (const {values} of texts.rows) {
    requireValue(safeKey(values.key) && !Object.hasOwn(content.texts,values.key),`Invalid or duplicate text key: ${values.key}`);
    content.texts[values.key]=readLocalized(values,texts.headers,TEXT_METADATA);
  }
  const media=rowsOf(workbook.getWorksheet('Media'),['id','type','Default']);
  for (const {values} of media.rows) {
    requireValue(safeKey(values.id) && !Object.hasOwn(content.media,values.id),`Invalid or duplicate media ID: ${values.id}`);
    content.media[values.id]={type:values.type,files:readLocalized(values,media.headers,['id','type'])};
  }
  for(const [name,idColumn,apply] of [
    ['SharedFields','key',(id,value)=>{content.textFields||={};requireValue(safeKey(id),'Invalid shared field key.');content.textFields[id]=value;}],
    ['ItemMetadata','id',(id,value)=>{requireValue(nodeMap.has(id),`Missing item metadata target: ${id}`);nodeMap.get(id).meta=value;}],
    ['MediaDetails','id',(id,value)=>{requireValue(Object.hasOwn(content.media,id),`Missing media metadata target: ${id}`);const {alt,decorative}=value;Object.assign(content.media[id],alt===undefined?{}:{alt},decorative===undefined?{}:{decorative});}],
  ])if(workbook.getWorksheet(name)){
    const seen=new Set();for(const {values} of rowsOf(workbook.getWorksheet(name),[idColumn,'metadata']).rows){const id=values[idColumn];requireValue(!seen.has(id),`Duplicate metadata ID: ${id}`);seen.add(id);apply(id,JSON.parse(values.metadata));}
  }
  if(workbook.getWorksheet('BlockRoles')){const seen=new Set(),map=new Map(content.nodes.flatMap(node=>node.blocks).map(block=>[block.id,block]));for(const {values} of rowsOf(workbook.getWorksheet('BlockRoles'),['id','role']).rows){requireValue(map.has(values.id)&&!seen.has(values.id),`Invalid or duplicate block role: ${values.id}`);seen.add(values.id);map.get(values.id).role=values.role;}}
  if(workbook.getWorksheet('LanguageDetails')){const seen=new Set();for(const {values} of rowsOf(workbook.getWorksheet('LanguageDetails'),['code','dir']).rows){const language=content.languages.find(item=>item.code===values.code);requireValue(language&&!seen.has(values.code),`Invalid or duplicate language direction: ${values.code}`);seen.add(values.code);language.dir=values.dir;}}
  validateContent(content);
  return {content,report:{format:'full',label:'Full content',nodes:content.nodes.length,blocks:blocks.length,texts:Object.keys(content.texts).length,
    changedTexts:changedTextCount(current.texts,content.texts),media:Object.keys(content.media).length,languages:content.languages.length,
    message:'Import replaces the structure, blocks, texts, languages, and media references. Media files are not included in XLSX.'}};
}
function parseTranslations(sheet,current,legacy,formatting,resolveKey) {
  const parsed=rowsOf(sheet,['key',...(legacy ? ['English'] : ['Default'])],formatting);
  if (legacy) requireValue(parsed.headers.includes('Chinese') || parsed.headers.includes('中文'),`${sheet.name}: missing column Chinese.`);
  const content=structuredClone(current), seen=new Set(); let changedCells=0, blankCells=0, newTexts=0;
  const languageColumns=parsed.headers.filter(header=>![...TEXT_METADATA,'Screen','Ekran','Element'].includes(header)).map(header=>({header,code:languageCode(header)}));
  const codes=new Set();
  for (const {code} of languageColumns) {
    requireValue(/^[a-z][a-z0-9-]{0,19}$/i.test(code) && !['constructor','prototype','__proto__'].includes(code),`Unknown language column: ${code}`);
    requireValue(!codes.has(code),`Duplicate language column: ${code}`); codes.add(code);
  }
  for (const {values,index} of parsed.rows) {
    const inputKey=values.key.trim();
    const key=legacy ? resolveKey(inputKey) || inputKey : inputKey;
    requireValue(safeKey(key),`${sheet.name}, row ${index}: invalid key ${inputKey}.`);
    requireValue(!seen.has(key),`${sheet.name}, row ${index}: duplicate key ${inputKey}.`); seen.add(key);
    if (!Object.hasOwn(content.texts,key)) { content.texts[key]={}; newTexts++; }
    for (const {header,code} of languageColumns) {
      const text=values[header];
      if (!text.trim()) { blankCells++; continue; }
      const next=text==='[CLEAR]' ? '' : text;
      if ((content.texts[key][code] || '')!==next) { changedCells++; content.texts[key][code]=next; }
    }
  }
  requireValue(seen.size>0,'The worksheet contains no texts to import.');
  for (const {code} of languageColumns) if (code!=='default' && !content.languages.some(item=>item.code===code)) content.languages.push({code,label:code==='en' ? 'Eng' : code==='cn' ? '中文' : code});
  validateContent(content);
  return {content,report:{format:'translations',label:legacy ? 'Existing languages.xlsx' : 'Texts',texts:seen.size,changedCells,newTexts,blankCells,
    nodes:content.nodes.length,languages:content.languages.length,
    message:'Updates translations by key. Structure and media are preserved. Empty cells keep existing text; [CLEAR] clears a value.'}};
}

export async function importContentWorkbook(buffer,current,{resolveKey=key=>key}={}) {
  requireValue(buffer.length<=20*1024*1024,'XLSX files must not exceed 20 MB.');
  const workbook=new ExcelJS.Workbook();
  try { await workbook.xlsx.load(await unicodeSafeWorkbook(buffer)); } catch { throw new Error('The XLSX file is invalid or cannot be read.'); }
  requireValue(workbook.worksheets.length<=20,'Too many Excel worksheets.');
  normalizeWorksheets(workbook);
  if (workbook.getWorksheet('Structure') || workbook.getWorksheet('Settings')) return parseFull(workbook,current);
  if (workbook.getWorksheet('Translations')) return parseTranslations(workbook.getWorksheet('Translations'),current,true,readTextFormatting(workbook),resolveKey);
  if (workbook.getWorksheet('Texts')) return parseTranslations(workbook.getWorksheet('Texts'),current,false,readTextFormatting(workbook),resolveKey);
  throw new Error('Unknown XLSX format. Expected a full editor export, a Texts worksheet, or an existing Translations worksheet.');
}
