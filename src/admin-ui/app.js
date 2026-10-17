const $=id=>document.getElementById(id);
const message=(value,error=false)=>{$('actionMessage').textContent=value;$('actionMessage').classList.toggle('error',error);};
function showEntries(entries){
  const host=$('licenseList');host.replaceChildren();
  if(!entries.length){const p=document.createElement('p');p.className='empty';p.textContent='当前没有授权记录';host.append(p);return;}
  for(const entry of entries){
    const row=document.createElement('div');row.className='license-row';
    const copy=document.createElement('div');const name=document.createElement('strong');name.textContent=`机器 ${entry.machineHash.slice(0,12).toUpperCase()}…`;
    const date=document.createElement('small');date.textContent=`有效期至 ${new Date(entry.expiresAt).toLocaleString('zh-CN')}`;copy.append(name,date);
    const button=document.createElement('button');button.type='button';button.textContent='解绑机器';
    button.addEventListener('click',async()=>{button.disabled=true;try{const updated=await window.licenseAdmin.unbind(entry.machineHash);if(updated){showEntries(updated);message('机器已解绑，授权库已同步');}}catch(error){message(error.message,true);}finally{button.disabled=false;}});
    row.append(copy,button);host.append(row);
  }
}
async function load(){try{showEntries(await window.licenseAdmin.list());message('授权库已同步');}catch(error){$('licenseList').textContent='加载失败，请检查 gh 登录和网络';message(error.message,true);}}
function defaultDate(){const date=new Date();date.setDate(date.getDate()+30);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
$('expiryInput').value=defaultDate();
$('reloadList').addEventListener('click',load);
$('useOwnMachine').addEventListener('click',async()=>{try{$('machineInput').value=await window.licenseAdmin.ownMachine();}catch(error){message(error.message,true);}});
$('issueForm').addEventListener('submit',async event=>{event.preventDefault();const button=$('issueButton');button.disabled=true;button.textContent='正在签发并同步…';try{const result=await window.licenseAdmin.issue({machineCode:$('machineInput').value,date:$('expiryInput').value});$('issuedKey').textContent=result.key;$('issuedExpiry').textContent=`有效期至 ${new Date(result.expiresAt).toLocaleString('zh-CN')}`;$('issuedResult').hidden=false;showEntries(result.entries);message('签发成功。请复制卡密发给这台机器的用户。');}catch(error){message(error.message,true);}finally{button.disabled=false;button.innerHTML='生成并同步卡密 <span>↗</span>';}});
$('copyIssuedKey').addEventListener('click',async()=>{try{await window.licenseAdmin.copy($('issuedKey').textContent);message('卡密已复制');}catch(error){message(error.message,true);}});
load();
