const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {imageModels,videoModels,presets}=require('../src/catalog.cjs');
const {resolveSize}=require('../src/sizing.cjs');
const root=path.resolve(__dirname,'..');
const types={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.html':'text/html'};
const settings={baseUrl:'https://www.geeknow.top',hasKey:false,keyTail:''};
const mock=`window.workbench={init:async()=>({settings:${JSON.stringify(settings)},imageModels:${JSON.stringify(imageModels)},videoModels:${JSON.stringify(videoModels)},presets:${JSON.stringify(presets)},history:[],version:'0.1.0'}),resolveSize:async x=>fetch('/__size?model='+encodeURIComponent(x.modelId)+'&preset='+encodeURIComponent(x.presetId)+'&prompt='+encodeURIComponent(x.prompt||'')).then(r=>r.json()),onNotice:()=>{},onHistory:()=>{},onUpdate:()=>{},history:async()=>[],chooseReferences:async()=>[],clearReferences:async()=>{},verifySettings:async()=>({ok:true,modelCount:0}),saveSettings:async x=>({...${JSON.stringify(settings)},baseUrl:x.baseUrl,hasKey:!!x.apiKey,keyTail:x.apiKey?.slice(-4)||''})};`;
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/__mock.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(mock);return;}
  if(url.pathname==='/__size'){const model=[...imageModels,...videoModels].find(x=>x.id===url.searchParams.get('model'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(model?resolveSize(model,url.searchParams.get('preset'),url.searchParams.get('prompt')):null));return;}
  const relative=url.pathname==='/'?'src/renderer/index.html':decodeURIComponent(url.pathname.slice(1));
  const file=path.resolve(root,relative);
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{let content=fs.readFileSync(file);if(relative==='src/renderer/index.html')content=Buffer.from(String(content).replace('<head>','<head><base href="/src/renderer/">').replace('<script src="app.js"></script>','<script src="/__mock.js"></script><script src="app.js"></script>'));
    res.setHeader('Content-Type',(types[path.extname(file)]||'application/octet-stream')+'; charset=utf-8');res.end(content);}catch{res.writeHead(404);res.end();}
}).listen(4173,'127.0.0.1',()=>console.log('Preview: http://127.0.0.1:4173/'));
