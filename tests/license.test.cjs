const test=require('node:test');
const assert=require('node:assert/strict');
const {machineCodeFromGuid,normalizeMachineCode,normalizeLicenseKey,createLicenseKey,hashCode,findLicense,validateRegistry}=require('../src/license.cjs');
const {issueInRegistry,unbindInRegistry}=require('../src/admin-license.cjs');

const machineA=machineCodeFromGuid('e13f815a-63ab-4c4a-af4f-3fbf707d1001');
const machineB=machineCodeFromGuid('e13f815a-63ab-4c4a-af4f-3fbf707d1002');

test('机器码稳定、不同 Windows 标识不共用机器码',()=>{
  assert.match(machineA,/^DP-M-(?:[0-9A-HJKMNP-TV-Z]{4}-){3}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(machineA,machineCodeFromGuid('E13F815A-63AB-4C4A-AF4F-3FBF707D1001'));
  assert.notEqual(machineA,machineB);
  assert.equal(normalizeMachineCode(machineA.toLowerCase()),machineA);
});

test('卡密格式固定，授权记录不存明文',()=>{
  const key=createLicenseKey();
  assert.match(key,/^DP-(?:[0-9A-HJKMNP-TV-Z]{4}-){2}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(normalizeLicenseKey(key.replaceAll('-','').toLowerCase()),key);
  const issued=issueInRegistry({version:1,entries:[]},machineA,'2030-12-31',key);
  assert.equal(issued.registry.entries.length,1);
  assert.equal(JSON.stringify(issued.registry).includes(key),false);
  assert.equal(JSON.stringify(issued.registry).includes(machineA),false);
  assert.equal(issued.registry.entries[0].machineHash,hashCode('machine',machineA));
  assert.equal(findLicense(issued.registry,machineA,key)?.expiresAt,issued.expiresAt);
  assert.equal(findLicense(issued.registry,machineB,key),null);
  assert.equal(findLicense(issued.registry,machineA,createLicenseKey()),null);
  assert.equal(findLicense(issued.registry,machineA,key,Date.parse(issued.expiresAt)+1),null);
});

test('重新签发替换旧卡，解绑删除该机器的授权',()=>{
  const first=issueInRegistry({version:1,entries:[]},machineA,'2030-12-31');
  const second=issueInRegistry(first.registry,machineA,'2031-12-31');
  assert.equal(second.registry.entries.length,1);
  assert.equal(findLicense(second.registry,machineA,first.key),null);
  assert.ok(findLicense(second.registry,machineA,second.key));
  const unbound=unbindInRegistry(second.registry,hashCode('machine',machineA));
  assert.equal(unbound.entries.length,0);
  assert.equal(findLicense(unbound,machineA,second.key),null);
  assert.throws(()=>unbindInRegistry(unbound,hashCode('machine',machineA)),/没有授权/);
  assert.throws(()=>validateRegistry({version:1,entries:[{keyHash:'bad'}]}),/格式不正确/);
});
