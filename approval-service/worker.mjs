const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(message,status=400)=>json({error:message},status);
const now=()=>new Date().toISOString();
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
const usernameKey=value=>String(value||'').trim().normalize('NFKC').toLowerCase();
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromBase64url=value=>Uint8Array.from(atob(String(value).replace(/-/g,'+').replace(/_/g,'/')),char=>char.charCodeAt(0));
async function passwordKey(env){
  if(!env.ADMIN_TOKEN)throw new Error('管理员令牌未配置');
  const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`image-workbench-password-v1\0${env.ADMIN_TOKEN}`));
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
async function encryptPassword(password,env){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await passwordKey(env),new TextEncoder().encode(password));
  return {cipher:base64url(new Uint8Array(data)),iv:base64url(iv)};
}
async function decryptPassword(row,env){
  if(!row.password_cipher||!row.password_iv)return null;
  const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64url(row.password_iv)},await passwordKey(env),fromBase64url(row.password_cipher));
  return new TextDecoder().decode(data);
}
const machineCode=value=>{
  const compact=String(value||'').toUpperCase().replace(/[\s-]/g,'').replace(/O/g,'0').replace(/[IL]/g,'1');
  if(!/^DPM[0-9A-HJKMNP-TV-Z]{16}$/.test(compact))throw new Error('机器标识无效');
  return `DP-M-${compact.slice(3,7)}-${compact.slice(7,11)}-${compact.slice(11,15)}-${compact.slice(15,19)}`;
};
const codeVersion=value=>{
  const version=Number(value||1);
  if(version!==1&&version!==2)throw Object.assign(new Error('机器码版本无效'),{status:400});
  return version;
};
const publicStatus=row=>({id:row.id,status:row.status,name:row.name,expiresAt:row.expires_at,reason:row.rejection_reason||'',updatedAt:row.updated_at});
function matchesConstantTime(left,right){
  const a=String(left||''),b=String(right||'');let difference=a.length^b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++)difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return difference===0;
}
async function bodyJson(request){
  if(Number(request.headers.get('content-length')||0)>4096)throw new Error('请求内容过大');
  const text=await request.text();
  if(text.length>4096)throw new Error('请求内容过大');
  return JSON.parse(text);
}
async function expireOld(db){
  await db.prepare("UPDATE applications SET status='expired',updated_at=? WHERE status='approved' AND expires_at<=?").bind(now(),now()).run();
}
async function deviceCredentials(request){
  const deviceId=request.headers.get('x-device-id')||'';
  const secret=/^Device ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')||'')?.[1]||'';
  const code=machineCode(request.headers.get('x-machine-code'));
  const version=codeVersion(request.headers.get('x-machine-code-version'));
  if(!/^[0-9a-f-]{36}$/.test(deviceId)||!secret)throw new Error('设备身份无效');
  return {deviceId,secretHash:await digest(`image-workbench-device-v1\0${secret}`),machineHash:await digest(`image-workbench-machine-v1\0${code}`),code,version};
}
async function migrateMachineCode(row,credentials,db){
  const currentVersion=Number(row.machine_code_version||1);
  if(row.machine_hash===credentials.machineHash&&currentVersion===credentials.version)return row;
  if(credentials.version!==2)throw Object.assign(new Error('请将工作台更新到最新版后重试'),{status:409});
  try{
    await db.prepare('UPDATE applications SET machine_code=?,machine_hash=?,machine_code_version=2,updated_at=? WHERE id=? AND secret_hash=?')
      .bind(credentials.code,credentials.machineHash,now(),row.id,credentials.secretHash).run();
  }catch{throw Object.assign(new Error('新的硬件机器码与现有绑定冲突，请联系管理员'),{status:409});}
  return {...row,machine_code:credentials.code,machine_hash:credentials.machineHash,machine_code_version:2};
}
async function requireAdmin(request,env){
  const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')||'')?.[1]||'';
  if(!env.ADMIN_TOKEN||!matchesConstantTime(token,env.ADMIN_TOKEN))throw Object.assign(new Error('管理员令牌无效'),{status:401});
}
async function apply(request,env){
  const input=await bodyJson(request);
  const username=String(input.username||'').trim().normalize('NFKC');
  const password=String(input.password||'');
  if(username.length<2||username.length>32||!/^[\p{L}\p{N}_.-]+$/u.test(username))return fail('用户名需为 2–32 个字，可用文字、数字、点、下划线或短横线');
  if(password.length<8||password.length>128||/[\u0000-\u001f]/.test(password))return fail('密码需为 8–128 个字符');
  const code=machineCode(input.machineCode);
  const version=codeVersion(input.machineCodeVersion);
  const deviceId=String(input.deviceId||'');
  const secret=String(input.deviceSecret||'');
  if(!/^[0-9a-f-]{36}$/.test(deviceId)||!/^[A-Za-z0-9_-]{43}$/.test(secret))return fail('设备身份无效');
  const secretHash=await digest(`image-workbench-device-v1\0${secret}`);
  const machineHash=await digest(`image-workbench-machine-v1\0${code}`);
  const usernameHash=await digest(`image-workbench-username-v1\0${usernameKey(username)}`);
  await expireOld(env.DB);
  let latest=await env.DB.prepare('SELECT * FROM applications WHERE device_id=? ORDER BY created_at DESC LIMIT 1').bind(deviceId).first();
  if(latest&&!matchesConstantTime(latest.secret_hash,secretHash))return fail('设备身份与已有申请不符',403);
  if(latest)latest=await migrateMachineCode(latest,{code,machineHash:machineHash,version,secretHash},env.DB);
  if(latest&&['pending','approved'].includes(latest.status))return json(publicStatus(latest));
  const existing=await env.DB.prepare('SELECT password_cipher,password_iv FROM applications WHERE username_hash=? ORDER BY created_at DESC LIMIT 1').bind(usernameHash).first();
  if(existing){
    let matches=false;
    try{matches=matchesConstantTime(password,await decryptPassword(existing,env));}catch{}
    if(!matches)return fail('用户名已存在，密码不正确；请联系管理员处理',403);
  }
  const recent=await env.DB.prepare('SELECT COUNT(*) AS count FROM applications WHERE device_id=? AND created_at>=?').bind(deviceId,new Date(Date.now()-86400000).toISOString()).first();
  if(Number(recent?.count||0)>=5)return fail('今天申请次数已达上限，请明天再试',429);
  const timestamp=now(),id=crypto.randomUUID();
  const encrypted=await encryptPassword(password,env);
  await env.DB.prepare("INSERT INTO applications(id,name,phone,phone_hash,username,username_hash,password_cipher,password_iv,machine_code,machine_hash,machine_code_version,device_id,secret_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)")
    .bind(id,username,'',`username:${usernameHash}`,username,usernameHash,encrypted.cipher,encrypted.iv,code,machineHash,version,deviceId,secretHash,timestamp,timestamp).run();
  return json({id,status:'pending',name:username,expiresAt:null,reason:'',updatedAt:timestamp},201);
}
async function status(request,env){
  const credentials=await deviceCredentials(request);
  await expireOld(env.DB);
  let row=await env.DB.prepare('SELECT * FROM applications WHERE device_id=? ORDER BY created_at DESC LIMIT 1').bind(credentials.deviceId).first();
  if(!row)return json({status:'none'});
  if(!matchesConstantTime(row.secret_hash,credentials.secretHash))return fail('设备身份不匹配',403);
  row=await migrateMachineCode(row,credentials,env.DB);
  return json(publicStatus(row));
}
async function adminList(request,env){
  await expireOld(env.DB);
  const url=new URL(request.url);
  const offset=Math.max(0,Math.min(1000000,Number(url.searchParams.get('offset'))||0));
  const limit=Math.max(1,Math.min(200,Number(url.searchParams.get('limit'))||100));
  const rows=await env.DB.prepare('SELECT id,name,phone,username,username_hash,password_cipher,password_iv,machine_code AS machineCode,status,expires_at AS expiresAt,rejection_reason AS reason,created_at AS createdAt,updated_at AS updatedAt,decided_at AS decidedAt FROM applications ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(limit,offset).all();
  const count=await env.DB.prepare('SELECT COUNT(*) AS count FROM applications').first();
  const items=await Promise.all((rows.results||[]).map(async row=>({
    id:row.id,name:row.name,phone:row.username?undefined:row.phone,username:row.username||null,
    password:row.username?await decryptPassword(row,env):null,machineCode:row.machineCode,
    status:row.status,expiresAt:row.expiresAt,reason:row.reason,createdAt:row.createdAt,updatedAt:row.updatedAt,decidedAt:row.decidedAt
  })));
  return json({items,total:Number(count?.count||0),offset,limit});
}
async function adminAction(request,env,id,action){
  const input=action==='delete'?{}:await bodyJson(request);
  await expireOld(env.DB);
  const row=await env.DB.prepare('SELECT * FROM applications WHERE id=?').bind(id).first();
  if(!row)return fail('申请不存在',404);
  const timestamp=now();
  if(action==='approve'){
    if(row.status!=='pending')return fail('仅待审批申请可以批准',409);
    const expiresAt=String(input.expiresAt||'');
    const expiry=Date.parse(expiresAt);
    if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+10*366*86400000)return fail('有效期应为未来十年内的时间');
    try{await env.DB.prepare("UPDATE applications SET status='approved',expires_at=?,rejection_reason=NULL,updated_at=?,decided_at=? WHERE id=? AND status='pending'").bind(new Date(expiry).toISOString(),timestamp,timestamp,id).run();}
    catch{return fail('此用户名或机器已有有效绑定，请先解绑或换绑',409);}
  }else if(action==='reject'){
    if(row.status!=='pending')return fail('仅待审批申请可以驳回',409);
    const reason=String(input.reason||'申请未通过').trim().slice(0,120);
    await env.DB.prepare("UPDATE applications SET status='rejected',rejection_reason=?,updated_at=?,decided_at=? WHERE id=? AND status='pending'").bind(reason,timestamp,timestamp,id).run();
  }else if(action==='unbind'){
    if(row.status!=='approved')return fail('此用户当前没有有效绑定',409);
    await env.DB.prepare("UPDATE applications SET status='unbound',updated_at=?,decided_at=? WHERE id=? AND status='approved'").bind(timestamp,timestamp,id).run();
  }else if(action==='expiry'){
    if(row.status!=='approved')return fail('仅有效绑定可以修改期限',409);
    const expiry=Date.parse(String(input.expiresAt||''));
    if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+10*366*86400000)return fail('有效期应为未来十年内的时间');
    await env.DB.prepare("UPDATE applications SET expires_at=?,updated_at=? WHERE id=? AND status='approved'").bind(new Date(expiry).toISOString(),timestamp,id).run();
  }else if(action==='rename'){
    const name=String(input.name||'').trim();
    if(name.length<2||name.length>40||/[\u0000-\u001f]/.test(name))return fail('名称需为 2–40 个字符');
    await env.DB.prepare('UPDATE applications SET name=?,updated_at=? WHERE id=?').bind(name,timestamp,id).run();
  }else if(action==='rebind'){
    if(row.status!=='approved')return fail('仅有效绑定可以换绑',409);
    const target=await env.DB.prepare('SELECT * FROM applications WHERE id=?').bind(String(input.targetId||'')).first();
    if(!target||target.status!=='pending')return fail('新机器需先提交待审批申请',409);
    if(row.username_hash?target.username_hash!==row.username_hash:target.phone_hash!==row.phone_hash)return fail('新机器申请必须使用原用户名和密码',409);
    const occupied=await env.DB.prepare("SELECT id FROM applications WHERE machine_hash=? AND status='approved'").bind(target.machine_hash).first();
    if(occupied)return fail('新机器已有有效绑定',409);
    await env.DB.batch([
      env.DB.prepare("UPDATE applications SET status='unbound',updated_at=?,decided_at=? WHERE id=? AND status='approved'").bind(timestamp,timestamp,id),
      env.DB.prepare("UPDATE applications SET status='approved',expires_at=?,rejection_reason=NULL,updated_at=?,decided_at=? WHERE id=? AND status='pending'").bind(row.expires_at,timestamp,timestamp,target.id)
    ]);
  }else if(action==='delete'){
    await env.DB.prepare('DELETE FROM applications WHERE id=?').bind(id).run();
  }else return fail('操作不存在',404);
  return json({ok:true});
}
export default {async fetch(request,env){
  try{
    const url=new URL(request.url);
    if(url.pathname==='/v1/health'&&request.method==='GET')return json({ok:true,version:1});
    if(url.pathname==='/v1/applications'&&request.method==='POST')return apply(request,env);
    if(url.pathname==='/v1/status'&&request.method==='GET')return status(request,env);
    if(url.pathname.startsWith('/v1/admin/')){
      await requireAdmin(request,env);
      if(url.pathname==='/v1/admin/applications'&&request.method==='GET')return adminList(request,env);
      const match=/^\/v1\/admin\/applications\/([0-9a-f-]{36})\/(approve|reject|unbind|rebind|expiry|rename|delete)$/.exec(url.pathname);
      if(match&&request.method==='POST')return adminAction(request,env,match[1],match[2]);
    }
    return fail('接口不存在',404);
  }catch(error){
    const status=error.status||(/JSON|机器标识|请求内容/.test(error.message)?400:500);
    return fail(status===500?'服务暂时不可用':error.message,status);
  }
}};
