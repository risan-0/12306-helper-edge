const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const source = fs.readFileSync(path.join(__dirname,'../background.js'),'utf8');
function createWorker(session) {
  let listener;
  const event = {addListener:()=>{}};
  const chrome = {
    runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>{listener=fn;}}},
    storage:{session:{get:async key=>({[key]:structuredClone(session[key])}),set:async obj=>Object.assign(session,structuredClone(obj))}},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}},
    tabs:{onRemoved:event,sendMessage:async()=>{}},webRequest:{onBeforeRequest:event,onCompleted:event,onErrorOccurred:event},
    notifications:{onClicked:event,create:async()=>{}},
  };
  vm.runInNewContext(source,{chrome,importScripts:()=>{},crypto,URL,console});
  return (msg,sender) => new Promise(resolve=>listener(msg,sender,resolve));
}
const owner = {id:'test',tab:{id:1},frameId:0,url:'https://kyfw.12306.cn/otn/leftTicket/init'};
function initial() {return {run:{id:'r1',tabId:1,active:true,config:{trains:['G101']},locks:{}}};}
test('confirm after quiet notice is once-only and forbidden if a confirmation request was already observed',async()=>{
  for(const seen of [false,true]){
    const state=initial();state.run.locks={book:1,submit:2,confirm:3,quietNotice:4};state.run.confirmRequestSeen=seen;
    const call=createWorker(state),m={type:'CLAIM',id:'r1',action:'confirmAfterQuiet'};
    assert.equal((await call(m,owner)).granted,!seen);assert.equal((await call(m,owner)).granted,false);
  }
});
test('all-trains task permits a valid dynamically selected train but rejects malformed codes',async()=>{
  const state=initial();state.run.config.trains=[];const call=createWorker(state);
  assert.equal((await call({type:'CLAIM',id:'r1',action:'book',train:'???'},owner)).ok,false);
  assert.equal((await call({type:'CLAIM',id:'r1',action:'book',train:'G999'},owner)).granted,true);
});
test('parallel booking claims grant only one click; survives worker recreation',async()=>{
  const state=initial(); let call=createWorker(state);
  const message={type:'CLAIM',id:'r1',action:'book',train:'G101'};
  const claims=await Promise.all([call(message,owner),call(message,owner)]);
  assert.equal(claims.filter(x=>x.granted).length,1);
  call=createWorker(state);
  assert.equal((await call(message,owner)).granted,false);
});
test('stopping and messages from other tabs cannot cause another click',async()=>{
  const state=initial(); const call=createWorker(state);
  const m={type:'CLAIM',id:'r1',action:'book',train:'G101'};
  assert.equal((await call(m,{...owner,tab:{id:2}})).ok,false);
  assert.equal((await call({...m,id:'stale'},owner)).ok,false);
  await call({type:'STOP',id:'r1'},owner);
  assert.equal((await call(m,owner)).granted,false);
});
test('cannot confirm before submission or submit before booking',async()=>{
  const call=createWorker(initial());
  assert.equal((await call({type:'CLAIM',id:'r1',action:'submit'},owner)).granted,false);
  assert.equal((await call({type:'CLAIM',id:'r1',action:'confirm'},owner)).granted,false);
});

test('confirmation retry is once-only and prohibited after any order processing request',async()=>{
  for(const activity of [0,2,3,4]){
    const state=initial();state.run.locks={book:1,submit:2,confirm:3};state.run.orderActivityAt=activity;
    const call=createWorker(state),m={type:'CLAIM',id:'r1',action:'confirmRetry'};
    assert.equal((await call(m,owner)).granted,activity<3);
    assert.equal((await call(m,owner)).granted,false);
  }
});
