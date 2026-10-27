#!/usr/bin/env node
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {realpathSync} from 'node:fs';
import {watch} from 'node:fs';
import {initContentProject} from './init.mjs';
import {startContentServer} from './server.mjs';
import {exportContentSite} from './export-site.mjs';
import {inspectContentProject} from './doctor.mjs';
import {openLocalContent} from './local.mjs';
import {planTextFields,applyTextFields} from './fields.mjs';

export async function run(args=process.argv.slice(2)){
  const {values,positionals}=parseArgs({args,allowPositionals:true,options:{
    template:{type:'string'},dir:{type:'string'},config:{type:'string'},out:{type:'string'},port:{type:'string'},help:{type:'boolean'},apply:{type:'boolean'},
  }});
  const command=positionals[0];
  if(values.help||!command){console.log('Content Kit\n  content-kit init --template vanilla [--dir demo]\n  content-kit dev [--config content-kit.config.mjs] [--port 8012]\n  content-kit doctor [--config content-kit.config.mjs]\n  content-kit fields [--apply] [--config content-kit.config.mjs]\n  content-kit export [--out new-directory] [--config content-kit.config.mjs]');return;}
  if(positionals.length>1)throw new Error('Unexpected positional argument. Use --help.');
  if(command==='init'){
    const result=await initContentProject({directory:values.dir,template:values.template});
    console.log(`Created vanilla starter: ${result.directory}\nNext: npm install, then npm run dev in that directory.`);return;
  }
  if(!['dev','export','doctor','fields'].includes(command))throw new Error(`Unknown command: ${command}`);
  const configFile=path.resolve(values.config||'content-kit.config.mjs');
  const imported=await import(pathToFileURL(configFile));
  const config=imported.default;
  if(!config||typeof config!=='object')throw new Error('The configuration must have a default object export.');
  const root=path.dirname(configFile),settings={...config,
    directory:path.resolve(root,config.directory||'content'),
    siteDirectory:path.resolve(root,config.siteDirectory||'public'),
  };
  if(command==='doctor'){
    const report=await inspectContentProject(settings);console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;return report;
  }
  if(command==='fields'){
    const local=await openLocalContent(settings),content=local.getSnapshot(),changes=planTextFields(content,settings.definition);
    console.log(JSON.stringify({baseRevision:content.revision,changes},null,2));
    if(values.apply&&changes.length){await local.save(applyTextFields(content,settings.definition),content.revision);console.log('Field plan applied. Existing translations were preserved.');}
    return;
  }
  if(command==='export'){
    if(!values.out&&!config.outDirectory)throw new Error('Choose a fresh output directory with --out or configure outDirectory. Existing output is never overwritten.');
    const result=await exportContentSite({...settings,outDirectory:values.out?path.resolve(values.out):path.resolve(root,config.outDirectory)});
    console.log(`Static site exported to ${result.directory} (${result.items} items, ${result.mediaFiles} media files).`);return;
  }
  const port=Number(values.port??config.port??8012);
  if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Port must be an integer between 0 and 65535.');
  const server=await startContentServer({...settings,port});
  let notified=false;const watcher=watch(root,(_event,filename)=>{if((String(filename)===path.basename(configFile)||String(filename).endsWith('.mjs'))&&!notified){notified=true;console.log('Content Kit project configuration/module changed. Restart npm run dev to load it. Saved content continues to update live.');}});watcher.unref();
  watcher.on('error',error=>console.warn(`Content Kit configuration watcher: ${error.message}`));
  console.log(`Site: http://${settings.host||'127.0.0.1'}:${server.address().port}/\nStop with Ctrl+C.`);
  const stop=()=>{server.close(()=>{});server.closeIdleConnections();};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  server.once('close',()=>{watcher.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);});
  return server;
}
if(process.argv[1]&&process.argv[1]!=='-'&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))run().catch(error=>{console.error(`Content Editor: ${error.message}`);process.exitCode=1;});
