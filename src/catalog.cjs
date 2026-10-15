const imageModels = [
  { id: 'gpt-image-2-vip', label: 'GPT Image 2 VIP', family: 'GPT Image', adapter: 'images', refs: true, ratios: ['1:1','4:3','3:4','3:2','2:3','16:9','9:16','21:9'] },
  { id: 'gpt-image-2', label: 'GPT Image 2', family: 'GPT Image', adapter: 'images', refs: true, ratios: ['1:1','4:3','3:2','2:3','16:9','9:16'] },
  { id: 'gpt-image-2-pro', label: 'GPT Image 2 Pro', family: 'GPT Image', adapter: 'images', refs: true, ratios: ['1:1','4:3','3:4','3:2','2:3','16:9','9:16'] },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', family: 'GPT Image', adapter: 'images', refs: true, ratios: ['1:1','4:3','3:2','2:3','16:9','9:16'] },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', family: 'GPT Image', adapter: 'images', refs: true, ratios: ['1:1','4:3','3:2','2:3','16:9','9:16'] },
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image', family: 'Gemini', adapter: 'gemini', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'] },
  { id: 'gemini-2.5-flash-image-preview', label: 'Gemini 2.5 Flash Image', family: 'Gemini', adapter: 'gemini', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'] },
  { id: 'gemini-3.1-flash-image-preview', label: 'Gemini 3.1 Flash Image', family: 'Gemini', adapter: 'gemini', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'] },
  { id: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite', family: 'Gemini', adapter: 'gemini', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'] },
  { id: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0', family: 'Seedream', adapter: 'images', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'] },
  { id: 'seedream-4-0-250828', label: 'Seedream 4.0（别名）', family: 'Seedream', adapter: 'images', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'] },
  { id: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5', family: 'Seedream', adapter: 'images', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'] },
  { id: 'doubao-seedream-5-0-260128', label: 'Seedream 5.0', family: 'Seedream', adapter: 'images', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'] },
  { id: 'grok-4-2-image', label: 'Grok 4.2 Image', family: 'Grok', adapter: 'images', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'] },
  { id: 'image2', label: 'Image2', family: 'OpenAI OG', adapter: 'task-image', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3'] },
  { id: 'image2-low', label: 'Image2 Low', family: 'OpenAI OG', adapter: 'task-image', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3'] },
  { id: 'image2-medium', label: 'Image2 Medium', family: 'OpenAI OG', adapter: 'task-image', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3'] },
  { id: 'image2-high', label: 'Image2 High', family: 'OpenAI OG', adapter: 'task-image', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3'] },
  { id: 'image2-high-2k', label: 'Image2 High 2K', family: 'OpenAI OG', adapter: 'task-image', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3'] },
  { id: 'GG-2.5', label: 'GG 2.5', family: 'Gemini GG', adapter: 'task-image', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3'] },
  { id: 'GG-3.0', label: 'GG 3.0', family: 'Gemini GG', adapter: 'task-image', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3'] },
  { id: 'GG-3.1', label: 'GG 3.1', family: 'Gemini GG', adapter: 'task-image', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3'] },
  { id: 'gg-3.1-4k', label: 'GG 3.1 4K', family: 'Gemini GG', adapter: 'task-image', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3'] },
  { id: 'gpt-image-1', label: 'GPT Image 1', family: 'OpenAI Images', adapter: 'legacy-images', refs: true, ratios: ['1:1','3:2','2:3'] },
  { id: 'dall-e-3', label: 'DALL·E 3', family: 'OpenAI Images', adapter: 'legacy-images', refs: false, ratios: ['1:1','3:2','2:3'] },
  { id: 'dall-e-2', label: 'DALL·E 2', family: 'OpenAI Images', adapter: 'legacy-images', refs: true, ratios: ['1:1'] },
  { id: 'midjourney', label: 'Midjourney Imagine', family: 'Midjourney', adapter: 'midjourney', refs: true, ratios: ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'] }
];

const videoModels = [
  { id:'sora-2', label:'Sora 2', family:'Sora', adapter:'video', refs:true, ratios:['16:9','9:16'], seconds:[4,8,12] },
  { id:'sora-2-pro', label:'Sora 2 Pro', family:'Sora', adapter:'video', refs:true, ratios:['16:9','9:16'], seconds:[4,8,12] },
  { id:'veo_3_1', label:'Veo 3.1', family:'Veo', adapter:'video', refs:true, ratios:['16:9','9:16'], seconds:[4,8] },
  { id:'veo_3_1-fast', label:'Veo 3.1 Fast', family:'Veo', adapter:'video', refs:true, ratios:['16:9','9:16'], seconds:[4,8] },
  { id:'grok-imagine-video', label:'Grok Imagine Video', family:'Grok', adapter:'video', refs:true, ratios:['16:9','9:16','1:1'], seconds:[4,6,8,10,12,15] },
  { id:'grok-imagine-video-1.5-preview', label:'Grok Imagine 1.5', family:'Grok', adapter:'video', refs:true, ratios:['16:9','9:16','1:1'], seconds:[4,6,8,10,12,15] },
  { id:'omni-fast', label:'Omni Fast', family:'Omni', adapter:'video', refs:true, ratios:['16:9','9:16','1:1'], seconds:[4,8,12,15] },
  { id:'MiniMax-H3', label:'MiniMax H3', family:'MiniMax', adapter:'video', refs:true, ratios:['16:9','9:16','1:1','21:9','4:3','3:4'], seconds:[5,10,15] },
  { id:'manxue-2.5', label:'Manxue 2.5', family:'Manxue', adapter:'video', refs:true, requiredRefs:true, ratios:['1:1','3:4','4:3','9:16','16:9','21:9'], seconds:[30] },
  { id:'mini-2.0', label:'Mini 2.0', family:'Mini', adapter:'video', refs:true, ratios:['16:9','9:16'], seconds:[4,6,8,10,12,15] },
  { id:'wan3.0-video', label:'Wan 3.0', family:'Wan', adapter:'video', refs:true, ratios:['16:9','9:16','1:1','4:3','3:4'], seconds:[5,10,15,20,30] },
  { id:'wan3.0-video-prime', label:'Wan 3.0 Prime', family:'Wan', adapter:'video', refs:true, ratios:['16:9','9:16','1:1','4:3','3:4'], seconds:[5,10,15,20,30] },
  { id:'doubao-seedance-2-0-260128', label:'Seedance 2.0', family:'Seedance', adapter:'video', refs:true, ratios:['16:9','9:16','1:1','4:3','3:4'], seconds:[5,10,15] },
  { id:'doubao-seedance-2-0-fast-260128', label:'Seedance 2.0 Fast', family:'Seedance', adapter:'video', refs:true, ratios:['16:9','9:16','1:1','4:3','3:4'], seconds:[5,10,15] },
  { id:'manxue-2.0', label:'Manxue 2.0', family:'Manxue', adapter:'video', refs:true, ratios:['16:9','9:16','1:1'], seconds:[4,8,12,15] },
  { id:'Vidu-q3-pro', label:'Vidu Q3 Pro', family:'Vidu', adapter:'video', refs:true, ratios:['16:9','9:16'], seconds:[5,10] },
  { id:'Vidu-q3-turbo', label:'Vidu Q3 Turbo', family:'Vidu', adapter:'video', refs:true, ratios:['16:9','9:16'], seconds:[5,10] },
  { id:'Kling-3.0', label:'Kling 3.0', family:'Kling', adapter:'video', refs:true, ratios:['16:9','9:16'], seconds:[5,10] },
  { id:'Hailuo-2.3', label:'Hailuo 2.3', family:'Hailuo', adapter:'video', refs:true, ratios:['16:9','9:16'], seconds:[5,10] }
];

const presets = [
  ['auto','auto','自动识别'], ['1:1','1024x1024','1:1'], ['16:9','1672x941','16:9'],
  ['9:16','941x1672','9:16'], ['4:3','1443x1090','4:3'], ['3:4','1090x1443','3:4'],
  ['3:2','1536x1024','3:2'], ['2:3','1024x1536','2:3'], ['5:4','1408x1120','5:4'],
  ['4:5','1120x1408','4:5'], ['21:9','1920x832','21:9'], ['9:21','832x1920','9:21'],
  ['2:1','1792x896','2:1'], ['1:2','896x1792','1:2']
].map(([id,dimensions,label])=>({id,dimensions,label}));

module.exports = { imageModels, videoModels, presets };
