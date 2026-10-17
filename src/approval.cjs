const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {networkFetch} = require('./network.cjs');

const SERVICE_URL = 'https://image-workbench-approvals.bbyka.workers.dev';
const randomSecret = () => crypto.randomBytes(32).toString('base64url');

async function request(route,{method='GET',body,headers={}}={}) {
  const response=await networkFetch(`${SERVICE_URL}${route}`,{method,headers:{...headers,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||`审批服务返回 HTTP ${response.status}`);
  return result;
}

async function loadIdentity(app,safeStorage) {
  const dir=path.join(app.getPath('appData'),'画境工作台设备身份');
  const file=path.join(dir,'identity.json');
  try {
    const saved=JSON.parse(await fs.readFile(file,'utf8'));
    const secret=safeStorage.decryptString(Buffer.from(saved.encryptedSecret,'base64'));
    if(/^[0-9a-f-]{36}$/.test(saved.deviceId)&&/^[A-Za-z0-9_-]{43}$/.test(secret))return {deviceId:saved.deviceId,deviceSecret:secret};
  } catch {}
  if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 安全存储不可用，无法保存设备身份');
  const identity={deviceId:crypto.randomUUID(),deviceSecret:randomSecret()};
  await fs.mkdir(dir,{recursive:true});
  const temp=`${file}.${process.pid}.tmp`;
  await fs.writeFile(temp,JSON.stringify({deviceId:identity.deviceId,encryptedSecret:safeStorage.encryptString(identity.deviceSecret).toString('base64')}),{flag:'wx'});
  await fs.rename(temp,file);
  return identity;
}

function clientHeaders(identity,machineCode){return {'x-device-id':identity.deviceId,'x-machine-code':machineCode,authorization:`Device ${identity.deviceSecret}`};}
function submitApplication(identity,machineCode,name,phone){return request('/v1/applications',{method:'POST',body:{...identity,machineCode,name,phone}});}
function getApplication(identity,machineCode){return request('/v1/status',{headers:clientHeaders(identity,machineCode)});}
function adminList(token,offset=0,limit=200){return request(`/v1/admin/applications?offset=${offset}&limit=${limit}`,{headers:{authorization:`Bearer ${token}`}});}
function adminAction(token,id,action,body={}){return request(`/v1/admin/applications/${id}/${action}`,{method:'POST',body,headers:{authorization:`Bearer ${token}`}});}
module.exports={SERVICE_URL,loadIdentity,submitApplication,getApplication,adminList,adminAction};
