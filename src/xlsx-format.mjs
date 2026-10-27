import { Marked } from 'marked';
import JSZip from 'jszip';
import { richTextMarker } from './format.mjs';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const markdown = new Marked({breaks:true,gfm:true});
markdown.use({renderer:{html:token=>escape(token.text)}});
const baseFont = {name:'Arial',size:11,color:{argb:'FF243247'}};
const blocks = new Set(['p','div','h1','h2','h3','h4','h5','h6']);
const inline = new Set(['span','b','strong','i','em','u','s','del','strike','sub','sup']);

function color(value) {
  const text=String(value).trim().toLowerCase();
  if (/^#[\da-f]{6}$/.test(text)) return `FF${text.slice(1).toUpperCase()}`;
  if (/^#[\da-f]{3}$/.test(text)) return `FF${[...text.slice(1)].map(part=>part+part).join('').toUpperCase()}`;
  const rgb=text.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if(rgb && rgb.slice(1).every(part=>Number(part)<=255)) return `FF${rgb.slice(1).map(part=>Number(part).toString(16).padStart(2,'0')).join('').toUpperCase()}`;
  return {black:'FF000000',white:'FFFFFFFF',red:'FFFF0000',blue:'FF0000FF',green:'FF008000'}[text];
}
function fontColor(value, themeXml) {
  if(!value)return 'FF243247';
  if(value.argb)return value.argb.toUpperCase();
  let rgb;
  if(value.theme!==undefined) {
    const names=['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'];
    const defaults=['FFFFFF','000000','EEECE1','1F497D','4F81BD','C0504D','9BBB59','8064A2','4BACC6','F79646','0000FF','800080'];
    const name=names[value.theme];
    const element=name && themeXml?.match(new RegExp(`<a:${name}[^>]*>([\\s\\S]*?)<\\/a:${name}>`,'i'))?.[1];
    rgb=element?.match(/(?:lastClr|val)="([\da-f]{6})"/i)?.[1] || defaults[value.theme];
  } else if(value.indexed===64)rgb='000000';
  else if(value.indexed>=0 && value.indexed<16)rgb=['000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF'][value.indexed%8];
  if(!rgb)throw new Error('Unsupported Excel font color. Use an RGB font color.');
  const tint=value.tint||0;
  return 'FF'+rgb.match(/../g).map(channel=>{
    const number=parseInt(channel,16);return Math.round(tint<0?number*(1+tint):number+(255-number)*tint).toString(16).padStart(2,'0');
  }).join('').toUpperCase();
}
function normalizeFont(font={}, themeXml) {
  return {name:font.name||'Arial',size:font.size||11,bold:!!font.bold,italic:!!font.italic,
    underline:font.underline===true ? 'single' : font.underline||false,strike:!!font.strike,
    color:fontColor(font.color,themeXml),
    vertAlign:font.vertAlign||'baseline'};
}
function mergeRuns(runs) {
  const merged=[];
  for(const run of runs) {
    if(!run.text)continue;
    const previous=merged.at(-1);
    if(previous && JSON.stringify(previous.font)===JSON.stringify(run.font)) previous.text+=run.text;
    else merged.push({text:run.text,font:{...run.font}});
  }
  return merged;
}
export function textCellView(cell, themeXml) {
  const value=cell.value;
  if(value!==null && typeof value!=='string' && !Array.isArray(value?.richText)) throw new Error('Translation cells must contain text, without formulas or links.');
  return {runs:mergeRuns((value?.richText || [{text:value||''}]).map(run=>({text:run.text,font:normalizeFont({...cell.font,...run.font},themeXml)}))),
    alignment:cell.alignment?.horizontal==='general' ? 'left' : cell.alignment?.horizontal||'left'};
}

export async function createExcelTextFormatter() {
  // Load after application startup so CJS consumers (including jsdom on Node 22)
  // can finish their own parser initialization before the ESM parser is reused.
  const {parseFragment}=await import('parse5');
  return (source,heading=false)=>contentToExcel(source,heading,parseFragment);
}
function contentToExcel(source, heading, parseFragment) {
  const rich=source.startsWith(richTextMarker);
  const fragment=parseFragment(rich ? source.slice(richTextMarker.length) : markdown.parse(source));
  const runs=[]; let pending=0, editable=true, alignment;
  function append(text,font) {
    if(!text)return;
    if(pending && runs.length) runs.push({text:'\n'.repeat(pending),font:{...baseFont}});
    pending=0; runs.push({text,font:{...font}});
  }
  function walk(node,font) {
    if(node.nodeName==='#comment')return;
    if(node.nodeName==='#text') {
      if(node.value.trim() || !/[\r\n]/.test(node.value) && !pending)append(node.value,font);
      return;
    }
    const tag=node.tagName;
    if(['script','style'].includes(tag)){editable=false;return;}
    const next={...font};
    if(blocks.has(tag) && runs.length)pending=Math.max(pending,2);
    if(tag==='br'){append('\n',next);return;}
    if(['strong','b'].includes(tag))next.bold=true;
    if(['em','i'].includes(tag))next.italic=true;
    if(tag==='u')next.underline=true;
    if(['s','strike','del'].includes(tag))next.strike=true;
    if(['sub','sup'].includes(tag))next.vertAlign=tag==='sub'?'subscript':'superscript';
    if(tag && !blocks.has(tag) && !inline.has(tag))editable=false;
    for(const attribute of node.attrs||[]) {
      if(attribute.name!=='style'){editable=false;continue;}
      for(const declaration of attribute.value.split(';')) {
        const colon=declaration.indexOf(':'); if(colon<0)continue;
        const property=declaration.slice(0,colon).trim().toLowerCase(), value=declaration.slice(colon+1).trim();
        if(property==='font-weight')next.bold=/^(bold|bolder)$/i.test(value)||Number(value)>=600;
        else if(property==='font-style')next.italic=value==='italic';
        else if(['text-decoration','text-decoration-line'].includes(property)){next.underline=value.includes('underline');next.strike=value.includes('line-through');}
        else if(property==='font-family')next.name=value.split(',')[0].trim().replace(/^['"]|['"]$/g,'');
        else if(property==='font-size' && /^\d+(\.\d+)?(pt|px)$/.test(value))next.size=parseFloat(value)*(value.endsWith('px')?.75:1);
        else if(property==='color' && color(value))next.color={argb:color(value)};
        else if(property==='vertical-align' && ['sub','super'].includes(value))next.vertAlign=value==='sub'?'subscript':'superscript';
        else if(property==='text-align' && ['left','center','right','justify'].includes(value)) {
          if(alignment && alignment!==value)editable=false;
          alignment=value;
        } else editable=false;
      }
    }
    if(tag==='li')append('• ',next);
    for(const child of node.childNodes||[])walk(child,next);
    if(blocks.has(tag))pending=Math.max(pending,2);
    if(['li','tr'].includes(tag))pending=Math.max(pending,1);
  }
  // Plain strings retain their exact whitespace; Markdown is rendered only when
  // it actually contains formatting syntax, as in the application's formatter.
  if(!rich && !/[`*_#\[\]~]|^\s*(?:>|[-+]\s|\d+\.\s)/m.test(source)) {
    runs.push({text:source.replace(/\u2028/g,'\n').replace(/\u2029/g,'\n\n'),font:{...baseFont,...(heading?{bold:true}:{})}});
  } else walk(fragment,{...baseFont,...(heading?{bold:true}:{})});
  // Keep writer chunks small enough that ExcelJS never cuts a surrogate pair.
  const safeRuns=runs.flatMap(run=>{
    const chunks=[];let text='';
    for(const character of run.text){text+=character;if(text.length>=1000){chunks.push({...run,text});text='';}}
    if(text)chunks.push({...run,text});return chunks;
  });
  return {value:safeRuns.length?{richText:safeRuns}:'',alignment:alignment||'left',editable};
}

// ExcelJS decodes streamed XML chunks separately. Numeric XML references keep
// multibyte characters intact at chunk boundaries, including long emoji text.
export async function unicodeSafeWorkbook(buffer) {
  const zip=await JSZip.loadAsync(buffer);let changed=false;
  for(const entry of Object.values(zip.files)) {
    if(entry.dir || !entry.name.endsWith('.xml'))continue;
    const xml=await entry.async('string');
    if(/[^\x00-\x7F]/.test(xml)){
      zip.file(entry.name,xml.replace(/[^\x00-\x7F]/gu,character=>`&#${character.codePointAt(0)};`));changed=true;
    }
  }
  return changed ? zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}) : buffer;
}

function fontHtml(run, inherited={}) {
  const font=run.font, baseline=normalizeFont(inherited), styles=[];
  let html=escape(run.text).replace(/\n/g,'<br>');
  if(font.bold)html=`<strong>${html}</strong>`;
  if(font.italic)html=`<em>${html}</em>`;
  if(font.underline)html=`<u>${html}</u>`;
  if(font.strike)html=`<s>${html}</s>`;
  if(font.vertAlign==='subscript')html=`<sub>${html}</sub>`;
  if(font.vertAlign==='superscript')html=`<sup>${html}</sup>`;
  if(font.name!==baseline.name)styles.push(`font-family:${escape(font.name)}`);
  if(font.size!==baseline.size)styles.push(`font-size:${font.size}pt`);
  if(font.color!==baseline.color && /^[\dA-F]{8}$/.test(font.color))styles.push(`color:#${font.color.slice(2)}`);
  if(styles.length)html=`<span style="${styles.join(';')}">${html}</span>`;
  return html;
}
export function excelToContent(cell, reference, location='Translation cell', themeXml) {
  const view=textCellView(cell,themeXml), text=view.runs.map(run=>run.text).join('');
  if(reference && JSON.stringify(view)===JSON.stringify(reference.view))return reference.source;
  if(!text)return '';
  if(reference && !reference.editable)throw new Error(`${location}: this text contains layout that Excel cannot fully edit. Keep this cell unchanged or edit it in the content editor.`);
  if(!['left','center','right','justify'].includes(view.alignment)||view.runs.some(run=>run.font.underline && run.font.underline!=='single'))throw new Error(`${location}: this Excel formatting is not supported by the application. Use single underline and a standard text alignment.`);
  const normal=normalizeFont();
  const styled=view.alignment!=='left' || view.runs.some(run=>JSON.stringify(run.font)!==JSON.stringify(normal));
  if(!styled && !/[`*_#\[\]~]|^\s*(?:>|[-+]\s|\d+\.\s)/m.test(text))return text;
  const paragraphs=[''];
  for(const run of view.runs)for(const part of run.text.split(/(\n\n)/)){
    if(part==='\n\n')paragraphs.push('');
    else paragraphs[paragraphs.length-1]+=fontHtml({...run,text:part});
  }
  return richTextMarker+paragraphs.map(html=>`<p${view.alignment!=='left'?` style="text-align:${escape(view.alignment)}"`:''}>${html}</p>`).join('');
}

export function addTextFormatting(workbook, entries) {
  const sheet=workbook.addWorksheet('TextFormatting',{state:'veryHidden'});
  sheet.addRow(['key','part','payload']);
  for(const [key,values] of entries) {
    const payload=JSON.stringify(values).replace(/[^\x00-\x7F]/g,character=>`\\u${character.charCodeAt(0).toString(16).padStart(4,'0')}`);
    for(let start=0,part=0;start<payload.length;part++){
      let end=Math.min(payload.length,start+30000);
      if(end<payload.length && /[\uD800-\uDBFF]/.test(payload[end-1]))end--;
      sheet.addRow([key,part,payload.slice(start,end)]);start=end;
    }
  }
}
export function readTextFormatting(workbook) {
  const sheet=workbook.getWorksheet('TextFormatting'), chunks=new Map(), result=new Map();
  if(!sheet)return result;
  if(sheet.rowCount>200001)throw new Error('Too many formatting metadata rows.');
  sheet.eachRow((row,index)=>{
    if(index===1)return;
    const key=row.getCell(1).value, part=row.getCell(2).value, payload=row.getCell(3).value;
    if(typeof key!=='string'||!Number.isSafeInteger(part)||part<0||typeof payload!=='string')throw new Error('Invalid text formatting metadata.');
    if(!chunks.has(key))chunks.set(key,new Map());
    if(chunks.get(key).has(part))throw new Error('Duplicate text formatting metadata.');
    chunks.get(key).set(part,payload);
  });
  for(const [key,parts] of chunks) {
    let payload='';for(let part=0;part<parts.size;part++){
      if(!parts.has(part))throw new Error('Incomplete text formatting metadata.');
      payload+=parts.get(part);
    }
    try {
      const values=JSON.parse(payload);
      if(!values||typeof values!=='object'||Array.isArray(values)||Object.values(values).some(value=>!value||typeof value.source!=='string'||!value.view||!Array.isArray(value.view.runs)||typeof value.editable!=='boolean'))throw new Error();
      result.set(key,values);
    } catch {throw new Error('Invalid text formatting metadata.');}
  }
  return result;
}
