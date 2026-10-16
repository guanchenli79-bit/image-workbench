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
  if (/??|??|????|portrait|vertical|9\s*:\s*16/.test(p)) return '9:16';
  if (/??|??|??|???|landscape|cinematic|16\s*:\s*9/.test(p)) return '16:9';
  if (/??|???|square|1\s*:\s*1/.test(p)) return '1:1';
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
const pro = { '1:1':'2048x2048','4:3':'2048x1536','3:4':'1536x2048','3:2':'2048x1365','2:3':'1365x2048','16:9':'2048x1152','9:16':'1152x2048' };
const seedream = { '1:1':'2048x2048','16:9':'2560x1440','9:16':'1440x2560','4:3':'2304x1728','3:4':'1728x2304','3:2':'2496x1664','2:3':'1664x2496','21:9':'3024x1296' };
const legacy = { '1:1':'1024x1024','3:2':'1792x1024','2:3':'1024x1792' };

function resolveSize(model, presetId, prompt, reference) {
  const picked = presets.find(p=>p.id === presetId) || presets[0];
  const desired = picked.id === 'auto' ? autoRatio(prompt, reference) : picked.id;
  const actualRatio = closestRatio(desired, model.ratios);
  let size = null;
  if (model.adapter === 'images') {
    const table = model.id === 'gpt-image-2-vip' ? vip : model.id === 'gpt-image-2-pro' ? pro : /seedream|grok/.test(model.id) ? seedream : base;
    size = table[actualRatio];
  } else if (model.adapter === 'legacy-images') {
    size = legacy[actualRatio];
    if (model.id === 'dall-e-2') size = '1024x1024';
  } else if (model.adapter === 'task-image') {
    const [w,h] = picked.dimensions === 'auto' ? (base[actualRatio] || '1024x1024').split('x').map(Number) : picked.dimensions.split('x').map(Number);
    size = `${w}x${h}`;
  } else if (model.adapter === 'video') {
    size = actualRatio === '9:16' ? '720x1280' : actualRatio === '1:1' ? '1024x1024' : '1280x720';
  }
  return { requested: picked.dimensions, desiredRatio: desired, ratio: actualRatio, size,
    adjusted: desired !== actualRatio || (picked.id !== 'auto' && size && picked.dimensions !== size) };
}

module.exports = { autoRatio, closestRatio, resolveSize };
