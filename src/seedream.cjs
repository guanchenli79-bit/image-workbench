const PROFILES = {
  '5-5-261028': ['5.5', ['1K','1.5K','2K'], true],
  '5-0-pro-260628': ['5.0 Pro', ['1K','1.5K','2K'], true],
  '5-0-flash-260915': ['5.0 Flash', ['1K','1.5K','2K'], true],
  '5-0-260128': ['5.0 Lite', ['2K','3K'], false],
  '5-0-lite-260128': ['5.0 Lite', ['2K','3K'], false],
  '4-5-251128': ['4.5', ['2K','4K'], false],
  '4-0-260415': ['4.0', ['1K','2K','4K'], false],
  '4-0-20260415': ['4.0', ['1K','2K','4K'], false],
  '4-0-250828': ['4.0', ['1K','2K','4K'], false]
};
const RATIOS = ['1:1','4:3','3:4','16:9','9:16','3:2','2:3','21:9'];
const SIZES = {
  '1K':   ['1024x1024','1152x864','864x1152','1280x720','720x1280','1248x832','832x1248','1512x648'],
  '1.5K': ['1536x1536','1792x1344','1344x1792','2048x1152','1152x2048','1872x1248','1248x1872','2352x1008'],
  '2K':   ['2048x2048','2368x1776','1776x2368','2816x1584','1584x2816','2496x1664','1664x2496','3136x1344'],
  '3K':   ['3072x3072','3520x2640','2640x3520','4096x2304','2304x4096','3744x2496','2496x3744','4704x2016'],
  '4K':   ['4096x4096','4672x3504','3504x4672','5440x3060','3060x5440','4992x3328','3328x4992','6216x2664']
};

function seedreamSpec(entry) {
  const id = String(entry?.id || '');
  const profile = id.startsWith('doubao-seedream-') && PROFILES[id.slice('doubao-seedream-'.length)];
  if (!Array.isArray(profile)) return null;
  const [version, resolutions, nativeOutputFormat] = profile;
  const modalities = entry?.modalities?.input_modalities;
  return {id,label:'Seedream ' + version,family:'Seedream',adapter:'ark-image',ratios:RATIOS,
    resolutions,defaultResolution:'2K',refs:!Array.isArray(modalities) || !modalities.length || modalities.includes('image'),
    nativeOutputFormat};
}

function seedreamSize(resolution, ratio) {
  return SIZES[resolution]?.[RATIOS.indexOf(ratio)];
}
module.exports = {seedreamSpec, seedreamSize};
