function cleanNote(value) {
  return String(value || '')
    .replace(/<\s*br\s*\/?\s*>/gi,'\n')
    .replace(/<\s*li\b[^>]*>/gi,'\n• ')
    .replace(/<\s*\/\s*(?:p|div|li|h[1-6])\s*>/gi,'\n')
    .replace(/<[^>]*>/g,'')
    .replace(/&nbsp;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;/gi,"'")
    .replace(/^#{1,6}\s+/gm,'')
    .replace(/\n{2,}(?=• )/g,'\n')
    .replace(/\n{3,}/g,'\n\n')
    .trim();
}

function releaseNotesText(value) {
  const entries=Array.isArray(value)?value.map(item=>`v${item.version}\n${cleanNote(item.note)}`):[cleanNote(value)];
  return entries.filter(Boolean).join('\n\n').slice(0,8000);
}

function updateErrorMessage(error) {
  const detail=String(error?.message||'');
  const status=Number(error?.statusCode||error?.status||/\b(?:HttpError:|HTTP|status(?: code)?)\s*[: ]?\s*(\d{3})\b/i.exec(detail)?.[1]);
  if([401,403,404].includes(status))return '更新服务暂时无法访问。请确认发布仓库可公开读取，然后重新检查。';
  if(status>=500)return '更新服务暂时不可用，请稍后重新检查。';
  return '检查或下载更新失败，请检查网络后重试。';
}

module.exports={releaseNotesText,updateErrorMessage};
