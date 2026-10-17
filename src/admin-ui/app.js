const $=id=>document.getElementById(id);
const dateText=value=>new Date(value).toLocaleString('zh-CN');
const message=(value,error=false)=>{$('actionMessage').textContent=value;$('actionMessage').classList.toggle('error',error);};
let setupMode=false;

function showAuth(needsSetup){
  setupMode=needsSetup;
  $('authPage').hidden=false;$('workspace').hidden=true;$('lockButton').hidden=true;
  $('authTitle').textContent=needsSetup?'首次设置管理员密码':'管理员登录';
  $('authIntro').textContent=needsSetup?'设置至少 8 位密码，之后每次打开管理端都需要输入。请妥善保存，忘记后本机加密的生成历史无法恢复。':'输入管理员密码后，才能查看和管理卡密。';
  $('confirmationField').hidden=!needsSetup;
  $('confirmationInput').required=needsSetup;
  $('passwordInput').autocomplete=needsSetup?'new-password':'current-password';
  $('authButton').textContent=needsSetup?'设置密码并进入':'进入管理端';
  $('passwordInput').value='';$('confirmationInput').value='';$('authMessage').textContent='';
  $('passwordInput').focus();
}
function showWorkspace(){
  $('authPage').hidden=true;$('workspace').hidden=false;$('lockButton').hidden=false;
  load();
}
function showEntries(entries){
  const host=$('licenseList');host.replaceChildren();
  if(!entries.length){const p=document.createElement('p');p.className='empty';p.textContent='当前没有授权记录';host.append(p);return;}
  for(const entry of entries){
    const row=document.createElement('div');row.className='license-row';
    const body=document.createElement('div');body.className='license-info';
    const name=document.createElement('strong');name.textContent=entry.name||'未命名机器';
    const hash=document.createElement('small');hash.textContent=`机器 ${entry.machineHash.slice(0,12).toUpperCase()}…`;
    const date=document.createElement('small');date.textContent=`有效期至 ${dateText(entry.expiresAt)}`;
    const edit=document.createElement('div');edit.className='row-edit';
    const input=document.createElement('input');input.value=entry.name||'';input.maxLength=40;input.placeholder='给这台机器命名';input.setAttribute('aria-label','机器备注名称');
    const save=document.createElement('button');save.type='button';save.textContent='保存名称';
    save.addEventListener('click',async()=>{save.disabled=true;try{const updated=await window.licenseAdmin.rename({machineHash:entry.machineHash,name:input.value});name.textContent=updated||'未命名机器';entry.name=updated;for(const item of document.querySelectorAll('.history-row'))if(item.dataset.machineHash===entry.machineHash)item.querySelector('strong').textContent=updated||'未命名机器';message('备注名称已保存到本机');}catch(error){message(error.message,true);}finally{save.disabled=false;}});
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();save.click();}});
    const unbind=document.createElement('button');unbind.type='button';unbind.className='danger';unbind.textContent='解绑机器';
    unbind.addEventListener('click',async()=>{unbind.disabled=true;try{const updated=await window.licenseAdmin.unbind(entry.machineHash);if(updated){showSnapshot(updated);message('机器已解绑，授权库已同步');}}catch(error){message(error.message,true);}finally{unbind.disabled=false;}});
    edit.append(input,save,unbind);body.append(name,hash,date,edit);row.append(body);host.append(row);
  }
}
function showHistory(items){
  const host=$('historyList');host.replaceChildren();
  if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent='这台管理机还没有新版签发记录';host.append(p);return;}
  for(const item of items){
    const row=document.createElement('div');row.className='history-row';row.dataset.machineHash=item.machineHash;
    const details=document.createElement('div');details.className='history-info';
    const title=document.createElement('strong');title.textContent=item.name||'未命名机器';
    const key=document.createElement('code');key.textContent=item.key;
    const meta=document.createElement('small');meta.textContent=`${item.machineCode} · 签发 ${dateText(item.issuedAt)} · 到期 ${dateText(item.expiresAt)}`;
    const actions=document.createElement('div');actions.className='history-actions';
    const status=document.createElement('span');status.className=`status ${item.status==='有效'?'active':''}`;status.textContent=item.status||'未核验';
    const copy=document.createElement('button');copy.type='button';copy.textContent='复制卡密';
    copy.addEventListener('click',async()=>{try{await window.licenseAdmin.copy(item.key);message('历史卡密已复制');}catch(error){message(error.message,true);}});
    details.append(title,key,meta);actions.append(status,copy);row.append(details,actions);host.append(row);
  }
}
function showSnapshot(snapshot){showEntries(snapshot.entries);showHistory(snapshot.history);}
async function load(){
  try{showSnapshot(await window.licenseAdmin.list());message('授权库已同步');}
  catch(error){
    $('licenseList').textContent='授权库加载失败，请检查 gh 登录和网络';
    try{showHistory(await window.licenseAdmin.history());}catch{$('historyList').textContent='本机历史读取失败';}
    message(error.message,true);
  }
}
function defaultDate(){const date=new Date();date.setDate(date.getDate()+30);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
$('expiryInput').value=defaultDate();
$('authForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('authButton');button.disabled=true;
  try{
    const password=$('passwordInput').value;
    if(setupMode)await window.licenseAdmin.setup({password,confirmation:$('confirmationInput').value});
    else await window.licenseAdmin.unlock(password);
    $('passwordInput').value='';$('confirmationInput').value='';showWorkspace();
  }catch(error){$('authMessage').textContent=error.message;}
  finally{button.disabled=false;}
});
$('lockButton').addEventListener('click',async()=>{try{const status=await window.licenseAdmin.lock();$('issuedKey').textContent='';$('issuedResult').hidden=true;$('licenseList').replaceChildren();$('historyList').replaceChildren();showAuth(status.needsSetup);}catch(error){message(error.message,true);}});
$('reloadList').addEventListener('click',load);
$('useOwnMachine').addEventListener('click',async()=>{try{$('machineInput').value=await window.licenseAdmin.ownMachine();}catch(error){message(error.message,true);}});
$('issueForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('issueButton');button.disabled=true;button.textContent='正在签发并同步…';
  try{
    const result=await window.licenseAdmin.issue({machineCode:$('machineInput').value,date:$('expiryInput').value,name:$('nameInput').value});
    $('issuedKey').textContent=result.key;$('issuedExpiry').textContent=`有效期至 ${dateText(result.expiresAt)}`;$('issuedResult').hidden=false;
    showSnapshot(result);message(result.warning||'签发成功。请复制卡密发给这台机器的用户。',Boolean(result.warning));
  }catch(error){message(error.message,true);}
  finally{button.disabled=false;button.innerHTML='生成并同步卡密 <span>↗</span>';}
});
$('copyIssuedKey').addEventListener('click',async()=>{try{await window.licenseAdmin.copy($('issuedKey').textContent);message('卡密已复制');}catch(error){message(error.message,true);}});
window.licenseAdmin.status().then(status=>status.unlocked?showWorkspace():showAuth(status.needsSetup)).catch(error=>{$('authPage').hidden=false;$('authMessage').textContent=error.message;});
