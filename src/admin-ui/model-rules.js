(() => {
  const $=id=>document.getElementById(id);
  const api=window.licenseAdmin;
  const blank=()=>({schemaVersion:1,rules:[]});
  let current={revision:0,config:blank()};
  let editingIndex=-1;
  let loaded=false;
  let busy=false;
  let epoch=0;
  let sizes={};

  function status(text,error=false){
    const node=$('ruleActionStatus');
    node.textContent=text;
    node.classList.toggle('error',error);
  }
  function errorText(error){
    return String(error?.message||error).replace(/^Error invoking remote method '[^']+': Error: /,'');
  }
  function options(select,values,preferred){
    select.replaceChildren(...values.map(([value,label])=>new Option(label,value)));
    if(values.some(([value])=>value===preferred))select.value=preferred;
  }
  function syncButtons(){
    const publishingBlocked=!loaded||busy;
    $('publishModelRule').disabled=publishingBlocked;
    $('removeModelRule').hidden=editingIndex<0;
    $('removeModelRule').disabled=publishingBlocked;
    $('modelRuleRollback').disabled=publishingBlocked||current.revision===0;
    $('reloadModelRules').disabled=busy;
    $('previewModelRule').disabled=busy;
    $('newModelRule').disabled=busy;
    $('modelGoRuleSample').disabled=busy;
    $('publishedRuleList').disabled=busy;
    $('modelRuleForm').setAttribute('aria-busy',String(busy));
  }
  async function operate(action){
    if(busy)return;
    const marker=epoch;
    busy=true;
    syncButtons();
    try{await action(()=>marker===epoch);}
    catch(error){if(marker===epoch)status(errorText(error),true);}
    finally{
      if(marker===epoch){busy=false;syncButtons();}
    }
  }

  function split(text){
    return [...new Set(text.split(/[,，\s]+/).filter(Boolean))];
  }
  function readTable(){
    for(const field of $('ruleSizeTable').querySelectorAll('input')){
      sizes[field.dataset.tier]??={};
      sizes[field.dataset.tier][field.dataset.ratio]=field.value.trim();
    }
  }
  function rebuildTable(){
    const tiers=split($('ruleTiers').value).slice(0,8).filter(value=>/^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/.test(value));
    const ratios=split($('ruleRatios').value).slice(0,13).filter(value=>/^[1-9]\d?:[1-9]\d?$/.test(value));
    const table=$('ruleSizeTable');
    table.replaceChildren();
    const header=table.createTHead().insertRow();
    for(const label of ['画幅',...tiers]){
      const th=document.createElement('th');
      th.scope='col';th.textContent=label;
      header.append(th);
    }
    const body=table.createTBody();
    for(const ratio of ratios){
      const row=body.insertRow();
      const th=document.createElement('th');
      th.scope='row';th.textContent=ratio;
      row.append(th);
      for(const tier of tiers){
        const cell=row.insertCell();
        const field=document.createElement('input');
        field.type='text';
        field.maxLength=11;
        field.dataset.tier=tier;
        field.dataset.ratio=ratio;
        field.placeholder='宽x高';
        field.value=sizes[tier]?.[ratio]||'';
        field.setAttribute('aria-label',ratio+' · '+tier);
        cell.append(field);
      }
    }
    const tierOptions=tiers.map(tier=>[tier,tier]);
    const ratioOptions=ratios.map(ratio=>[ratio,ratio]);
    options($('ruleDefaultTier'),tierOptions,$('ruleDefaultTier').value||'2K');
    options($('previewRuleRatio'),ratioOptions,$('previewRuleRatio').value||'16:9');
    options($('previewRuleTier'),tierOptions,$('previewRuleTier').value||'2K');
  }
  function setProtocolFields(){
    const protocol=$('ruleProtocol').value;
    $('ruleEditLabel').hidden=protocol!=='openai-images';
    $('ruleWatermarkLabel').hidden=protocol!=='seedream-json';
    $('ruleMaxRefs').max=protocol==='siliconflow-images'?'3':'10';
  }
  function fill(rule={},index=-1){
    editingIndex=index;
    $('publishedRuleList').value=index===-1?'':String(index);
    $('ruleBaseUrl').value=rule.baseUrl||'';
    $('ruleModelId').value=rule.modelId||'';
    $('ruleLabel').value=rule.label||'';
    $('ruleProtocol').value=rule.protocol||'seedream-json';
    $('ruleGenerationPath').value=rule.generationPath||'/v1/images/generations';
    $('ruleModelsPath').value=rule.modelsPath||'';
    $('ruleEditPath').value=rule.editPath||'';
    $('ruleMaxRefs').value=rule.maxRefs??0;
    $('ruleRequiredRefs').checked=rule.requiredRefs===true;
    $('ruleAllowUnlisted').checked=rule.allowUnlisted===true;
    $('ruleWatermark').checked=rule.watermark===true;
    sizes=Object.assign(Object.create(null),structuredClone(rule.sizes||{}));
    const tiers=Object.keys(sizes);
    $('ruleTiers').value=(tiers.length?tiers:['1K','2K']).join(', ');
    $('ruleRatios').value=(Object.keys(sizes[tiers[0]]||{}).length?Object.keys(sizes[tiers[0]]):['1:1','16:9','9:16']).join(', ');
    setProtocolFields();
    rebuildTable();
    if(rule.defaultResolution)$('ruleDefaultTier').value=rule.defaultResolution;
    $('modelRulePreview').hidden=true;
    status('');
    syncButtons();
  }
  function ruleInput(){
    if(!$('modelRuleForm').reportValidity())return null;
    readTable();
    const tiers=split($('ruleTiers').value);
    const ratios=split($('ruleRatios').value);
    const cells=Object.fromEntries(tiers.map(tier=>[tier,Object.fromEntries(ratios.map(ratio=>[ratio,sizes[tier]?.[ratio]||'']))]));
    const text=id=>$(id).value.trim();
    const protocol=text('ruleProtocol');
    return {baseUrl:text('ruleBaseUrl'),modelId:text('ruleModelId'),label:text('ruleLabel'),protocol,
      generationPath:text('ruleGenerationPath'),modelsPath:text('ruleModelsPath'),
      editPath:protocol==='openai-images'?text('ruleEditPath'):'',
      maxRefs:Number(text('ruleMaxRefs')),requiredRefs:$('ruleRequiredRefs').checked,
      allowUnlisted:$('ruleAllowUnlisted').checked,
      ...(protocol==='seedream-json'?{watermark:$('ruleWatermark').checked}:{}),
      defaultResolution:text('ruleDefaultTier'),sizes:cells};
  }
  function acceptState({manifest,history},selectIndex){
    current=manifest;
    loaded=true;
    $('ruleServiceStatus').textContent=manifest.revision
      ?'线上版本 '+manifest.revision+' · 已发布 '+manifest.config.rules.length+' 条规则'
      :'尚未发布接口规则';
    options($('publishedRuleList'),[['','选择规则'],...manifest.config.rules.map((rule,index)=>
      [String(index),rule.label+' · '+new URL(rule.baseUrl).host])],'');
    const versions=(history||[]).filter(item=>item.revision<manifest.revision).map(item=>[
      String(item.revision),'版本 '+item.revision+' · '+new Date(item.publishedAt).toLocaleString('zh-CN')
    ]);
    options($('ruleVersionHistory'),[...versions,['0','初始空白配置']],'');
    if(selectIndex!==undefined&&manifest.config.rules[selectIndex])fill(manifest.config.rules[selectIndex],selectIndex);
    else fill();
  }

  window.resetRuleConsole=()=>{
    epoch++;
    loaded=false;busy=false;current={revision:0,config:blank()};
    fill();
    $('ruleServiceStatus').textContent='';
  };
  window.refreshRuleConsole=()=>operate(async valid=>{
    $('ruleServiceStatus').textContent='正在读取线上规则…';
    try{
      const state=await api.modelRules();
      if(valid())acceptState(state,state.manifest.config.rules.length?0:undefined);
    }catch(error){
      if(valid()){
        loaded=false;
        $('ruleServiceStatus').textContent=errorText(error)==='接口不存在'
          ?'当前服务尚未启用在线规则，可先载入示例并预览请求。'
          :'读取规则失败，请刷新重试。';
      }
      throw error;
    }
  });
  $('reloadModelRules').addEventListener('click',()=>window.refreshRuleConsole());
  $('newModelRule').addEventListener('click',()=>fill());
  $('modelGoRuleSample').addEventListener('click',()=>operate(async valid=>{
    const sample=await api.modelRulesSample();
    if(!valid())return;
    const index=current.config.rules.findIndex(rule=>rule.baseUrl===sample.baseUrl&&rule.modelId===sample.modelId);
    if(index>=0)fill(current.config.rules[index],index);
    else fill(sample);
  }));
  $('publishedRuleList').addEventListener('change',event=>{
    const value=event.target.value;
    if(value==='')fill();
    else fill(current.config.rules[Number(value)],Number(value));
  });
  $('ruleProtocol').addEventListener('change',setProtocolFields);
  for(const id of ['ruleTiers','ruleRatios'])$(id).addEventListener('change',()=>{readTable();rebuildTable();});
  $('modelRuleForm').addEventListener('input',()=>{$('modelRulePreview').hidden=true;});
  function showPreview(preview){
    const node=$('modelRulePreview');
    node.textContent='POST '+preview.url+'\n'+preview.encoding+'\n\n'+JSON.stringify(preview.body,null,2);
    node.hidden=false;
  }
  $('modelRuleForm').addEventListener('submit',event=>{
    event.preventDefault();
    const rule=ruleInput();
    if(rule)void operate(async valid=>{
      const preview=await api.previewModelRule({rule,ratio:$('previewRuleRatio').value,resolution:$('previewRuleTier').value});
      if(valid()){showPreview(preview);status('本地预览完成，未调用生图接口。');}
    });
  });
  $('publishModelRule').addEventListener('click',()=>{
    const rule=ruleInput();
    if(!rule||!loaded)return;
    void operate(async valid=>{
      const preview=await api.previewModelRule({rule,ratio:$('previewRuleRatio').value,resolution:$('previewRuleTier').value});
      if(!valid())return;
      showPreview(preview);
      if(!window.confirm('发布这条接口规则给用户端？'))return;
      const existing=current.config.rules.slice();
      const index=editingIndex<0?existing.length:editingIndex;
      existing[index]=rule;
      const state=await api.publishModelRules({expectedRevision:current.revision,config:{schemaVersion:1,rules:existing}});
      if(valid()){acceptState(state,index);status('已发布版本 '+state.manifest.revision+'。');}
    });
  });
  $('removeModelRule').addEventListener('click',()=>{
    if(!loaded||editingIndex<0||!window.confirm('撤下这条规则并发布新版本？'))return;
    void operate(async valid=>{
      const rules=current.config.rules.filter((_,index)=>index!==editingIndex);
      const state=await api.publishModelRules({expectedRevision:current.revision,config:{schemaVersion:1,rules}});
      if(valid()){acceptState(state,rules.length?0:undefined);status('已撤下规则并发布版本 '+state.manifest.revision+'。');}
    });
  });
  $('modelRuleRollback').addEventListener('click',()=>{
    if(!loaded||!window.confirm('加载所选历史配置并发布为新版本？'))return;
    void operate(async valid=>{
      const targetRevision=Number($('ruleVersionHistory').value);
      const state=await api.rollbackModelRules({expectedRevision:current.revision,targetRevision});
      if(valid()){acceptState(state,0);status('已回退，客户端将同步版本 '+state.manifest.revision+'。');}
    });
  });
  window.resetRuleConsole();
})();
