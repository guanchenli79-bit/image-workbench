const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { REGISTRY_REPO, REGISTRY_BRANCH, REGISTRY_PATH, normalizeMachineCode, createLicenseKey,
  hashCode, expiryForDate, validateRegistry } = require('./license.cjs');

const execFileAsync = promisify(execFile);
const route = `repos/${REGISTRY_REPO}/contents/${REGISTRY_PATH}`;

async function gh(args) {
  try {
    const {stdout} = await execFileAsync('gh.exe',args,{windowsHide:true,timeout:45000,maxBuffer:4*1024*1024});
    return JSON.parse(stdout);
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim();
    throw new Error(`连接 GitHub 管理仓库失败。请确认本机已安装 gh 并登录仓库所有者账号。${detail ? ` ${detail.slice(0,240)}` : ''}`);
  }
}

async function readRegistry() {
  const file = await gh(['api',`${route}?ref=${REGISTRY_BRANCH}`]);
  if (!file.sha || !file.content) throw new Error('GitHub 授权库文件不完整');
  const registry = validateRegistry(JSON.parse(Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8')));
  return {sha:file.sha,registry};
}

async function writeRegistry(registry,sha,message) {
  validateRegistry(registry);
  const content = Buffer.from(`${JSON.stringify(registry,null,2)}\n`,'utf8').toString('base64');
  return gh(['api','-X','PUT',route,'-f',`message=${message}`,'-f',`content=${content}`,'-f',`sha=${sha}`,'-f',`branch=${REGISTRY_BRANCH}`]);
}

function publicEntries(registry,vault) {
  const notes=vault.snapshot().notes;
  return validateRegistry(registry).entries.map(entry=>({machineHash:entry.machineHash,issuedAt:entry.issuedAt,expiresAt:entry.expiresAt,name:notes[entry.machineHash]||''}));
}

function localHistory(vault,registry) {
  const active=new Map(validateRegistry(registry).entries.map(entry=>[entry.machineHash,entry.keyHash]));
  return vault.snapshot().history.map(item=>({
    ...item,
    status:active.get(item.machineHash)===hashCode('license',item.key) ? (Date.parse(item.expiresAt)>Date.now()?'有效':'已到期') : '已失效'
  }));
}

function view(registry,vault) {
  const active=new Map(validateRegistry(registry).entries.map(entry=>[entry.keyHash,entry.machineHash]));
  const local=vault.snapshot();
  const bindings=local.bindings.map(item=>({
    ...item,
    status:active.get(hashCode('license',item.key))===item.machineHash ?
      (Date.parse(item.expiresAt)>Date.now()?'有效':'已到期'):'已解绑'
  }));
  return {entries:publicEntries(registry,vault),history:localHistory(vault,registry),bindings};
}

function issueInRegistry(registry,machineCode,date,key = createLicenseKey(),now = new Date()) {
  const normalized = normalizeMachineCode(machineCode);
  const machineHash = hashCode('machine',normalized);
  const keyHash = hashCode('license',key);
  const expiresAt = expiryForDate(date);
  const entries = registry.entries.filter(entry=>entry.machineHash !== machineHash);
  entries.unshift({machineHash,keyHash,issuedAt:now.toISOString(),expiresAt});
  return {registry:{version:1,entries},key,machineCode:normalized,expiresAt};
}

function unbindInRegistry(registry,machineHash) {
  if (!/^[0-9a-f]{64}$/.test(String(machineHash))) throw new Error('请选择有效的机器记录');
  const entries = registry.entries.filter(entry=>entry.machineHash !== machineHash);
  if (entries.length === registry.entries.length) throw new Error('该机器当前没有授权记录');
  return {version:1,entries};
}

async function listLicenses(vault) {
  const {registry} = await readRegistry();
  return view(registry,vault);
}

async function issueLicense(machineCode,date,name,vault) {
  vault.requireUnlocked();
  const normalizedName=normalizeName(name);
  const {sha,registry} = await readRegistry();
  let issued;
  do { issued=issueInRegistry(registry,machineCode,date); }
  while(registry.entries.some(entry=>entry.keyHash===hashCode('license',issued.key)));
  await writeRegistry(issued.registry,sha,`Issue license for ${issued.machineCode}`);
  let warning='';
  try {
    vault.update(data=>{
      const machineHash=hashCode('machine',issued.machineCode);
      const finalName=normalizedName || data.notes[machineHash] || '';
      if(finalName)data.notes[machineHash]=finalName;
      const record={key:issued.key,machineCode:issued.machineCode,machineHash,name:finalName,issuedAt:issued.registry.entries[0].issuedAt,expiresAt:issued.expiresAt};
      data.history.unshift(record);
      data.bindings.unshift({...record});
    });
  } catch(error) { warning=`卡密已同步到授权库，但本地历史保存失败：${error.message}。请现在复制卡密。`; }
  return {key:issued.key,machineCode:issued.machineCode,expiresAt:issued.expiresAt,...view(issued.registry,vault),warning};
}

async function unbindLicense(machineHash,vault) {
  vault.requireUnlocked();
  const {sha,registry} = await readRegistry();
  const updated = unbindInRegistry(registry,machineHash);
  await writeRegistry(updated,sha,`Unbind license ${machineHash.slice(0,12)}`);
  return view(updated,vault);
}

function normalizeName(value) {
  const name=String(value||'').trim();
  if(name.length>40 || /[\r\n\u0000-\u001f]/.test(name)) throw new Error('备注名称最多 40 个字符，不能包含换行');
  return name;
}

function renameLicense(machineHash,name,vault) {
  vault.requireUnlocked();
  if(!/^[0-9a-f]{64}$/.test(String(machineHash))) throw new Error('机器记录无效');
  const normalizedName=normalizeName(name);
  vault.update(data=>{
    if(normalizedName)data.notes[machineHash]=normalizedName;
    else delete data.notes[machineHash];
    for(const item of data.history)if(item.machineHash===machineHash)item.name=normalizedName;
    for(const item of data.bindings)if(item.machineHash===machineHash)item.name=normalizedName;
  });
  return normalizedName;
}

function rebindInRegistry(registry,keyHash,newMachineCode,expiresAt) {
  validateRegistry(registry);
  const machineCode=normalizeMachineCode(newMachineCode);
  const machineHash=hashCode('machine',machineCode);
  if(registry.entries.some(entry=>entry.machineHash===machineHash && entry.keyHash!==keyHash))throw new Error('新机器已有其他有效卡密，请先解绑该机器');
  const existing=registry.entries.find(entry=>entry.keyHash===keyHash);
  const entries=registry.entries.filter(entry=>entry.keyHash!==keyHash);
  return {version:1,entries:[{machineHash,keyHash,issuedAt:existing?.issuedAt||new Date().toISOString(),expiresAt:existing?.expiresAt||expiresAt},...entries]};
}

async function rebindLicense(key,newMachineCode,vault) {
  vault.requireUnlocked();
  const normalized=normalizeMachineCode(newMachineCode);
  const local=vault.snapshot();
  const item=local.bindings.find(entry=>entry.key===key);
  if(!item)throw new Error('本机没有这张卡密的绑定记录');
  if(Date.parse(item.expiresAt)<=Date.now())throw new Error('卡密已到期，请重新签发');
  const {sha,registry}=await readRegistry();
  const keyHash=hashCode('license',key);
  const updated=rebindInRegistry(registry,keyHash,normalized,item.expiresAt);
  await writeRegistry(updated,sha,`Rebind license ${keyHash.slice(0,12)}`);
  vault.update(data=>{
    const record=data.bindings.find(entry=>entry.key===key);
    record.machineCode=normalized;
    record.machineHash=hashCode('machine',normalized);
    record.name=record.name||data.notes[record.machineHash]||'';
    if(record.name)data.notes[record.machineHash]=record.name;
  });
  return view(updated,vault);
}

async function deleteBinding(key,vault) {
  vault.requireUnlocked();
  if(!vault.snapshot().bindings.some(item=>item.key===key))throw new Error('绑定记录不存在');
  const {sha,registry}=await readRegistry();
  const keyHash=hashCode('license',key);
  const updated={version:1,entries:registry.entries.filter(entry=>entry.keyHash!==keyHash)};
  if(updated.entries.length!==registry.entries.length)await writeRegistry(updated,sha,`Delete license ${keyHash.slice(0,12)}`);
  vault.update(data=>{
    data.bindings=data.bindings.filter(item=>item.key!==key);
    data.history=data.history.filter(item=>item.key!==key);
  });
  return view(updated,vault);
}

module.exports = { readRegistry, listLicenses, issueLicense, unbindLicense, renameLicense, rebindLicense, deleteBinding,
  issueInRegistry, unbindInRegistry, rebindInRegistry, normalizeName, view };
