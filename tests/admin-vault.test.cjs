const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {AdminVault}=require('../src/admin-vault.cjs');
const {machineCodeFromGuid,hashCode}=require('../src/license.cjs');
const {issueInRegistry,unbindInRegistry,normalizeName,view}=require('../src/admin-license.cjs');

test('管理员密码保护本机备注和生成历史',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'admin-vault-test-'));
  try{
    const file=path.join(dir,'admin-vault.json');
    const machineCode=machineCodeFromGuid('e13f815a-63ab-4c4a-af4f-3fbf707d1001');
    const issued=issueInRegistry({version:1,entries:[]},machineCode,'2030-12-31');
    const machineHash=hashCode('machine',machineCode);
    const first=new AdminVault(file);
    assert.deepEqual(first.status(),{needsSetup:true,unlocked:false});
    assert.throws(()=>first.snapshot(),/密码/);
    assert.throws(()=>first.setup('short','short'),/8/);
    first.setup('strong password','strong password');
    first.update(data=>{
      data.notes[machineHash]='设计部电脑';
      data.history.push({key:issued.key,machineCode,machineHash,name:'设计部电脑',issuedAt:'2026-10-17T00:00:00.000Z',expiresAt:issued.expiresAt});
    });
    assert.equal(fs.readFileSync(file,'utf8').includes(issued.key),false);
    assert.equal(fs.readFileSync(file,'utf8').includes('设计部电脑'),false);
    first.lock();
    assert.throws(()=>first.snapshot(),/密码/);
    const reopened=new AdminVault(file);
    assert.throws(()=>reopened.unlock('wrong password'),/密码错误/);
    reopened.unlock('strong password');
    const current=view(issued.registry,reopened);
    assert.equal(current.entries[0].name,'设计部电脑');
    assert.equal(current.history[0].key,issued.key);
    assert.equal(current.history[0].status,'有效');
    assert.equal(view(unbindInRegistry(issued.registry,machineHash),reopened).history[0].status,'已失效');
    assert.throws(()=>normalizeName('a'.repeat(41)),/40/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
