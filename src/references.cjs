const path = require('node:path');

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;
const MAX_REFERENCES = 10;
const MIME_BY_EXTENSION = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};

function prepareReference(name, bytes) {
  const safeName = path.basename(String(name || ''));
  const mime = MIME_BY_EXTENSION[path.extname(safeName).toLowerCase()];
  if (!mime) throw new Error('参考图仅支持 PNG、JPG、WEBP 格式');
  const buffer = Buffer.from(bytes || []);
  if (!buffer.length || buffer.length > MAX_REFERENCE_BYTES) throw new Error('单张参考图必须小于 10 MB 且不能为空');
  const png = buffer.length >= 8 && buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  const jpeg = buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const webp = buffer.length >= 12 && buffer.toString('ascii',0,4) === 'RIFF' && buffer.toString('ascii',8,12) === 'WEBP';
  if (!(mime === 'image/png' && png || mime === 'image/jpeg' && jpeg || mime === 'image/webp' && webp)) {
    throw new Error(`${safeName} 不是有效的 ${path.extname(safeName).slice(1).toUpperCase()} 图片`);
  }
  return {name:safeName,mime,buffer};
}

module.exports = {prepareReference,MAX_REFERENCE_BYTES,MAX_REFERENCES};
