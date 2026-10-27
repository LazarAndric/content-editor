import http from 'node:http';
import fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createContent, validateContent } from './model.mjs';
import { normalizeDefinition,validateDefinitionContent } from './index.mjs';
import { openLocalContent } from './local.mjs';
import {browserAsset} from './browser-assets.mjs';
import {publicFile} from './static-files.mjs';
import {planTextFields,applyTextFields} from './fields.mjs';
import {diagnoseContent} from './diagnostics.mjs';

const editorDirectory = fileURLToPath(new URL('../editor/', import.meta.url));
const require=createRequire(import.meta.url);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.ogg': 'video/ogg',
  '.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon' };

async function readBody(request, limit = 20 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) { const error = new Error('The file or request is too large.'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveFile(request, response, filename) {
  const stat = await fsp.stat(filename);
  if (!stat.isFile()) throw Object.assign(new Error('File does not exist.'), { status: 404 });
  const headers = { 'Content-Type': mime[path.extname(filename).toLowerCase()] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
  let start = 0, end = stat.size - 1, status = 200;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || !stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
    start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
    status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
  }
  headers['Content-Length'] = stat.size ? end - start + 1 : 0;
  response.writeHead(status, headers);
  if (request.method === 'HEAD' || !stat.size) response.end();
  else fs.createReadStream(filename, { start, end }).on('error', () => response.destroy()).pipe(response);
}

export async function startContentServer({ directory,initialContent=createContent(),definition={},validate=validateContent,
  resolveKey=key=>key,exportFilename='content.xlsx',port=8012,host='127.0.0.1',siteDirectory,handleRequest } = {}) {
  const editor=normalizeDefinition(definition);
  const validateConfigured=content=>validateDefinitionContent(validate(content),editor);
  if(!/^[a-zA-Z0-9_.-]+\.xlsx$/.test(exportFilename))throw new Error('Invalid XLSX download filename.');
  const repository=await openLocalContent({directory,initialContent,validate:validateConfigured});
  const mediaDirectory = path.join(directory, 'content-media');
  let content=repository.getSnapshot();
  const clients = new Set();
  const broadcast = (event, data) => { for (const client of clients) client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const unsubscribe=repository.subscribe(next=>{content=next;broadcast('content',content);});
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', os.hostname().toLowerCase(),
    ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(net => net.address.toLowerCase())]);
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const json = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); };
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (!allowedHosts.has(url.hostname.toLowerCase())) return json(403, { error: 'Unknown host.' });
      const origin = request.headers.origin;
      if (origin && origin !== 'null') {
        let source; try { source = new URL(origin); } catch { return json(403, { error: 'Unknown origin.' }); }
        const loopback = name => ['localhost', '127.0.0.1', '[::1]'].includes(name);
        if (source.hostname !== url.hostname && !(loopback(source.hostname) && loopback(url.hostname))) return json(403, { error: 'Origin is not allowed.' });
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      } else if (origin === 'null') {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return json(403, { error: 'Changes must be made through the editor.' });
        response.setHeader('Access-Control-Allow-Origin', 'null');
      }
      if (request.method === 'OPTIONS') {
        response.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD, PUT, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-File-Name' }); response.end(); return;
      }
      // Host routes share the editor's origin checks; project logic stays outside this package.
      if(handleRequest&&await handleRequest(request,response,{url,json,readBody:limit=>readBody(request,limit),broadcast}))return;
      if (request.method === 'GET' && url.pathname === '/api/content') return json(200, { content, warning: repository.getWarning() });
      if (request.method === 'GET' && url.pathname === '/api/editor-config') return json(200,editor);
      if (request.method === 'GET' && url.pathname === '/api/diagnostics') return json(200,diagnoseContent(content,editor));
      if (request.method === 'GET' && url.pathname === '/api/fields/plan') return json(200,{baseRevision:content.revision,changes:planTextFields(content,editor)});
      if (request.method === 'POST' && url.pathname === '/api/fields/apply') {
        const incoming=JSON.parse((await readBody(request,4096)).toString('utf8'));
        return json(200,await repository.save(applyTextFields(content,editor),incoming.baseRevision));
      }
      if (request.method === 'GET' && url.pathname === '/api/xlsx/export') {
        const {exportContentWorkbook}=await import('./xlsx.mjs');
        const buffer=await exportContentWorkbook(content);
        response.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition':`attachment; filename="${exportFilename}"`,'Content-Length':buffer.length});
        response.end(buffer); return;
      }
      if (request.method === 'POST' && ['/api/xlsx/import','/api/xlsx/legacy'].includes(url.pathname)) {
        const {importContentWorkbook}=await import('./xlsx.mjs');
        const current=content;
        const buffer=url.pathname.endsWith('/legacy') ? await fsp.readFile(path.join(directory,'languages.xlsx')) : await readBody(request);
        const imported=await importContentWorkbook(buffer,current,{resolveKey});
        validateConfigured(imported.content);
        return json(200,{...imported,baseRevision:current.revision});
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        response.write(`event: content\ndata: ${JSON.stringify(content)}\n\n`);
        clients.add(response); request.on('close', () => clients.delete(response)); return;
      }
      if (request.method === 'PUT' && url.pathname === '/api/content') {
        const incoming = JSON.parse((await readBody(request)).toString('utf8'));
        const saved=await repository.save(incoming.content,incoming.baseRevision);
        json(200,saved);return;
      }
      if (request.method === 'POST' && url.pathname === '/api/preview') {
        if(!editor.preview)return json(404,{error:'Application preview is not configured.'});
        const preview = JSON.parse((await readBody(request, 4096)).toString('utf8'));
        if (preview.nodeId && !content.nodes.some(node => node.id === preview.nodeId)) return json(400, { error: 'The item has not been saved or does not exist.' });
        if (!content.languages.some(language => language.code === preview.language)) return json(400, { error: 'Unknown language.' });
        broadcast('preview', { nodeId: preview.nodeId || null, language: preview.language });
        return json(200, { ok: true });
      }
      if (request.method === 'POST' && url.pathname === '/api/media') {
        const name = decodeURIComponent(request.headers['x-file-name'] || '');
        const extension = path.extname(name).toLowerCase();
        if (!['.png','.jpg','.jpeg','.gif','.webp','.avif','.mp4','.webm','.mov','.m4v','.ogg'].includes(extension)) return json(400, { error: 'Supported files: PNG, JPG, GIF, WebP, AVIF, MP4, WebM, MOV, M4V, and OGG.' });
        await fsp.mkdir(mediaDirectory, { recursive: true });
        const nameOnDisk = `${randomUUID()}${extension}`;
        const target = path.join(mediaDirectory, nameOnDisk), temporary = `${target}.upload`;
        let size = 0;
        const handle = await fsp.open(temporary, 'wx');
        try {
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 250 * 1024 * 1024) throw Object.assign(new Error('Media files must not exceed 250 MB.'), { status: 413 });
            await handle.writeFile(chunk);
          }
          if (!size) throw new Error('The file is empty.');
          await handle.close(); await fsp.rename(temporary, target);
        } catch (error) { await handle.close().catch(() => {}); await fsp.rm(temporary, { force: true }); throw error; }
        return json(201, { file: `/content-media/${nameOnDisk}`, name, type: mime[extension].startsWith('image/') ? 'image' : 'video' });
      }
      if (['GET', 'HEAD'].includes(request.method) && /^\/content-media\/[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(url.pathname)) {
        await serveFile(request, response, path.join(mediaDirectory, path.basename(url.pathname))); return;
      }
      const modules = {
        '/content-format.js':fileURLToPath(new URL('./format.mjs',import.meta.url)),
        '/compatibility.mjs':fileURLToPath(new URL('./compatibility.mjs',import.meta.url)),
        '/vendor/purify.es.mjs':path.join(path.dirname(require.resolve('dompurify')),'purify.es.mjs'),
        '/vendor/marked.esm.js':require.resolve('marked'),
        '/vendor/suneditor/suneditor.min.js':path.join(path.dirname(require.resolve('suneditor/package.json')),'dist/suneditor.min.js'),
        '/vendor/suneditor/suneditor.min.css':path.join(path.dirname(require.resolve('suneditor/package.json')),'dist/suneditor.min.css'),
        '/vendor/suneditor/dark.css':path.join(path.dirname(require.resolve('suneditor/package.json')),'src/themes/dark.css'),
        '/vendor/suneditor/LICENSE.txt':path.join(path.dirname(require.resolve('suneditor/package.json')),'LICENSE.txt'),
      };
      if (['GET','HEAD'].includes(request.method) && modules[url.pathname]) {
        await serveFile(request,response,modules[url.pathname]); return;
      }
      if(['GET','HEAD'].includes(request.method) && url.pathname.startsWith('/content-kit/')){
        const name=url.pathname.slice('/content-kit/'.length);
        const source=name==='runtime.mjs'?'export const contentOptions = {};':await browserAsset(name);
        if(source===null)return json(404,{error:'Unknown browser module.'});
        response.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','X-Content-Type-Options':'nosniff'});response.end(request.method==='HEAD'?undefined:source);return;
      }
      const pages = { ...(!siteDirectory?{'/':'content-editor.html'}:{}), '/editor': 'content-editor.html', '/content-editor.js': 'content-editor.js', '/content-editor.css': 'content-editor.css' };
      if (['GET', 'HEAD'].includes(request.method) && pages[url.pathname]) {
        await serveFile(request, response, path.join(editorDirectory,pages[url.pathname])); return;
      }
      if(siteDirectory && ['GET','HEAD'].includes(request.method)){
        const file=await publicFile(siteDirectory,url.pathname);
        if(file){await serveFile(request,response,file);return;}
      }
      json(404, { error: 'Not found.' });
    } catch (error) {
      if (!response.headersSent) json(error.status || (error.code === 'ENOENT' ? 404 : 400), { error: error.code === 'ENOENT' ? 'File does not exist.' : error.message,...(error.revision!==undefined?{revision:error.revision}:{}) });
      else response.destroy();
    }
  });
  const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n'); }, 20000);
  heartbeat.unref();
  server.on('close', () => {clearInterval(heartbeat);unsubscribe();});
  const nativeClose = server.close.bind(server);
  server.close = callback => { for (const client of clients) client.end(); clients.clear(); return nativeClose(callback); };
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  console.log(`Content editor: http://localhost:${server.address().port}/editor`);
  return server;
}
