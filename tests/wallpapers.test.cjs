const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {defaultManifest,validateManifest,rawUrl,fetchManifest,downloadWallpaper,sha256}=require('../src/wallpapers.cjs');
const {detectKind}=require('../src/admin-wallpapers.cjs');

test('远程壁纸目录只接受本仓库的合法媒体路径',()=>{
  const manifest=defaultManifest();
  assert.equal(validateManifest(manifest).activeId,'original');
  const data=Buffer.from([255,216,255,...new Array(120).fill(1)]);
  const item={id:'wall-test',name:'测试壁纸',kind:'image',path:'wallpapers/assets/wall-test.jpg',sha256:sha256(data),size:data.length};
  manifest.items.push(item);manifest.activeId=item.id;
  assert.equal(validateManifest(manifest).items.length,2);
  assert.equal(detectKind('test.jpg',data).kind,'image');
  assert.throws(()=>validateManifest({...manifest,items:[manifest.items[0],{...item,path:'../../outside.jpg'}]}),/壁纸文件/);
});

test('动态录制文件和大视频素材使用受限的远程路径',()=>{
  const data=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.from('webm'),Buffer.alloc(128)]);
  assert.equal(detectKind('scene.webm',data).kind,'video');
  const item={id:'wall-large',name:'动态场景',kind:'video',path:'wallpapers/assets/wall-large.webm',storage:'release',sha256:sha256(data),size:data.length};
  assert.equal(validateManifest({version:1,activeId:item.id,items:[defaultManifest().items[0],item]}).activeId,item.id);
  assert.match(rawUrl(item),/\/releases\/download\/wallpaper-library\/wall-large\.webm$/);
  assert.throws(()=>validateManifest({version:1,activeId:item.id,items:[defaultManifest().items[0],{...item,path:'https://example.com/x.webm'}]}),/壁纸文件/);
  assert.throws(()=>validateManifest({version:1,activeId:item.id,items:[defaultManifest().items[0],{...item,storage:'other'}]}),/壁纸文件/);
});

test('动态 GIF 可上传并作为远程页面主题',()=>{
  const data=Buffer.concat([Buffer.from('GIF89a','ascii'),Buffer.alloc(128)]);
  assert.deepEqual(detectKind('motion.gif',data),{kind:'image',ext:'gif'});
  assert.throws(()=>detectKind('motion.gif',Buffer.from('not a gif')),/仅支持有效/);
  const item={id:'wall-gif',name:'动态图片',kind:'image',path:'wallpapers/assets/wall-gif.gif',sha256:sha256(data),size:data.length};
  assert.equal(validateManifest({version:1,activeId:item.id,items:[defaultManifest().items[0],item]}).activeId,item.id);
});

test('用户端读取当前壁纸并校验下载文件，缓存可离线使用',async()=>{
  const bytes=Buffer.from([255,216,255,...new Array(120).fill(1)]);
  const item={id:'wall-test',name:'测试壁纸',kind:'image',path:'wallpapers/assets/wall-test.jpg',sha256:sha256(bytes),size:bytes.length};
  const manifest={version:1,activeId:item.id,items:[defaultManifest().items[0],item]};
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'wallpaper-test-'));
  try{
    const remote=async url=>String(url).includes('/contents/')?
      new Response(JSON.stringify({content:Buffer.from(JSON.stringify(manifest)).toString('base64')})):
      new Response(bytes);
    const parsed=await fetchManifest(remote);
    assert.equal(parsed.activeId,item.id);
    assert.equal((await fetchManifest(async()=>new Response(null,{status:304}))).activeId,item.id);
    const output=await downloadWallpaper(item,folder,remote);
    assert.deepEqual(await fs.readFile(output),bytes);
    const offline=()=>{throw new Error('offline')};
    assert.equal(await downloadWallpaper(item,folder,offline),output);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
