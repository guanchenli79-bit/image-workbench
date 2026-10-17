const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const fail=(message,status=400)=>json({error:message},status);
const now=()=>new Date().toISOString();
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
const machineCode=value=>{
  const compact=String(value||'').toUpperCase().replace(/[\s-]/g,'').replace(/O/g,'0').replace(/[IL]/g,'1');
  if(!/^DPM[0-9A-HJKMNP-TV-Z]{16}$/.test(compact))throw new Error('??????');
  return `DP-M-${compact.slice(3,7)}-${compact.slice(7,11)}-${compact.slice(11,15)}-${compact.slice(15,19)}`;
};
const publicStatus=row=>({id:row.id,status:row.status,name:row.name,expiresAt:row.expires_at,reason:row.rejection_reason||'',updatedAt:row.updated_at});
function matchesConstantTime(left,right){
  const a=String(left||''),b=String(right||'');let difference=a.length^b.length;
  for(let i=0;i<Math.max(a.length,b.length);i++)difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return difference===0;
}
async function bodyJson(request){
  if(Number(request.headers.get('content-length')||0)>4096)throw new Error('??????');
  const text=await request.text();
  if(text.length>4096)throw new Error('??????');
  return JSON.parse(text);
}
async function expireOld(db){
  await db.prepare("UPDATE applications SET status='expired',updated_at=? WHERE status='approved' AND expires_at<=?").bind(now(),now()).run();
}
async function deviceCredentials(request){
  const deviceId=request.headers.get('x-device-id')||'';
  const secret=/^Device ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')||'')?.[1]||'';
  const code=machineCode(request.headers.get('x-machine-code'));
  if(!/^[0-9a-f-]{36}$/.test(deviceId)||!secret)throw new Error('??????');
  return {deviceId,secretHash:await digest(`image-workbench-device-v1\0${secret}`),machineHash:await digest(`image-workbench-machine-v1\0${code}`)};
}
async function requireAdmin(request,env){
  const token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')||'')?.[1]||'';
  if(!env.ADMIN_TOKEN||!matchesConstantTime(token,env.ADMIN_TOKEN))throw Object.assign(new Error('???????'),{status:401});
}
async function apply(request,env){
  const input=await bodyJson(request);
  const name=String(input.name||'').trim();
  const phone=String(input.phone||'').trim();
  if(name.length<2||name.length>40||/[\u0000-\u001f]/.test(name))return fail('???? 2?40 ???');
  if(!/^\d{11}$/.test(phone))return fail('????? 11 ???');
  const code=machineCode(input.machineCode);
  const deviceId=String(input.deviceId||'');
  const secret=String(input.deviceSecret||'');
  if(!/^[0-9a-f-]{36}$/.test(deviceId)||!/^[A-Za-z0-9_-]{43}$/.test(secret))return fail('??????');
  const secretHash=await digest(`image-workbench-device-v1\0${secret}`);
  const machineHash=await digest(`image-workbench-machine-v1\0${code}`);
  const phoneHash=await digest(`image-workbench-phone-v1\0${phone}`);
  await expireOld(env.DB);
  const latest=await env.DB.prepare('SELECT * FROM applications WHERE device_id=? ORDER BY created_at DESC LIMIT 1').bind(deviceId).first();
  if(latest&&(!matchesConstantTime(latest.secret_hash,secretHash)||latest.machine_hash!==machineHash))return fail('???????????',403);
  if(latest&&['pending','approved'].includes(latest.status))return json(publicStatus(latest));
  const recent=await env.DB.prepare('SELECT COUNT(*) AS count FROM applications WHERE device_id=? AND created_at>=?').bind(deviceId,new Date(Date.now()-86400000).toISOString()).first();
  if(Number(recent?.count||0)>=5)return fail('????????????????',429);
  const timestamp=now(),id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO applications(id,name,phone,phone_hash,machine_code,machine_hash,device_id,secret_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'pending',?,?)")
    .bind(id,name,phone,phoneHash,code,machineHash,deviceId,secretHash,timestamp,timestamp).run();
  return json({id,status:'pending',name,expiresAt:null,reason:'',updatedAt:timestamp},201);
}
async function status(request,env){
  const credentials=await deviceCredentials(request);
  await expireOld(env.DB);
  const row=await env.DB.prepare('SELECT * FROM applications WHERE device_id=? ORDER BY created_at DESC LIMIT 1').bind(credentials.deviceId).first();
  if(!row)return json({status:'none'});
  if(!matchesConstantTime(row.secret_hash,credentials.secretHash)||row.machine_hash!==credentials.machineHash)return fail('???????',403);
  return json(publicStatus(row));
}
async function adminList(request,env){
  await expireOld(env.DB);
  const url=new URL(request.url);
  const offset=Math.max(0,Math.min(1000000,Number(url.searchParams.get('offset'))||0));
  const limit=Math.max(1,Math.min(200,Number(url.searchParams.get('limit'))||100));
  const rows=await env.DB.prepare('SELECT id,name,phone,machine_code AS machineCode,status,expires_at AS expiresAt,rejection_reason AS reason,created_at AS createdAt,updated_at AS updatedAt,decided_at AS decidedAt FROM applications ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?').bind(limit,offset).all();
  const count=await env.DB.prepare('SELECT COUNT(*) AS count FROM applications').first();
  return json({items:rows.results||[],total:Number(count?.count||0),offset,limit});
}
async function adminAction(request,env,id,action){
  const input=action==='delete'?{}:await bodyJson(request);
  await expireOld(env.DB);
  const row=await env.DB.prepare('SELECT * FROM applications WHERE id=?').bind(id).first();
  if(!row)return fail('?????',404);
  const timestamp=now();
  if(action==='approve'){
    if(row.status!=='pending')return fail('??????????',409);
    const expiresAt=String(input.expiresAt||'');
    const expiry=Date.parse(expiresAt);
    if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+10*366*86400000)return fail('?????????????');
    try{await env.DB.prepare("UPDATE applications SET status='approved',expires_at=?,rejection_reason=NULL,updated_at=?,decided_at=? WHERE id=? AND status='pending'").bind(new Date(expiry).toISOString(),timestamp,timestamp,id).run();}
    catch{return fail('?????????????????????',409);}
  }else if(action==='reject'){
    if(row.status!=='pending')return fail('??????????',409);
    const reason=String(input.reason||'?????').trim().slice(0,120);
    await env.DB.prepare("UPDATE applications SET status='rejected',rejection_reason=?,updated_at=?,decided_at=? WHERE id=? AND status='pending'").bind(reason,timestamp,timestamp,id).run();
  }else if(action==='unbind'){
    if(row.status!=='approved')return fail('???????????',409);
    await env.DB.prepare("UPDATE applications SET status='unbound',updated_at=?,decided_at=? WHERE id=? AND status='approved'").bind(timestamp,timestamp,id).run();
  }else if(action==='expiry'){
    if(row.status!=='approved')return fail('???????????',409);
    const expiry=Date.parse(String(input.expiresAt||''));
    if(!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+10*366*86400000)return fail('?????????????');
    await env.DB.prepare("UPDATE applications SET expires_at=?,updated_at=? WHERE id=? AND status='approved'").bind(new Date(expiry).toISOString(),timestamp,id).run();
  }else if(action==='rename'){
    const name=String(input.name||'').trim();
    if(name.length<2||name.length>40||/[\u0000-\u001f]/.test(name))return fail('???? 2?40 ???');
    await env.DB.prepare('UPDATE applications SET name=?,updated_at=? WHERE id=?').bind(name,timestamp,id).run();
  }else if(action==='rebind'){
    if(row.status!=='approved')return fail('?????????',409);
    const target=await env.DB.prepare('SELECT * FROM applications WHERE id=?').bind(String(input.targetId||'')).first();
    if(!target||target.status!=='pending')return fail('????????????',409);
    if(target.phone_hash!==row.phone_hash)return fail('?????????????????',409);
    const occupied=await env.DB.prepare("SELECT id FROM applications WHERE machine_hash=? AND status='approved'").bind(target.machine_hash).first();
    if(occupied)return fail('?????????',409);
    await env.DB.batch([
      env.DB.prepare("UPDATE applications SET status='unbound',updated_at=?,decided_at=? WHERE id=? AND status='approved'").bind(timestamp,timestamp,id),
      env.DB.prepare("UPDATE applications SET status='approved',expires_at=?,rejection_reason=NULL,updated_at=?,decided_at=? WHERE id=? AND status='pending'").bind(row.expires_at,timestamp,timestamp,target.id)
    ]);
  }else if(action==='delete'){
    await env.DB.prepare('DELETE FROM applications WHERE id=?').bind(id).run();
  }else return fail('?????',404);
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
    return fail('?????',404);
  }catch(error){
    const status=error.status||(/JSON|????|????/.test(error.message)?400:500);
    return fail(status===500?'???????':error.message,status);
  }
}};
