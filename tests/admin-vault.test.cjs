const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {AdminVault}=require('../src/admin-vault.cjs');
const {adminApprovalToken}=require('../src/admin-approval-token.cjs');
const {machineCodeFromGuid,hashCode}=require('../src/license.cjs');
const {issueInRegistry,unbindInRegistry,rebindInRegistry,normalizeName,view}=require('../src/admin-license.cjs');

test('????????????????',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'admin-vault-test-'));
  try{
    const file=path.join(dir,'admin-vault.json');
    const machineCode=machineCodeFromGuid('e13f815a-63ab-4c4a-af4f-3fbf707d1001');
    const issued=issueInRegistry({version:1,entries:[]},machineCode,'2030-12-31');
    const machineHash=hashCode('machine',machineCode);
    const first=new AdminVault(file);
    assert.deepEqual(first.status(),{needsSetup:true,unlocked:false});
    assert.throws(()=>first.snapshot(),/??/);
    assert.throws(()=>first.setup('short','short'),/8/);
    first.setup('strong password','strong password');
    first.update(data=>{
      data.notes[machineHash]='?????';
      const item={key:issued.key,machineCode,machineHash,name:'?????',issuedAt:'2026-10-17T00:00:00.000Z',expiresAt:issued.expiresAt};
      data.history.push(item);data.bindings.push({...item});
    });
    assert.equal(fs.readFileSync(file,'utf8').includes(issued.key),false);
    assert.equal(fs.readFileSync(file,'utf8').includes('?????'),false);
    first.lock();
    assert.throws(()=>first.snapshot(),/??/);
    const reopened=new AdminVault(file);
    assert.throws(()=>reopened.unlock('wrong password'),/????/);
    reopened.unlock('strong password');
    const current=view(issued.registry,reopened);
    assert.equal(current.entries[0].name,'?????');
    assert.equal(current.history[0].key,issued.key);
    assert.equal(current.history[0].status,'??');
    assert.equal(current.bindings[0].machineCode,machineCode);
    assert.equal(view(unbindInRegistry(issued.registry,machineHash),reopened).history[0].status,'???');
    assert.equal(view(unbindInRegistry(issued.registry,machineHash),reopened).bindings[0].status,'???');
    const another=machineCodeFromGuid('e13f815a-63ab-4c4a-af4f-3fbf707d1002');
    const rebound=rebindInRegistry(issued.registry,hashCode('license',issued.key),another,issued.expiresAt);
    assert.equal(rebound.entries[0].machineHash,hashCode('machine',another));
    assert.equal(rebound.entries[0].keyHash,hashCode('license',issued.key));
    assert.equal(rebound.entries.length,1);
    assert.ok(fs.existsSync(`${file}.bak`));
    fs.writeFileSync(file,'corrupted');
    const recovered=new AdminVault(file);recovered.unlock('strong password');
    assert.equal(recovered.snapshot().bindings[0].key,issued.key);
    assert.throws(()=>normalizeName('a'.repeat(41)),/40/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('???????????????????????',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'admin-approval-test-'));
  try{
    const token='A'.repeat(43);
    const vault=new AdminVault(path.join(dir,'admin-vault.json'));
    vault.setup('strong password','strong password');
    fs.writeFileSync(path.join(dir,'approval-admin-token.txt'),token);
    assert.equal(adminApprovalToken(vault,dir),token);
    assert.equal(fs.existsSync(path.join(dir,'approval-admin-token.txt')),false);
    assert.equal(fs.readFileSync(vault.file,'utf8').includes(token),false);
    vault.lock();
    assert.throws(()=>adminApprovalToken(vault,dir),/??/);
    const reopened=new AdminVault(vault.file);
    reopened.unlock('strong password');
    assert.equal(adminApprovalToken(reopened,dir),token);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
