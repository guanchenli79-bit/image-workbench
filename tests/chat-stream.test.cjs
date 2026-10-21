const test=require('node:test');
const assert=require('node:assert/strict');
const {readChatResponse}=require('../src/chat-stream.cjs');

test('流式回答分别接收思考与正文，允许事件跨网络数据块',async()=>{
  const chunks=[
    'data: {"choices":[{"delta":{"reasoning_content":"先比较"}}]}\n\n',
    'data: {"choices":[{"delta":{"reasoning_content":"两个条件"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"结"}}]}\n',
    '\ndata: {"choices":[{"delta":{"content":"论"}}]}\n\ndata: [DONE]\n\n'
  ];
  const body=new ReadableStream({start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));controller.close();}});
  const updates=[];
  const result=await readChatResponse(new Response(body,{headers:{'content-type':'text/event-stream'}}),part=>updates.push(part));
  assert.deepEqual(result,{answer:'结论',reasoning:'先比较两个条件'});
  assert.equal(updates.at(-1).answer,'结论');
});

test('非流式兼容响应仍能读取正文',async()=>{
  const response=new Response(JSON.stringify({choices:[{message:{content:'完成'}}]}),{headers:{'content-type':'application/json'}});
  const result=await readChatResponse(response);
  assert.equal(result.answer,'完成');
});
