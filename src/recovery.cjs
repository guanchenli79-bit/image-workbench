function recoverSubmittedMidjourney(records) {
  let count = 0;
  for (const record of records) {
    if (record.status !== 'failed' || record.modelId !== 'midjourney' || typeof record.error !== 'string') continue;
    let response;
    try { response = JSON.parse(record.error); } catch { continue; }
    if (![1,21,22].includes(Number(response.code)) || !/^\d{12,22}$/.test(String(response.result || ''))) continue;
    record.status = 'pending';
    record.progress = 0;
    record.taskId = String(response.result);
    record.taskAdapter = 'midjourney';
    delete record.error;
    count++;
  }
  return count;
}

module.exports = { recoverSubmittedMidjourney };
