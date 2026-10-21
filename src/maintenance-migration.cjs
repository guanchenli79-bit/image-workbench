function migrateMultimodalHistory(history){
  return history.filter(record=>record&&['image','video'].includes(record.type)).map(record=>({
    id:record.id,type:record.type,modelId:record.modelId,modelName:record.modelName||record.modelId||'????',
    baseUrl:record.baseUrl||'',prompt:record.prompt||'',presetId:record.ratio||'auto',resolution:record.resolution||'default',
    actualRatio:record.ratio||'',actualSize:record.actualSize||'',status:record.status,
    progress:Number(record.progress)||0,createdAt:record.createdAt,completedAt:record.completedAt,
    expiresAt:record.expiresAt,taskId:record.taskId,taskAdapter:record.taskAdapter,
    files:Array.isArray(record.localFiles)?record.localFiles:[],
    error:record.error||'',lastPollError:record.lastPollError||''
  }));
}
module.exports={migrateMultimodalHistory};
