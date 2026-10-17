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

function publicEntries(registry) {
  return validateRegistry(registry).entries.map(entry=>({machineHash:entry.machineHash,issuedAt:entry.issuedAt,expiresAt:entry.expiresAt}));
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

async function listLicenses() {
  const {registry} = await readRegistry();
  return publicEntries(registry);
}

async function issueLicense(machineCode,date) {
  const {sha,registry} = await readRegistry();
  let issued;
  do { issued=issueInRegistry(registry,machineCode,date); }
  while(registry.entries.some(entry=>entry.keyHash===hashCode('license',issued.key)));
  await writeRegistry(issued.registry,sha,`Issue license for ${issued.machineCode}`);
  return {key:issued.key,machineCode:issued.machineCode,expiresAt:issued.expiresAt,entries:publicEntries(issued.registry)};
}

async function unbindLicense(machineHash) {
  const {sha,registry} = await readRegistry();
  const updated = unbindInRegistry(registry,machineHash);
  await writeRegistry(updated,sha,`Unbind license ${machineHash.slice(0,12)}`);
  return publicEntries(updated);
}

module.exports = { readRegistry, listLicenses, issueLicense, unbindLicense, issueInRegistry, unbindInRegistry };
