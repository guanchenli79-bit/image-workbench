const { presets } = require('./catalog.cjs');

function numberForRatio(ratio) {
  const [w,h] = ratio.split(':').map(Number);
  return w / h;
}

function autoRatio(prompt, reference) {
  if (reference?.width && reference?.height) {
    const r = reference.width / reference.height;
    if (r > 1.55) return '16:9';
    if (r < 0.65) return '9:16';
    if (r > 1.16) return '4:3';
    if (r < 0.86) return '3:4';
    return '1:1';
  }
  const p = String(prompt || '').toLowerCase();
  if (/竖屏|纵向|手机壁纸|portrait|vertical|9\s*:\s*16/.test(p)) return '9:16';
  if (/横屏|横版|宽屏|电影感|landscape|cinematic|16\s*:\s*9/.test(p)) return '16:9';
  if (/方形|正方形|square|1\s*:\s*1/.test(p)) return '1:1';
  return '1:1';
}

function closestRatio(wanted, available) {
  const target = numberForRatio(wanted);
  return available.reduce((best, candidate) =>
    Math.abs(Math.log(numberForRatio(candidate) / target)) < Math.abs(Math.log(numberForRatio(best) / target)) ? candidate : best
  );
}

const base = { '1:1':'1024x1024','4:3':'1536x1152','3:2':'1536x1024','2:3':'1024x1536','16:9':'1920x1080','9:16':'1080x1920' };
const vip = { '1:1':'1024x1024','4:3':'1024x768','3:4':'768x1024','3:2':'1008x672','2:3':'672x1008','16:9':'1280x720','9:16':'720x1280','21:9':'1344x576' };
const vip2K = { '1:1':'2048x2048','4:3':'2304x1728','3:4':'1728x2304','3:2':'2496x1664','2:3':'1664x2496','16:9':'2560x1440','9:16':'1440x2560','21:9':'3024x1296' };
const vip4K = { '1:1':'2880x2880','4:3':'3264x2448','3:4':'2448x3264','3:2':'3504x2336','2:3':'2336x3504','16:9':'3840x2160','9:16':'2160x3840','21:9':'3808x1632' };
const pro2K = { '1:1':'2048x2048','4:3':'2048x1536','3:4':'1536x2048','3:2':'2560x1712','2:3':'1712x2560','16:9':'2048x1152','9:16':'1152x2048' };
const pro4K = { '1:1':'2880x2880','4:3':'3840x2880','3:4':'2880x3840','3:2':'3840x2560','2:3':'2560x3840','16:9':'3840x2160','9:16':'2160x3840' };
const seedream = { '1:1':'2048x2048','16:9':'2560x1440','9:16':'1440x2560','4:3':'2304x1728','3:4':'1728x2304','3:2':'2496x1664','2:3':'1664x2496','21:9':'3024x1296' };
const legacy = { '1:1':'1024x1024','3:2':'1792x1024','2:3':'1024x1792' };
const grsaiSizes = {
  '1:1':['1024x1024','2048x2048','2880x2880'],
  '16:9':['1280x720','2048x1152','3840x2160'],
  '9:16':['720x1280','1152x2048','2160x3840'],
  '4:3':['1152x864','2304x1728','3264x2448'],
  '3:4':['864x1152','1728x2304','2448x3264'],
  '3:2':['1536x1024','2048x1360','3504x2336'],
  '2:3':['1024x1536','1360x2048','2336x3504'],
  '5:4':['1120x896','2240x1792','3200x2560'],
  '4:5':['896x1120','1792x2240','2560x3200'],
  '21:9':['1456x624','2912x1248','3840x1648'],
  '9:21':['624x1456','1248x2912','1648x3840'],
  '2:1':['1536x768','3072x1536','3840x1920'],
  '1:2':['768x1536','1536x3072','1920x3840']
};

function resolveSize(model, presetId, prompt, reference, resolutionId) {
  const picked = presets.find(p=>p.id === presetId) || presets[0];
  const desired = picked.id === 'auto' ? autoRatio(prompt, reference) : picked.id;
  const actualRatio = closestRatio(desired, model.ratios);
  const allowed = model.resolutions || ['default'];
  const resolution = resolutionId || model.defaultResolution || allowed[0];
  if (!allowed.includes(resolution)) throw new Error(`此模型不支持 ${resolution} 分辨率`);
  let size = null;
  if (model.adapter === 'grsai-image') {
    if(model.grsaiFamily==='gpt'&&model.resolutions.length>1)
      size=grsaiSizes[actualRatio]?.[['1K','2K','4K'].indexOf(resolution)]||null;
  } else if (model.adapter === 'images') {
    let table;
    if (model.id === 'gpt-image-2-vip') table = resolution === '4K' ? vip4K : resolution === '2K' ? vip2K : vip;
    else if (model.id === 'gpt-image-2-pro') table = resolution === '4K' ? pro4K : pro2K;
    else if (model.id.startsWith('gpt-image-2.5-')) table = resolution === '4K' ? pro4K : resolution === '2K' ? pro2K : base;
    else table = /seedream|grok/.test(model.id) ? seedream : base;
    size = table[actualRatio];
  } else if (model.adapter === 'legacy-images') {
    size = legacy[actualRatio];
    if(model.id.startsWith('gpt-image-1'))size={'1:1':'1024x1024','3:2':'1536x1024','2:3':'1024x1536'}[actualRatio];
    if (model.id === 'dall-e-2') size = '1024x1024';
  } else if (model.adapter === 'task-image') {
    size = resolution === '4K' ? vip4K[actualRatio] : resolution === '2K' ? pro2K[actualRatio] :
      picked.dimensions === 'auto' ? (base[actualRatio] || '1024x1024') : picked.dimensions;
  } else if (model.adapter === 'video') {
    size = actualRatio === '9:16' ? '720x1280' : actualRatio === '1:1' ? '1024x1024' : '1280x720';
  }
  return { requested: picked.dimensions, desiredRatio: desired, ratio: actualRatio, resolution, size,
    adjusted: desired !== actualRatio || (picked.id !== 'auto' && size && picked.dimensions !== size) };
}

module.exports = { autoRatio, closestRatio, resolveSize };
