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

function generatedReferenceFile(records, id, index, now=Date.now()) {
  const record=records.find(item=>item.id===id);
  if(record?.type!=='image' || record.status!=='complete' || !Number.isFinite(record.expiresAt) || now>=record.expiresAt)
    throw new Error('这张生成图片已过期或不可用，请重新生成');
  if(!Array.isArray(record.files) || !Number.isInteger(index) || index<0 || index>=record.files.length)
    throw new Error('找不到这张生成图片');
  const name=record.files[index];
  if(typeof name!=='string' || path.basename(name)!==name || !MIME_BY_EXTENSION[path.extname(name).toLowerCase()])
    throw new Error('这张生成图片的格式不支持作为参考图');
  return name;
}

function prepareGeneratedReference(name, bytes, nativeImage) {
  if(bytes.length<=MAX_REFERENCE_BYTES)return prepareReference(name,bytes);
  const image=nativeImage.createFromBuffer(bytes);
  if(image.isEmpty())throw new Error('生成图片无法作为参考图打开');
  for(const quality of [95,88,78,68]) {
    const jpeg=image.toJPEG(quality);
    if(jpeg.length<=MAX_REFERENCE_BYTES)return prepareReference(`${path.parse(name).name}.jpg`,jpeg);
  }
  const size=image.getSize();
  const scale=Math.min(1,4096/Math.max(size.width,size.height));
  const reduced=image.resize({width:Math.max(1,Math.floor(size.width*scale)),height:Math.max(1,Math.floor(size.height*scale))});
  const jpeg=reduced.toJPEG(78);
  if(jpeg.length<=MAX_REFERENCE_BYTES)return prepareReference(`${path.parse(name).name}.jpg`,jpeg);
  throw new Error('生成图片过大，无法放入参考图区域');
}

module.exports = {prepareReference,prepareGeneratedReference,generatedReferenceFile,MAX_REFERENCE_BYTES,MAX_REFERENCES};
