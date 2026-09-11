// Run with PLAYWRIGHT_MODULE pointing to playwright when it is not installed locally.
// All requests made by the test pages are served from fixtures or aborted.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {chinaDate,seatTypes} = require('../core.js');
const ext = path.resolve(__dirname, '..');
const scratch = path.resolve(process.env.RAIL_TEST_WORK || 'work');
const date = chinaDate(Date.now() + 86400000);
const stats = [];
let scenario = {}, requests = 0, submitted = 0, confirmed = 0, preferencePayload;
function shell(body, script) { return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>本地模拟 12306</title><style>body{font:16px sans-serif;padding:30px}td{padding:16px}button,a,input,select{padding:9px;margin:5px}a{cursor:pointer;color:teal}#normal_passenger_id{padding:15px}.cdz strong{display:block}</style><body>${body}<script>${script}</script></body></html>`; }
function queryHTML() {
  return shell(`<h1>本地测试页面：不连接售票服务器</h1><input id="fromStationText"><input type="hidden" id="fromStation"><input id="toStationText"><input type="hidden" id="toStation"><input id="train_date"><input type="radio" id="dc" checked><input type="radio" id="sf1" checked><input type="checkbox" id="autoSubmit"><input type="checkbox" id="partSubmit"><a id="query_ticket">查询</a><table><tbody id="queryLeftTable"></tbody></table><div id="no_filter_ticket_2" style="display:none"></div><div id="no_filter_ticket_6" style="display:none"></div>${scenario.captcha ? '<div id="nc_1_n1z">请完成验证</div>' : ''}`,
  `document.querySelector('#query_ticket').onclick=async()=>{
    const params=new URLSearchParams({'leftTicketDTO.train_date':document.querySelector('#train_date').value,'leftTicketDTO.from_station':document.querySelector('#fromStation').value,'leftTicketDTO.to_station':document.querySelector('#toStation').value});
    const old=document.querySelector('#queryLeftTable');old.innerHTML='';
    const response=await fetch('/otn/leftTicket/query?'+params);
    if(!response.ok)return;
    const html=await response.text();old.outerHTML=html;
    document.querySelectorAll('.btn72').forEach(el=>el.onclick=()=>{sessionStorage.setItem('chosen',el.dataset.train);location.href='/otn/confirmPassenger/initDc';});
  };`);
}
function row(code, seats, from='VNP') {
  if(scenario.regular)code={G100:'K151',G101:'K152',G103:'K153'}[code]||code;
  const prefix=seatTypes.find(t=>t.key===(scenario.seatKey||'ZE')).prefixes[0];
  return `<tr id="ticket_${code}_01_02"><td><a class="number" id="24000${code}_${from}_AOH">${code}</a><div class="cdz"><strong>北京南</strong><strong>上海虹桥</strong></div></td><td id="${prefix}_${code}">${seats}</td><td><a class="btn72" data-train="${code}">预订</a></td></tr>`;
}
function orderHTML() {
  const names = scenario.duplicate ? ['张三','张三','李四'] : ['张三','李四'];
  const extraOption=scenario.seatKey==='YZ'?'<option value="1">硬座（10.0元）</option>':'';
  const preferences=scenario.preferences?`<div id="id-seat-sel"><div class="seat-sel-bd"><div class="sel-item">${['A','B','C','D','F'].map(letter=>`<a id="1${letter}" class="${scenario.preselected===letter?'cur':''}" onclick="this.classList.toggle('cur')">${letter}</a>`).join('')}</div></div></div><label for="quiet_test">请优先为我分配“静音车厢”席位</label><input type="checkbox" id="quiet_test">`:'';
  const quietNotice=scenario.quietNotice?`<div id="quiet_notice_test" style="display:none;position:fixed;inset:0;background:#fff;z-index:99999"><h2>温馨提示</h2><p>在静音车厢内须保持安静，将手机调至静音或振动状态，接打电话请离开静音车厢，使用电子设备佩戴耳机。</p><button id="quiet_ok_test" onclick="sessionStorage.setItem('quietAck','yes');this.parentElement.style.display='none'">确定</button></div>`:'';
  return shell(`<h1>确认乘车信息（本地模拟）</h1><ul id="normal_passenger_id">${names.map((n,i)=>`<li><input type="checkbox" id="normalPassenger_${i}"><label for="normalPassenger_${i}">${n}</label></li>`).join('')}</ul><table><tbody id="ticket_rows"></tbody></table><button id="submitOrder_id">提交订单</button><div id="confirm_box" style="display:none">${preferences}<button id="qr_submit_id">确认</button></div>${quietNotice}`,
  `window.ticketInfoForPassengerForm={orderRequestDTO:{station_train_code:sessionStorage.getItem('chosen'),from_station_telecode:'${scenario.wrongJourney ? 'BJP':'VNP'}',to_station_telecode:'AOH',train_date:{time:Date.parse('${date}T00:00:00+08:00')}}};
  document.querySelectorAll('#normal_passenger_id input').forEach((el,i)=>el.onchange=()=>{
    if(el.checked)document.querySelector('#ticket_rows').insertAdjacentHTML('beforeend','<tr><td>'+el.nextElementSibling.textContent+'</td><td><select id="seatType_'+i+'"><option value="M">一等座</option>${scenario.noSecond?'':'<option value="O">二等座（553.0元）</option>'}${extraOption}</select></td><td><select id="ticketType_'+i+'"><option>成人票</option></select></td></tr>');
  });
  document.querySelector('#submitOrder_id').onclick=async()=>{
    await fetch('/test/submit',{method:'POST',body:JSON.stringify([...document.querySelectorAll('[id^="seatType_"]')].map(el=>el.value))});
    document.querySelector('#confirm_box').style.display='block';
  };
  if(${scenario.quietNotice==='before'} && document.querySelector('#quiet_test'))document.querySelector('#quiet_test').onchange=()=>setTimeout(()=>document.querySelector('#quiet_notice_test').style.display='block',300);
  let confirmClicks=0;document.querySelector('#qr_submit_id').onclick=async()=>{
    confirmClicks++;sessionStorage.setItem('confirmClicks',String(confirmClicks));
    if(${!!scenario.ignoreConfirm} || (${!!scenario.ignoreFirstConfirm} && confirmClicks===1))return;
    if(${scenario.quietNotice==='after'} && sessionStorage.getItem('quietAck')!=='yes'){document.querySelector('#quiet_notice_test').style.display='block';return;}
    if(${!!scenario.quietNotice} && document.querySelector('#quiet_notice_test').style.display!=='none')throw Error('Clicked order through quiet overlay');
    await fetch('/otn/confirmPassenger/confirmSingleForQueue',{method:'POST',body:JSON.stringify({positions:[...document.querySelectorAll('#id-seat-sel a.cur')].map(el=>el.textContent),quiet:!!document.querySelector('#quiet_test')?.checked})});${scenario.stayQueue ? '' : "location.href='/otn/payOrder/init';"}};`);
}
(async()=>{
  fs.mkdirSync(scratch,{recursive:true});
  const context=await chromium.launchPersistentContext(path.join(scratch,'rail-tests-'+Date.now()),{
    channel:'msedge',headless:true,ignoreDefaultArgs:['--disable-extensions'],
    args:['--disable-extensions-except='+ext,'--load-extension='+ext],viewport:{width:1100,height:950}
  });
  try {
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const extensionUrl=worker.url().replace('background.js','');
    await context.route('https://**/*', async route=>{
      const url=new URL(route.request().url());
      if(url.hostname!=='kyfw.12306.cn')return route.abort();
      if(url.pathname==='/otn/leftTicket/init')return route.fulfill({contentType:'text/html',body:queryHTML()});
      if(url.pathname==='/otn/leftTicket/query'){
        requests++;
        if(scenario.slow)await new Promise(r=>setTimeout(r,1500));
        return route.fulfill({status:scenario.http||200,contentType:'text/plain',body:'<tbody id="queryLeftTable">'+row('G100','有')+row('G101','1')+row('G103','有')+'</tbody>'});
      }
      if(url.pathname==='/otn/confirmPassenger/initDc')return route.fulfill({contentType:'text/html',body:orderHTML()});
      if(url.pathname==='/test/submit'){
        submitted++;
        const code=scenario.seatKey==='ZY'?'M':scenario.seatKey==='YZ'?'1':'O';
        assert.deepEqual(JSON.parse(route.request().postData()),[code,code]);
        return route.fulfill({body:'ok'});
      }
      if(url.pathname==='/otn/confirmPassenger/confirmSingleForQueue'){confirmed++;preferencePayload=JSON.parse(route.request().postData());return route.fulfill({body:'ok'});}
      if(url.pathname==='/otn/payOrder/init')return route.fulfill({contentType:'text/html',body:shell('<h1>模拟订单待支付</h1>','')});
      return route.abort();
    });
    const popup=await context.newPage();
    popup.on('pageerror',e=>console.error('Popup error:',e.message));
    await popup.goto(extensionUrl+'popup.html');
    await popup.waitForSelector('#start:enabled');
    await popup.screenshot({path:path.join(scratch,'extension-popup.png'),clip:{x:0,y:0,width:410,height:900}});
    const config={from:'北京南',to:'上海虹桥',date,trains:'G101,G103',passengers:'张三,李四',saleTime:'',interval:10,duration:1,autoSubmit:true};
    const send=async(type,data={})=>popup.evaluate(async ({type,data})=>chrome.runtime.sendMessage({type,...data}),{type,data});
    const state=async()=> (await send('STATUS')).run;
    async function waitPhase(phase,timeout=15000){
      const deadline=Date.now()+timeout;
      while(Date.now()<deadline){const run=await state();if(run?.phase===phase)return run;if(run && !run.active && run.phase!==phase)throw Error('Unexpected state: '+JSON.stringify(run));await new Promise(r=>setTimeout(r,100));}
      throw Error('Timeout waiting '+phase+': '+JSON.stringify(await state())+' pages '+JSON.stringify(await Promise.all(context.pages().map(async p=>({url:p.url(),body:await p.locator('body').innerText().catch(()=>'?')})))));
    }
    async function start(options={},overrides={}){
      scenario=options;requests=0;submitted=0;confirmed=0;preferencePayload=null;
      await send('STOP');
      for(const p of context.pages())if(p!==popup)await p.close();
      await popup.bringToFront();
      const nextPage=context.waitForEvent('page');
      const response=await send('START',{config:{...config,...overrides},reviewed:true});
      assert.equal(response.ok,true,response.error);
      const task=await nextPage;
      task.on('pageerror',e=>console.error('Fixture page error:',e.message));
      return task;
    }
    async function record(name,fn){if(process.env.RAIL_TEST_FILTER && !new RegExp(process.env.RAIL_TEST_FILTER).test(name))return;await fn();stats.push(name);console.log('PASS',name);}
    await record('all 17 seat classes read the correct column and select only the matching order option',async()=>{
      const page=await context.newPage();await page.goto('about:blank');
      await page.addScriptTag({path:path.join(ext,'core.js')});await page.addScriptTag({path:path.join(ext,'adapter.js')});
      await page.evaluate(()=>{
        for(const seat of RailCore.seatTypes){
          const prefix=seat.prefixes[0];
          document.body.innerHTML=`<table><tbody id="queryLeftTable"><tr id="ticket_t"><td><a class="number" id="train_VNP_AOH">G100</a></td><td id="${prefix}_t">有</td><td><a class="btn72">预订</a></td></tr></tbody></table><select id="seatType_1"><option>错误席别</option><option>${seat.name}（100元）</option></select><select id="ticketType_1"><option>成人票</option></select>`;
          const config={seatKey:seat.key};if(RailDOM.rows(config)[0].seats!=='有')throw Error(seat.name+' column');
          RailDOM.selectSeatClass(1,config);RailDOM.assertSeats(1,config);
          if(!document.querySelector('#seatType_1').value.startsWith(seat.name))throw Error(seat.name+' option');
        }
      });await page.close();
    });
    await record('complete simulated journey: exact train, enough second-class seats, one submit, one confirm',async()=>{
      const task=await start();const run=await waitPhase('done');
      assert.equal(run.train,'G103');assert.equal(submitted,1);assert.equal(confirmed,1);assert.equal(requests,1);
      await task.screenshot({path:path.join(scratch,'simulated-payment.png')});
    });
    await record('practice mode stops after selecting seats',async()=>{await start({}, {autoSubmit:false});await waitPhase('prepared');assert.equal(submitted,0);assert.equal(confirmed,0);});
    await record('aisle C/D and quiet checkbox are selected before confirming',async()=>{
      await start({preferences:true,preselected:'A'});await waitPhase('done');
      assert.deepEqual(preferencePayload,{positions:['C','D'],quiet:true});assert.equal(confirmed,1);
    });
    for(const when of ['before','after'])await record('quiet notice '+when+' confirm is acknowledged before a single order request',async()=>{
      const task=await start({preferences:true,quietNotice:when});await waitPhase('done',20000);
      assert.equal(await task.evaluate(()=>sessionStorage.getItem('quietAck')),'yes');
      assert.equal(submitted,1);assert.equal(confirmed,1);assert.deepEqual(preferencePayload,{positions:['C','D'],quiet:true});
    });
    await record('window preference and quiet opt-out are respected',async()=>{
      await start({preferences:true},{position:'AF',quiet:false});await waitPhase('done');
      assert.deepEqual(preferencePayload,{positions:['A','F'],quiet:false});
    });
    await record('insufficient preferred positions use no partial selection',async()=>{
      await start({preferences:true},{position:'C'});await waitPhase('done');
      assert.deepEqual(preferencePayload,{positions:[],quiet:true});
    });
    await record('first class is purchased only when explicitly selected',async()=>{
      await start({seatKey:'ZY'},{seatKey:'ZY'});await waitPhase('done');assert.equal(submitted,1);
    });
    await record('hard-seat class on a regular train is supported',async()=>{
      await start({seatKey:'YZ',regular:true},{seatKey:'YZ',trains:'K151'});const run=await waitPhase('done');assert.equal(run.train,'K151');assert.equal(submitted,1);
    });
    await record('panel can minimize, hide and reopen without stopping the active task',async()=>{
      const saleTime=new Date(Date.now()+8*3600000+60000).toISOString().slice(0,19);
      const task=await start({}, {saleTime});await waitPhase('waiting');
      await task.getByRole('button',{name:'缩小面板',exact:true}).click();
      await task.getByRole('button',{name:'展开购票面板',exact:true}).waitFor({state:'visible'});
      assert.equal((await state()).active,true);
      await task.getByRole('button',{name:'展开购票面板',exact:true}).click();
      await task.getByRole('button',{name:'关闭面板',exact:true}).click();
      await task.locator('#rail-helper-panel').waitFor({state:'hidden'});assert.equal((await state()).active,true);
      await popup.locator('#showPanel').click();await task.locator('#rail-helper-panel').waitFor({state:'visible'});
      assert.equal((await state()).active,true);await send('STOP');
    });
    await record('blank target from popup selects first eligible train and submits once',async()=>{
      await send('STOP');
      await popup.locator('#trains').fill('');
      assert.equal(await popup.locator('#trains').evaluate(el=>el.required),false);
      await start({}, {trains:''});const run=await waitPhase('done');
      assert.equal(run.train,'G100');assert.equal(submitted,1);assert.equal(confirmed,1);
    });
    await record('wrong journey cannot submit',async()=>{await start({wrongJourney:true});const run=await waitPhase('paused');assert.match(run.text,/车次、日期和区间/);assert.equal(submitted,0);});
    await record('ambiguous passenger names cannot submit',async()=>{await start({duplicate:true});const run=await waitPhase('paused');assert.match(run.text,/唯一匹配/);assert.equal(submitted,0);});
    await record('first class cannot replace unavailable second class',async()=>{await start({noSecond:true});const run=await waitPhase('paused');assert.match(run.text,/没有可选二等座/);assert.equal(submitted,0);});
    await record('captcha pauses before querying',async()=>{await start({captcha:true});await waitPhase('paused');assert.equal(requests,0);});
    await record('HTTP 429 pauses instead of retrying',async()=>{await start({http:429});await waitPhase('paused');assert.equal(requests,1);assert.equal(submitted,0);});
    await record('stop while a response is pending prevents booking',async()=>{
      await start({slow:true});await waitPhase('querying');await new Promise(r=>setTimeout(r,300));await send('STOP');await new Promise(r=>setTimeout(r,1800));assert.equal((await state()).locks.book,undefined);assert.equal(submitted,0);
    });
    await record('real manual edits pause while automatic checkbox events do not',async()=>{
      const task=await start({slow:true});await waitPhase('querying');
      await task.locator('#fromStationText').fill('天津南');await task.locator('#train_date').focus();
      const run=await waitPhase('paused');assert.match(run.text,/修改了购票条件/);
      await new Promise(r=>setTimeout(r,1600));assert.equal(submitted,0);assert.equal((await state()).locks.book,undefined);
    });
    await record('a second start cannot run concurrently',async()=>{
      await start({slow:true});await waitPhase('querying');
      const response=await send('START',{config,reviewed:true});assert.equal(response.ok,false);assert.match(response.error,/已有任务/);
      await send('STOP');
    });
    await record('query starts at configured Beijing sale time',async()=>{
      const saleAt=Date.now()+3500;
      const local=new Date(saleAt+8*3600000).toISOString().slice(0,19);
      await start({}, {saleTime:local});await waitPhase('waiting');assert.equal(requests,0);await waitPhase('done');assert.equal(requests,1);
    });
    await record('inert first confirmation is retried once and reaches payment',async()=>{
      const task=await start({preferences:true,quietNotice:'before',ignoreFirstConfirm:true});await waitPhase('done',25000);
      assert.equal(confirmed,1);assert.equal(await task.evaluate(()=>sessionStorage.getItem('confirmClicks')),'2');
    });
    await record('unresponsive confirmation pauses after one retry without claiming queue success',async()=>{
      const task=await start({ignoreConfirm:true});await waitPhase('paused',25000);
      assert.equal(confirmed,0);assert.equal(await task.evaluate(()=>sessionStorage.getItem('confirmClicks')),'2');
    });
    await record('reloading after submission never repeats order submission',async()=>{
      const task=await start({stayQueue:true});await waitPhase('queue');assert.equal(submitted,1);assert.equal(confirmed,1);
      await task.reload();const run=await waitPhase('paused');assert.match(run.text,/不会重复提交/);assert.equal(submitted,1);assert.equal(confirmed,1);
    });
    fs.writeFileSync(path.join(scratch,'browser-results.json'),JSON.stringify({testedAt:new Date().toISOString(),browser:context.browser().version(),passed:stats,realOrders:false},null,2));
    console.log(stats.length+' browser scenarios passed. No real orders or live ticket requests.');
  } finally {await context.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
