import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import ExcelJS from 'exceljs';
import {createContentFormatter} from '../src/format.mjs';
import {validateContent} from '../src/index.mjs';
import {exportContentWorkbook,importContentWorkbook} from '../src/xlsx.mjs';

const fixture=async()=>JSON.parse(await readFile(new URL('./fixtures/v0.3-content.json',import.meta.url),'utf8'));

test('0.3 JSON and workbook preserve IDs, language variants, rich text and media in 0.4',async()=>{
  const content=await fixture();
  validateContent(content);
  const imported=await importContentWorkbook(await readFile(new URL('./fixtures/v0.3-content.xlsx',import.meta.url)),content);
  assert.deepEqual(imported.content,content);
  const dom=new JSDOM('');
  try{
    const format=createContentFormatter(dom.window);
    assert.equal(format.html(imported.content.texts['root.body'].fr),'<p><strong>Ancien</strong> texte 中文</p>');
    assert.equal(format.store('<p>Updated</p>').split('<p>')[0],content.texts['root.body'].fr.split('<p>')[0]);
  }finally{dom.window.close();}
});

test('0.4 Excel keeps the 0.3 wire ID and uses neutral authorship and shared-text contexts',async()=>{
  const content=await fixture(),workbook=new ExcelJS.Workbook();
  content.textFields={'common.action':{label:'Continue button',group:'Checkout',type:'plain'}};
  await workbook.xlsx.load(await exportContentWorkbook(content));
  assert.equal(workbook.creator,'Content Editor');
  const old=new ExcelJS.Workbook();
  await old.xlsx.load(await readFile(new URL('./fixtures/v0.3-content.xlsx',import.meta.url)));
  const format=book=>{
    const sheet=book.getWorksheet('Settings');
    for(let row=2;row<=sheet.rowCount;row++)if(sheet.getCell(row,1).value==='format')return sheet.getCell(row,2).value;
    assert.fail('Missing workbook format');
  };
  assert.equal(format(workbook),format(old));
  const texts=workbook.getWorksheet('Texts');
  assert.equal(texts.getCell(1,4).value,'Français (fr)');
  const row=texts.getRows(2,texts.rowCount-1).find(row=>row.getCell(texts.columnCount).value==='common.action');
  assert.equal(row.getCell(1).value,'Checkout');
  assert.equal(row.getCell(2).value,'Continue button');
  assert.deepEqual((await importContentWorkbook(await exportContentWorkbook(content),content)).content,content);
});
