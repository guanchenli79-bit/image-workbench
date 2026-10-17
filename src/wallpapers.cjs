const crypto=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const {REGISTRY_REPO,REGISTRY_BRANCH}=require('./license.cjs');
const {networkFetch}=require('./network.cjs');

const MANIFEST_PATH='wallpapers/manifest.json';
const MAX_WALLPAPER_BYTES=25*1024*1024;
const MAX_RELEASE_WALLPAPER_BYTES=100*1024*1024;
const WALLPAPER_RELEASE_TAG='wallpaper-library';
const DEFAULT_WALLPAPER={id:'original',name:'默认动态壁纸',kind:'bundled'};
const defaultManifest=()=>({version:1,activeId:'original',items:[{...DEFAULT_WALLPAPER}]});
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
let cachedManifest=null;
let cachedEtag='';

function validateManifest(value){
  if(value?.version!==1||!Array.isArray(value.items)||value.items.length<1||value.items.length>100)throw new Error('壁纸目录格式不正确');
  const ids=new Set();
  for(const item of value.items){
    if(!/^[a-z0-9-]{1,70}$/.test(item?.id||'')||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>60)throw new Error('壁纸记录格式不正确');
    ids.add(item.id);
    if(item.id==='original'){
      if(item.kind!=='bundled')throw new Error('默认壁纸记录格式不正确');
    }else if(!['image','video'].includes(item.kind)||!/^wallpapers\/assets\/[a-z0-9-]+\.(?:jpg|png|webp|mp4|webm)$/.test(item.path||'')||
      ![undefined,'release'].includes(item.storage)||
      (item.storage==='release'&&item.kind!=='video')||
      !/^[0-9a-f]{64}$/.test(item.sha256||'')||!Number.isInteger(item.size)||item.size<100||
      item.size>(item.storage==='release'?MAX_RELEASE_WALLPAPER_BYTES:MAX_WALLPAPER_BYTES))throw new Error('壁纸文件信息不正确');
  }
  if(!ids.has('original')||!ids.has(value.activeId))throw new Error('壁纸选择无效');
  return value;
}

function rawUrl(item){
  if(item.storage==='release')return `https://github.com/${REGISTRY_REPO}/releases/download/${WALLPAPER_RELEASE_TAG}/${path.basename(item.path)}`;
  return `https://raw.githubusercontent.com/${REGISTRY_REPO}/${REGISTRY_BRANCH}/${item.path}?v=${item.sha256}`;
}

async function fetchManifest(fetcher=networkFetch){
  try{
    const base=`https://api.github.com/repos/${REGISTRY_REPO}/contents/${MANIFEST_PATH}?ref=${REGISTRY_BRANCH}&t=${Date.now()}`;
    const headers={'Accept':'application/vnd.github+json','User-Agent':'ImageWorkbench-Wallpaper/1','Cache-Control':'no-cache'};
    if(cachedEtag)headers['If-None-Match']=cachedEtag;
    const response=await fetcher(base,{headers,signal:AbortSignal.timeout(20000)});
    if(response.status===304&&cachedManifest)return cachedManifest;
    if(!response.ok)throw new Error(`读取壁纸配置失败（HTTP ${response.status}）`);
    const payload=await response.json();
    cachedManifest=validateManifest(JSON.parse(Buffer.from(payload.content.replace(/\s/g,''),'base64').toString('utf8')));
    cachedEtag=response.headers.get('etag')||'';
    return cachedManifest;
  }catch{
    if(cachedManifest)return cachedManifest;
    const raw=`https://raw.githubusercontent.com/${REGISTRY_REPO}/${REGISTRY_BRANCH}/${MANIFEST_PATH}?t=${Date.now()}`;
    const response=await fetcher(raw,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`读取壁纸配置失败（HTTP ${response.status}）`);
    cachedManifest=validateManifest(await response.json());
    return cachedManifest;
  }
}

async function downloadWallpaper(item,cacheDir,fetcher=networkFetch){
  if(item.kind==='bundled')return null;
  await fs.mkdir(cacheDir,{recursive:true});
  const name=`${item.sha256}${path.extname(item.path)}`;
  const output=path.join(cacheDir,name);
  try{const existing=await fs.readFile(output);if(existing.length===item.size&&sha256(existing)===item.sha256)return output;}catch{}
  const response=await fetcher(rawUrl(item),{signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error(`下载壁纸失败（HTTP ${response.status}）`);
  const chunks=[];let total=0;
  const limit=item.storage==='release'?MAX_RELEASE_WALLPAPER_BYTES:MAX_WALLPAPER_BYTES;
  for await(const chunk of response.body){total+=chunk.length;if(total>limit)throw new Error('壁纸文件过大');chunks.push(Buffer.from(chunk));}
  const data=Buffer.concat(chunks);
  if(data.length!==item.size||sha256(data)!==item.sha256)throw new Error('壁纸文件校验失败');
  const temp=`${output}.${process.pid}.tmp`;
  await fs.writeFile(temp,data);await fs.rename(temp,output);
  return output;
}

module.exports={MANIFEST_PATH,MAX_WALLPAPER_BYTES,MAX_RELEASE_WALLPAPER_BYTES,WALLPAPER_RELEASE_TAG,defaultManifest,validateManifest,rawUrl,fetchManifest,downloadWallpaper,sha256};
