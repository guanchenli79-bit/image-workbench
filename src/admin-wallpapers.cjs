const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {REGISTRY_REPO,REGISTRY_BRANCH}=require('./license.cjs');
const {MANIFEST_PATH,MAX_WALLPAPER_BYTES,MAX_RELEASE_WALLPAPER_BYTES,WALLPAPER_RELEASE_TAG,validateManifest,sha256}=require('./wallpapers.cjs');

const execFileAsync=promisify(execFile);
const route=file=>`repos/${REGISTRY_REPO}/contents/${file}`;
async function gh(args){
  try{const {stdout}=await execFileAsync('gh.exe',args,{windowsHide:true,timeout:180000,maxBuffer:8*1024*1024});return JSON.parse(stdout);}
  catch(error){throw new Error(`同步壁纸库失败，请检查 gh 登录及网络：${String(error.stderr||error.message).slice(0,240)}`);}
}
async function readManifest(){
  const file=await gh(['api',`${route(MANIFEST_PATH)}?ref=${REGISTRY_BRANCH}`]);
  const manifest=validateManifest(JSON.parse(Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8')));
  return {sha:file.sha,manifest};
}
async function putJson(file,content,sha,message){
  const args=['api','-X','PUT',route(file),'-f',`message=${message}`,'-f',`content=${Buffer.from(content).toString('base64')}`,'-f',`branch=${REGISTRY_BRANCH}`];
  if(sha)args.push('-f',`sha=${sha}`);
  return gh(args);
}
async function writeManifest(manifest,sha,message){
  validateManifest(manifest);
  return putJson(MANIFEST_PATH,`${JSON.stringify(manifest,null,2)}\n`,sha,message);
}
async function uploadAsset(file,data){
  const input=path.join(os.tmpdir(),`image-workbench-wallpaper-${crypto.randomUUID()}.json`);
  try{
    await fs.writeFile(input,JSON.stringify({message:`Add wallpaper ${path.basename(file)}`,content:data.toString('base64'),branch:REGISTRY_BRANCH}),{mode:0o600});
    return await gh(['api','-X','PUT',route(file),'--input',input]);
  }finally{await fs.rm(input,{force:true}).catch(()=>{});}
}
async function deleteAsset(file){
  const existing=await gh(['api',`${route(file)}?ref=${REGISTRY_BRANCH}`]);
  return gh(['api','-X','DELETE',route(file),'-f',`message=Delete wallpaper ${path.basename(file)}`,'-f',`sha=${existing.sha}`,'-f',`branch=${REGISTRY_BRANCH}`]);
}
async function ensureRelease(){
  try{await execFileAsync('gh.exe',['release','view',WALLPAPER_RELEASE_TAG,'--repo',REGISTRY_REPO],{windowsHide:true,timeout:30000});}
  catch{
    await execFileAsync('gh.exe',['release','create',WALLPAPER_RELEASE_TAG,'--repo',REGISTRY_REPO,'--title','画境远程壁纸素材库','--notes','用户端动态壁纸素材。此预发布版本不参与工作台自动更新。','--prerelease'],{windowsHide:true,timeout:60000});
  }
}
async function uploadReleaseAsset(file,assetName){
  await ensureRelease();
  const tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'image-workbench-release-'));
  const temp=path.join(tempDir,assetName);
  try{
    await fs.copyFile(file,temp);
    await execFileAsync('gh.exe',['release','upload',WALLPAPER_RELEASE_TAG,temp,'--repo',REGISTRY_REPO],{windowsHide:true,timeout:600000,maxBuffer:1024*1024});
  }finally{await fs.rm(tempDir,{recursive:true,force:true}).catch(()=>{});}
}
async function deleteReleaseAsset(assetName){
  await execFileAsync('gh.exe',['release','delete-asset',WALLPAPER_RELEASE_TAG,assetName,'--yes','--repo',REGISTRY_REPO],{windowsHide:true,timeout:60000});
}
function detectKind(file,data){
  const ext=path.extname(file).toLowerCase();
  const jpeg=data[0]===0xff&&data[1]===0xd8;
  const png=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const webp=data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
  const mp4=data.toString('ascii',4,8)==='ftyp';
  const webm=data.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))&&data.includes(Buffer.from('webm'));
  if(ext==='.jpg'||ext==='.jpeg'){if(jpeg)return {kind:'image',ext:'jpg'};}
  if(ext==='.png'&&png)return {kind:'image',ext:'png'};
  if(ext==='.webp'&&webp)return {kind:'image',ext:'webp'};
  if(ext==='.mp4'&&mp4)return {kind:'video',ext:'mp4'};
  if(ext==='.webm'&&webm)return {kind:'video',ext:'webm'};
  throw new Error('仅支持有效的 JPG、PNG、WEBP、MP4 或 WEBM 文件');
}
async function addWallpaper(file,name){
  const stat=await fs.stat(file);
  if(stat.size<100||stat.size>MAX_RELEASE_WALLPAPER_BYTES)throw new Error('壁纸文件需小于 100 MB');
  const data=await fs.readFile(file);
  const {kind,ext}=detectKind(file,data);
  if(kind==='image'&&data.length>MAX_WALLPAPER_BYTES)throw new Error('图片壁纸需小于 25 MB');
  const {sha,manifest}=await readManifest();
  const id=`wall-${crypto.randomUUID()}`;
  const item={id,name:String(name||path.basename(file)).trim().slice(0,60),kind,path:`wallpapers/assets/${id}.${ext}`,sha256:sha256(data),size:data.length};
  if(data.length>MAX_WALLPAPER_BYTES){item.storage='release';await uploadReleaseAsset(file,path.basename(item.path));}
  else await uploadAsset(item.path,data);
  manifest.items.push(item);
  await writeManifest(manifest,sha,`Register wallpaper ${id}`);
  return manifest;
}
async function addRecordedWallpaper(bytes,name){
  const data=Buffer.from(bytes);
  if(data.length<100||data.length>MAX_WALLPAPER_BYTES)throw new Error('录制视频需小于 25 MB');
  detectKind('recording.webm',data);
  const {sha,manifest}=await readManifest();
  const id=`wall-${crypto.randomUUID()}`;
  const item={id,name:String(name||'Wallpaper Engine 动态场景').trim().slice(0,60),kind:'video',path:`wallpapers/assets/${id}.webm`,sha256:sha256(data),size:data.length};
  await uploadAsset(item.path,data);
  manifest.items.push(item);
  await writeManifest(manifest,sha,`Register wallpaper ${id}`);
  return manifest;
}
async function selectWallpaper(id){
  const {sha,manifest}=await readManifest();
  if(!manifest.items.some(item=>item.id===id))throw new Error('壁纸不存在，请刷新列表');
  manifest.activeId=id;
  await writeManifest(manifest,sha,`Select wallpaper ${id}`);
  return manifest;
}
async function removeWallpaper(id){
  if(id==='original')throw new Error('默认壁纸不能删除');
  const {sha,manifest}=await readManifest();
  const item=manifest.items.find(value=>value.id===id);
  if(!item)throw new Error('壁纸不存在，请刷新列表');
  manifest.items=manifest.items.filter(value=>value.id!==id);
  if(manifest.activeId===id)manifest.activeId='original';
  await writeManifest(manifest,sha,`Remove wallpaper ${id}`);
  if(item.storage==='release')await deleteReleaseAsset(path.basename(item.path));
  else await deleteAsset(item.path);
  return manifest;
}

module.exports={readManifest,addWallpaper,addRecordedWallpaper,selectWallpaper,removeWallpaper,detectKind};
