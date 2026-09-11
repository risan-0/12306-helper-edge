const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');
const stations = require('../stations.json');
const now = Date.parse('2026-09-10T10:00:00+08:00');
const input = {from:'北京南',to:'上海虹桥',date:'2026-09-20',trains:'G101,G103',passengers:'张三,李四',interval:15,duration:30,autoSubmit:true};
test('blank or missing target accepts all trains but preserves route, capacity and second-class constraints', () => {
  for (const trains of ['', '  ', undefined]) {
    const config=C.validate({...input,trains},stations,now);
    assert.deepEqual(config.trains,[]);
    const row={code:'G999',fromCode:'VNP',toCode:'AOH',bookable:true,seats:'有'};
    assert.equal(C.choose([{...row,fromCode:'BJP'},{...row,seats:'1'},{...row,seats:'无'},row],config),row);
    assert.equal(C.choose([{...row,seats:'候补'}],config),null);
    assert.equal(C.choose([{...row,code:'D100'},row],config).code,'D100');
  }
});
test('Shanghai city search showing Shanghai Hongqiao is diagnosed as a station mismatch, not sold out', () => {
  const config=C.validate({...input,from:'上海',to:'长沙南',trains:'G1321'},stations,now);
  const rows=[{code:'G1321',from:'上海虹桥',to:'长沙南',fromCode:'AOH',toCode:'CWQ',seats:'有',bookable:true}];
  assert.equal(C.choose(rows,config),null);
  const reason=C.explainNoMatch(rows,config);
  assert.equal(reason.pause,true);assert.match(reason.text,/车站不一致/);assert.match(reason.text,/上海虹桥/);
  const fixed=C.validate({...input,from:'上海虹桥',to:'长沙南',trains:'G1321'},stations,now);
  assert.equal(C.choose(rows,fixed).code,'G1321');
});
test('missing train, unreadable seats and unavailable booking button have different explanations', () => {
  const config=C.validate(input,stations,now);
  const row={code:'G101',fromCode:'VNP',toCode:'AOH',bookable:true,seats:'有'};
  assert.match(C.explainNoMatch([],config).text,/未找到指定车次/);
  assert.match(C.explainNoMatch([{...row,seats:''}],config).text,/无法读取二等座/);
  assert.match(C.explainNoMatch([{...row,bookable:false}],config).text,/预订按钮/);
});
test('validates station codes, passenger count and target trains', () => {
  const c = C.validate(input, stations, now);
  assert.equal(c.from.code,'VNP'); assert.equal(c.to.code,'AOH');
  assert.deepEqual(c.passengers,['张三','李四']);
  for (const invalid of [{from:'北京南站'}, {date:'2026-09-09'}, {date:'2026-02-30'}, {trains:'GABC'}, {interval:0}, {interval:9}, {duration:121}, {passengers:''}, {seatKey:'invalid'}, {position:'Z'}]) {
    assert.throws(() => C.validate({...input,...invalid}, stations, now));
  }
});
test('supports all listed seat types, regular trains and default aisle/quiet preferences',()=>{
  for(const type of C.seatTypes){const c=C.validate({...input,seatKey:type.key,trains:'K151,1461'},stations,now);assert.equal(C.seatName(c),type.name);assert.equal(c.position,'CD');assert.equal(c.quiet,true);}
  const c=C.validate({...input,position:'auto',quiet:false},stations,now);assert.equal(c.quiet,false);assert.equal(c.position,'auto');
});
test('parses sale time as Beijing time regardless of computer zone', () => {
  const c = C.validate({...input,saleTime:'2026-09-10T12:30:01'}, stations, now);
  assert.equal(c.saleAt,Date.parse('2026-09-10T04:30:01Z'));
  assert.equal(C.chinaDate(Date.parse('2026-09-09T17:00:00Z')),'2026-09-10');
});
test('requires seated second-class availability for the whole group', () => {
  for (const seats of ['无','候补','--','无座','1','有候补','99+']) assert.equal(C.hasSeats(seats,2),false);
  assert.equal(C.hasSeats('有',2),true); assert.equal(C.hasSeats('2',2),true);
});
test('matches exact train and station codes, respecting configured preference', () => {
  const config=C.validate(input,stations,now);
  const row={code:'G101',fromCode:'VNP',toCode:'AOH',bookable:true,seats:'2'};
  assert.equal(C.choose([{...row,code:'G103'},row],config).code,'G101');
  assert.equal(C.choose([{...row,code:'G1010'},{...row,fromCode:'BJP'},{...row,seats:'1'},{...row,bookable:false}],config),null);
});
test('refuses wrong order date, train or route and missing journey data', () => {
  const config=C.validate(input,stations,now);
  const j={train:'G101',date:'2026-09-20',from:'VNP',to:'AOH'};
  C.assertJourney(j,config,'G101');
  for (const bad of [null,{...j,train:'G103'},{...j,date:'2026-09-21'},{...j,from:'BJP'},{...j,to:'SHH'}]) assert.throws(()=>C.assertJourney(bad,config,'G101'));
});
