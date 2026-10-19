const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { networkFetch } = require('./network.cjs');

const execFileAsync = promisify(execFile);
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const REGISTRY_REPO = 'guanchenli79-bit/image-workbench';
const REGISTRY_BRANCH = 'license-registry';
const REGISTRY_PATH = 'licenses/registry.json';

function encodeBase32(bytes, length) {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex')}`);
  let result = '';
  for (let i = 0; i < length; i++) {
    result = ALPHABET[Number(value & 31n)] + result;
    value >>= 5n;
  }
  return result;
}

function normalizeMachineCode(value) {
  const compact = String(value || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^DPM[0-9A-HJKMNP-TV-Z]{16}$/.test(compact)) throw new Error('机器码格式不正确，请完整复制工作台显示的机器码');
  return `DP-M-${compact.slice(3,7)}-${compact.slice(7,11)}-${compact.slice(11,15)}-${compact.slice(15,19)}`;
}

function normalizeLicenseKey(value) {
  const compact = String(value || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^DP[0-9A-HJKMNP-TV-Z]{12}$/.test(compact)) throw new Error('卡密格式应为 DP-XXXX-XXXX-XXXX');
  return `DP-${compact.slice(2,6)}-${compact.slice(6,10)}-${compact.slice(10,14)}`;
}

function machineCodeFromGuid(guid) {
  const value = String(guid || '').trim().toLowerCase();
  if (!/^[0-9a-f-]{20,}$/.test(value)) throw new Error('无法读取有效的 Windows 机器标识');
  const digest = crypto.createHash('sha256').update(`image-workbench-machine-v1\0${value}`).digest();
  const code = encodeBase32(digest.subarray(0,10),16);
  return `DP-M-${code.slice(0,4)}-${code.slice(4,8)}-${code.slice(8,12)}-${code.slice(12,16)}`;
}

function machineCodeFromHardware(guid, hardware) {
  const windowsGuid=String(guid||'').trim().toLowerCase();
  if(!/^[0-9a-f-]{20,}$/.test(windowsGuid))throw new Error('无法读取有效的 Windows 机器标识');
  const uuid=String(hardware?.uuid||'').trim().toUpperCase();
  const validUuid=/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/.test(uuid) &&
    !/^([0-9A-F])\1{31}$/.test(uuid.replace(/-/g,''));
  const usableSerial=value=>{
    const serial=String(value||'').trim().toUpperCase();
    const compact=serial.replace(/[^A-Z0-9]/g,'');
    return compact.length>=5 && compact.length<=64 && !/^(?:0+|1+|F+|UNKNOWN|NONE|DEFAULT|TOBEFILLEDBYOEM|SYSTEMSERIALNUMBER|NOTSPECIFIED)$/.test(compact)?compact:null;
  };
  const kind=validUuid?'uuid':usableSerial(hardware?.biosSerial)?'bios':usableSerial(hardware?.diskSerial)?'disk':null;
  const identifier=kind==='uuid'?uuid:kind==='bios'?usableSerial(hardware.biosSerial):kind==='disk'?usableSerial(hardware.diskSerial):null;
  if(!identifier)throw new Error('无法读取这台电脑的独立硬件标识，请联系管理员；机器码不会退回可能重复的旧算法');
  const digest=crypto.createHash('sha256').update(`image-workbench-machine-v2\0${windowsGuid}\0${kind}\0${identifier}`).digest();
  const code=encodeBase32(digest.subarray(0,10),16);
  return `DP-M-${code.slice(0,4)}-${code.slice(4,8)}-${code.slice(8,12)}-${code.slice(12,16)}`;
}

