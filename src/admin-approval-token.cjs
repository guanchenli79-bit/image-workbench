const fs=require('node:fs');
const path=require('node:path');

function adminApprovalToken(vault,userData){
  vault.requireUnlocked();
  const saved=vault.snapshot().approvalToken;
  if(/^[A-Za-z0-9_-]{43}$/.test(saved||''))return saved;
  const bootstrap=path.join(userData,'approval-admin-token.txt');
  let token;
  try{token=fs.readFileSync(bootstrap,'utf8').trim();}
  catch{throw new Error('???????????????????');}
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('?????????????');
  vault.update(data=>{data.approvalToken=token;});
  fs.rmSync(bootstrap,{force:true});
  return token;
}

module.exports={adminApprovalToken};
