(function(root){
  function resolveRecordParams(record,model,presets){
    const ratios=[record.actualRatio,record.presetId];
    const ratio=ratios.find(value=>presets.some(preset=>preset.id===value)&&(value==='auto'||!model.ratios?.length||model.ratios.includes(value)))||'auto';
    const options=model.resolutions||['default'];
    const resolution=options.find(value=>value.toUpperCase()===String(record.resolution||'').toUpperCase())||model.defaultResolution||options[0];
    const seconds=Array.isArray(model.seconds)&&model.seconds.some(value=>Number(value)===Number(record.seconds))?String(record.seconds):null;
    return {ratio,resolution,seconds};
  }
  root.resolveRecordParams=resolveRecordParams;
  if(typeof module!=='undefined')module.exports={resolveRecordParams};
})(globalThis);