async function currentMachineCode() {
  if (process.platform !== 'win32') throw new Error('机器授权目前仅支持 Windows');
  const hardwareScript="$p=Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue; $b=Get-CimInstance Win32_BIOS -ErrorAction SilentlyContinue; $d=Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue | Select-Object -First 1; @{uuid=[string]$p.UUID;biosSerial=[string]$b.SerialNumber;diskSerial=[string]$d.SerialNumber} | ConvertTo-Json -Compress";
  const [{stdout},{stdout:hardwareJson}]=await Promise.all([
    execFileAsync('reg.exe',['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid','/reg:64'],{windowsHide:true,timeout:10000}),
    execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',hardwareScript],{windowsHide:true,timeout:20000})
  ]);
  const guid = /MachineGuid\s+REG_SZ\s+([0-9a-f-]+)/i.exec(stdout)?.[1];
  if (!guid) throw new Error('读取 Windows 机器码失败，请以正常用户权限重试');
  let hardware;
  try{hardware=JSON.parse(hardwareJson);}catch{throw new Error('读取电脑硬件标识失败，请联系管理员');}
  return machineCodeFromHardware(guid,hardware);
}

function createLicenseKey() {
  const code = encodeBase32(crypto.randomBytes(8),12);
  return `DP-${code.slice(0,4)}-${code.slice(4,8)}-${code.slice(8,12)}`;
}

function hashCode(kind, code) {
  const normalized = kind === 'machine' ? normalizeMachineCode(code) : normalizeLicenseKey(code);
  return crypto.createHash('sha256').update(`image-workbench-${kind}-v1\0${normalized}`).digest('hex');
}

function expiryForDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new Error('请选择有效期截止日期');
  const time = Date.parse(`${date}T23:59:59+08:00`);
  if (!Number.isFinite(time) || new Date(time+8*60*60*1000).toISOString().slice(0,10)!==date || time <= Date.now()) throw new Error('有效期必须晚于今天');
  if (time > Date.now() + 10 * 366 * 86400000) throw new Error('有效期最多设置十年');
  return new Date(time).toISOString();
}

function validateRegistry(value) {
  if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 100000) throw new Error('授权数据格式不正确');
  for (const entry of value.entries) {
    if (!/^[0-9a-f]{64}$/.test(entry?.machineHash || '') || !/^[0-9a-f]{64}$/.test(entry?.keyHash || '') || !Number.isFinite(Date.parse(entry?.expiresAt))) {
      throw new Error('授权记录格式不正确');
    }
  }
  return value;
}

function findLicense(registry, machineCode, licenseKey, now = Date.now()) {
  const machineHash = hashCode('machine',machineCode);
  const keyHash = hashCode('license',licenseKey);
  return validateRegistry(registry).entries.find(entry => entry.machineHash === machineHash && entry.keyHash === keyHash && Date.parse(entry.expiresAt) > now) || null;
}

async function fetchRegistry(fetcher = networkFetch, {preferApi=false} = {}) {
  const raw = `https://raw.githubusercontent.com/${REGISTRY_REPO}/${REGISTRY_BRANCH}/${REGISTRY_PATH}?t=${Date.now()}`;
  const fromRaw = async()=>{
    const response = await fetcher(raw,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return validateRegistry(await response.json());
  };
  const fromApi = async()=>{
    const api = `https://api.github.com/repos/${REGISTRY_REPO}/contents/${REGISTRY_PATH}?ref=${REGISTRY_BRANCH}&t=${Date.now()}`;
    const response = await fetcher(api,{headers:{'Accept':'application/vnd.github+json','User-Agent':'ImageWorkbench-License/1','Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    return validateRegistry(JSON.parse(Buffer.from(payload.content.replace(/\s/g,''),'base64').toString('utf8')));
  };
  try {
    return await (preferApi?fromApi:fromRaw)();
  } catch {
    try { return await (preferApi?fromRaw:fromApi)(); }
    catch (error) { throw new Error('无法连接授权服务，请检查网络或代理设置后重试',{cause:error}); }
  }
}

module.exports = { REGISTRY_REPO, REGISTRY_BRANCH, REGISTRY_PATH, normalizeMachineCode, normalizeLicenseKey,
  machineCodeFromGuid, machineCodeFromHardware, currentMachineCode, createLicenseKey, hashCode, expiryForDate, validateRegistry, findLicense, fetchRegistry };
