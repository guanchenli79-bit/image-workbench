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

module.exports={releaseNotesText};
