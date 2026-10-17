const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const emptyData = () => ({notes:{},history:[],bindings:[]});

class AdminVault {
  constructor(file) { this.file=file; this.key=null; this.salt=null; this.data=null; this.failed=0; this.retryAt=0; }
  exists() { return fs.existsSync(this.file)||fs.existsSync(`${this.file}.bak`); }
  isUnlocked() { return Boolean(this.key && this.data); }
  status() { return {needsSetup:!this.exists(),unlocked:this.isUnlocked()}; }
  derive(password,salt) { return crypto.scryptSync(password,salt,32); }
  checkPassword(password) {
    if(typeof password!=='string' || password.length<8 || password.length>128) throw new Error('管理员密码需要 8–128 个字符');
  }
  setup(password,confirmation) {
    if(this.exists()) throw new Error('管理员密码已经设置');
    this.checkPassword(password);
    if(password!==confirmation) throw new Error('两次输入的密码不一致');
    this.salt=crypto.randomBytes(16); this.key=this.derive(password,this.salt); this.data=emptyData();
    try { this.save(); } catch(error) { this.lock(); throw error; }
    return this.status();
  }
  unlock(password) {
    if(!this.exists()) throw new Error('请先设置管理员密码');
    if(Date.now()<this.retryAt) throw new Error(`尝试次数过多，请 ${Math.ceil((this.retryAt-Date.now())/1000)} 秒后重试`);
    try {
      for(const candidate of [this.file,`${this.file}.bak`]){
        if(!fs.existsSync(candidate))continue;
        try{
          const envelope=JSON.parse(fs.readFileSync(candidate,'utf8'));
          if(envelope.version!==1)throw new Error('格式不受支持');
          const salt=Buffer.from(envelope.salt,'base64');
          const key=this.derive(password,salt);
          const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'base64'));
          decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
          const data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));
          if(!data || typeof data.notes!=='object' || !Array.isArray(data.history))throw new Error('管理端数据损坏');
          if(!Array.isArray(data.bindings))data.bindings=data.history.map(item=>({...item}));
          this.salt=salt;this.key=key;this.data=data;this.failed=0;this.retryAt=0;
          if(candidate!==this.file)try{fs.copyFileSync(candidate,this.file);}catch{}
          return this.status();
        }catch{}
      }
      throw new Error('管理数据不可解密');
    } catch {
      this.failed++;
      if(this.failed>=5) { this.retryAt=Date.now()+30000; this.failed=0; }
      throw new Error('管理员密码错误，或本机管理数据已损坏');
    }
  }
  lock() { this.key=null; this.salt=null; this.data=null; }
  requireUnlocked() { if(!this.isUnlocked()) throw new Error('请先输入管理员密码'); }
  save() {
    this.requireUnlocked();
    const iv=crypto.randomBytes(12);
    const cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv);
    const encrypted=Buffer.concat([cipher.update(JSON.stringify(this.data),'utf8'),cipher.final()]);
    const envelope={version:1,salt:this.salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')};
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const temp=`${this.file}.${process.pid}.tmp`;
    try { fs.writeFileSync(temp,JSON.stringify(envelope),{mode:0o600}); fs.renameSync(temp,this.file); try{fs.copyFileSync(this.file,`${this.file}.bak`);}catch{} }
    finally { if(fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  snapshot() { this.requireUnlocked(); return structuredClone(this.data); }
  update(mutator) {
    this.requireUnlocked();
    const next=structuredClone(this.data);
    mutator(next);
    const previous=this.data; this.data=next;
    try { this.save(); } catch(error) { this.data=previous; throw error; }
  }
}

module.exports={AdminVault};
