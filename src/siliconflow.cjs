const QWEN_SIZES = {
  '1:1':'1328x1328','16:9':'1664x928','9:16':'928x1664','4:3':'1472x1140',
  '3:4':'1140x1472','3:2':'1584x1056','2:3':'1056x1584'
};
const KOLORS_SIZES = {'1:1':'1024x1024','3:4':'960x1280','1:2':'720x1440','9:16':'720x1280'};

function siliconFlowSpec(id) {
  const qwenEdit = ['Qwen/Qwen-Image-Edit','Qwen/Qwen-Image-Edit-2509'].includes(id);
  let sizes;
  let maxRefs;
  if (qwenEdit) maxRefs = id.endsWith('-2509') ? 3 : 1;
  else if (id === 'Qwen/Qwen-Image') sizes = QWEN_SIZES;
  else if (id === 'Kwai-Kolors/Kolors') { sizes = KOLORS_SIZES; maxRefs = 1; }
  else return null;
  return {id,label:id,family:'硅基流动',adapter:'siliconflow-image',refs:Boolean(maxRefs),
    requiredRefs:qwenEdit,maxRefs,defaultSizing:!sizes,ratios:sizes?Object.keys(sizes):['1:1'],
    resolutions:['default'],imageSizes:sizes};
}
module.exports = {siliconFlowSpec};
