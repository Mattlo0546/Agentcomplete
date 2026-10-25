const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function worker() {
  let listener;
  const calls = [];
  const runtime = {id:'test-extension',getURL:file=>'chrome-extension://test-extension/'+file,onMessage:{addListener:fn=>{listener=fn;}}};
  const context = {chrome:{runtime}, URL, AbortSignal, Set, Error, JSON,
    fetch: async (url, init) => {
      calls.push({url,init});
      if(url.endsWith('.runtime.json')) return {ok:true,json:async()=>({url:'http://127.0.0.1:7777',token:'local-capability'})};
      return {status:200,json:async()=>({autocomplete_enabled:true})};
    }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),context);
  return {calls, send(message,sender){return new Promise(resolve=>{const keep=listener(message,sender,resolve);if(keep!==true)resolve(undefined);});}};
}
const sender={id:'test-extension',url:'https://chatgpt.com/'};
test('isolated content script can use shared webapp API without exposing a credential',async()=>{
  const w=worker();
  const result=await w.send({type:'api',path:'/v1/settings',method:'GET'},sender);
  assert.equal(result.status,200);assert.equal(result.data.autocomplete_enabled,true);
  assert.equal(w.calls.length,2);assert.equal(w.calls[1].url,'http://127.0.0.1:7777/v1/settings');
  assert.equal(w.calls[1].init.headers.Authorization,'Bearer local-capability');
  assert.equal(JSON.stringify(result).includes('local-capability'),false);
});
test('untrusted senders and arbitrary network paths cannot call the bridge',async()=>{
  const w=worker();
  assert.equal(await w.send({type:'api',path:'/v1/settings'}, {...sender,id:'other-extension'}),undefined);
  assert.equal(await w.send({type:'api',path:'/v1/settings'}, {...sender,url:'https://example.com/'}),undefined);
  assert.equal(w.calls.length,0);
  for(const route of ['https://example.com/v1/settings','/v1/../settings','/v1/settings#fragment','/v1/not-a-route']){
    const result=await w.send({type:'api',path:route},sender);
    assert.equal(result.status,403);
  }
  assert.equal(w.calls.length,0);
});
test('unsupported mutation method is rejected before fetching runtime config',async()=>{
  const w=worker();
  const result=await w.send({type:'api',path:'/v1/settings',method:'DELETE'},sender);
  assert.equal(result.status,403);assert.equal(w.calls.length,0);
});
