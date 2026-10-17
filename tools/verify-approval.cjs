const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {submitApplication,getApplication,adminList,adminAction}=require('../src/approval.cjs');
const secret=()=>crypto.randomBytes(32).toString('base64url');
const identity=()=>({deviceId:crypto.randomUUID(),deviceSecret:secret()});
const machines=['DP-M-ABCD-EFGH-JKMP-QRST','DP-M-BCDE-FGHJ-KMPQ-RSTV'];
const phone='13000000001';
const token=process.env.APPROVAL_ADMIN_TOKEN||fs.readFileSync(path.join(process.env.APPDATA,'??????','approval-admin-token.txt'),'utf8').trim();
const ids=[];
(async()=>{
  try{
    const a=identity(),b=identity();
    const first=await submitApplication(a,machines[0],'????',phone);ids.push(first.id);
    assert.equal(first.status,'pending');
    assert.equal((await getApplication(a,machines[0])).status,'pending');
    const second=await submitApplication(b,machines[1],'????',phone);ids.push(second.id);
    assert.equal(second.status,'pending');
    assert.equal((await adminList(token)).items.some(item=>item.id===first.id),true);
    const expiresAt=new Date(Date.now()+7*86400000).toISOString();
    await adminAction(token,first.id,'approve',{expiresAt});
    assert.equal((await getApplication(a,machines[0])).status,'approved');
    await adminAction(token,first.id,'rename',{name:'????'});
    assert.equal((await getApplication(a,machines[0])).name,'????');
    await assert.rejects(adminAction(token,second.id,'approve',{expiresAt}),/??/);
    await adminAction(token,first.id,'rebind',{targetId:second.id});
    assert.equal((await getApplication(a,machines[0])).status,'unbound');
    assert.equal((await getApplication(b,machines[1])).status,'approved');
    await adminAction(token,second.id,'unbind',{});
    assert.equal((await getApplication(b,machines[1])).status,'unbound');
    console.log('????????????????');
  }finally{
    for(const id of ids)await adminAction(token,id,'delete',{}).catch(()=>{});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
