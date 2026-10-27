import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDefinition} from '../src/index.mjs';

test('host editor extensions are explicit, same-origin and independent of built-in shared-text defaults',()=>{
  assert.equal(normalizeDefinition().allowSharedTextCreation,true);
  assert.deepEqual(normalizeDefinition().editorTabs,[]);
  const tabs=[{id:'host-options',label:'Host options',url:'/host-options'}];
  const configuration=normalizeDefinition({allowSharedTextCreation:false,editorTabs:tabs});
  assert.equal(configuration.allowSharedTextCreation,false);
  assert.deepEqual(configuration.editorTabs,tabs);
  for(const tab of [
    {...tabs[0],url:'https://example.com'}, {...tabs[0],url:'//example.com'},
    {...tabs[0],url:'/../private'}, {...tabs[0],id:'shared'}, {...tabs[0],label:''},
  ])assert.throws(()=>normalizeDefinition({editorTabs:[tab]}),/editor tab/);
  assert.throws(()=>normalizeDefinition({editorTabs:[tabs[0],tabs[0]]}),/editor tab/);
  assert.throws(()=>normalizeDefinition({allowSharedTextCreation:'false'}),/boolean/);
});
