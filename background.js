"use strict";
importScripts("core.js");
const QUERY_URL = "https://kyfw.12306.cn/otn/leftTicket/init";
let serial = Promise.resolve();
function queued(fn) {
  const next = serial.then(fn, fn);
  serial = next.catch(() => {});
  return next;
}
const getRun = async () => (await chrome.storage.session.get("run")).run;
async function save(run) {
  await chrome.storage.session.set({run});
  await chrome.action.setBadgeText({text: run.active ? "ON" : run.phase === "done" ? "票" : ""});
  await chrome.action.setBadgeBackgroundColor({color: "#087F8C"});
}
async function notify(message) {
  try { await chrome.notifications.create("rail-status", {type: "basic", iconUrl: "icon.png", title: "高铁出发", message}); } catch {}
}
const isPopup = sender => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(""));
function owns(sender, run, id) {
  return run && run.id === id && sender.tab?.id === run.tabId && sender.frameId === 0 && sender.url?.startsWith("https://kyfw.12306.cn/otn/");
}
async function readJourney(tabId) {
  const result = await chrome.scripting.executeScript({target: {tabId}, world: "MAIN", func: () => {
    // Read only these journey fields. Never return credentials, tokens or passenger documents.
    const info = typeof ticketInfoForPassengerForm !== "undefined" ? ticketInfoForPassengerForm : null;
    const dto = info?.orderRequestDTO;
    if (!dto) return null;
    let date = dto.train_date;
    if (date && typeof date === "object" && Number.isFinite(date.time)) {
      date = new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"}).format(date.time);
    } else if (typeof date === "string") {
      date = date.slice(0, 10);
    } else { date = null; }
    return {date, train: dto.station_train_code, from: dto.from_station_telecode, to: dto.to_station_telecode};
  }});
  return result[0]?.result || null;
}
async function handle(message, sender) {
  let run = await getRun();
  if (message.type === "STATUS" && isPopup(sender)) return {run};
  if (message.type === "SHOW_PANEL" && isPopup(sender)) {
    if (!run) throw new Error("还没有任务，请先启动。");
    await chrome.tabs.sendMessage(run.tabId, {type:"SHOW_PANEL"});
    run.panelMode="normal"; await save(run);
    await chrome.tabs.update(run.tabId,{active:true});
    return {run};
  }
  if (message.type === "START" && isPopup(sender)) {
    if (run?.active) throw new Error("已有任务运行，请先停止当前任务。");
    if (run?.locks?.book && !message.reviewed) throw new Error("上次任务已进入预订流程。请先检查 12306 未完成订单，再勾选核实选项。");
    const stations = await (await fetch(chrome.runtime.getURL("stations.json"))).json();
    const config = RailCore.validate(message.config, stations);
    const tab = await chrome.tabs.create({url: "about:blank", active: true});
    run = {id: crypto.randomUUID(), tabId: tab.id, config, active: true, phase: "opening", text: "正在打开 12306 查询页…", updatedAt: Date.now(), locks: {}, startedAt: Date.now()};
    await chrome.storage.local.set({configInput: message.config});
    await save(run);
    try { await chrome.tabs.update(tab.id, {url: QUERY_URL}); }
    catch (error) { run.active = false; run.text = "打开页面失败，请重新启动。"; await save(run); throw error; }
    return {run};
  }
  if (message.type === "STOP" && (isPopup(sender) || owns(sender, run, message.id))) {
    if (run) {
      run.active = false; run.phase = "stopped"; run.text = "已停止自动操作。已发出的订单请求请在 12306 检查结果。"; run.updatedAt = Date.now();
      await save(run);
      try { await chrome.tabs.sendMessage(run.tabId, {type: "STOP_NOW"}); } catch {}
    }
    return {run};
  }
  if (message.type === "HELLO") {
    if (!run || !owns(sender, run, run.id)) return {run: null};
    return {run};
  }
  if (!owns(sender, run, message.id)) throw new Error("任务标签页已变化，请重新启动。");
  if (message.type === "PANEL_MODE" && ["normal","minimized","hidden"].includes(message.mode)) {
    run.panelMode=message.mode;await save(run);return {run};
  }
  if (message.type === "UPDATE") {
    if (!run.active) return {run};
    run.phase = String(message.phase).slice(0, 30); run.text = String(message.text).slice(0, 300); run.updatedAt = Date.now();
    if (message.stop) run.active = false;
    await save(run);
    if (message.alert) await notify(run.text);
    return {run};
  }
  if (message.type === "CHECK") return {active: run.active, confirmRequestSeen: !!run.confirmRequestSeen, orderActivityAt: run.orderActivityAt || 0};
  if (message.type === "CLAIM") {
    if (!run.active || !["book", "submit", "confirm", "quietNotice", "confirmAfterQuiet", "confirmRetry"].includes(message.action) || run.locks[message.action]) return {granted: false};
    if (message.action === "confirmRetry" && (!run.locks.confirm || run.confirmRequestSeen || run.orderActivityAt >= run.locks.confirm)) return {granted:false};
    if (message.action === "quietNotice" && (!run.locks.submit || run.config.quiet === false)) return {granted:false};
    if (message.action === "confirmAfterQuiet" && (!run.locks.confirm || !run.locks.quietNotice || run.confirmRequestSeen || run.orderActivityAt >= run.locks.confirm)) return {granted:false};
    if (message.action === "book") {
      if (!/^[A-Z]?\d{1,5}$/.test(message.train) || (run.config.trains.length && !run.config.trains.includes(message.train))) throw new Error("车次不在目标列表中或格式无效。");
      run.train = message.train;
    } else if (!run.locks.book || (message.action === "confirm" && !run.locks.submit)) return {granted: false};
    run.locks[message.action] = Date.now();
    await save(run); // Persist before clicking, including across worker suspension and page reloads.
    return {granted: true};
  }
  if (message.type === "JOURNEY") {
    if (!run.active || !sender.url.includes("/confirmPassenger/")) return {journey: null};
    return {journey: await readJourney(run.tabId)};
  }
  throw new Error("未知操作。");
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  queued(() => handle(message, sender)).then(data => reply({ok: true, ...data}), error => reply({ok: false, error: error.message}));
  return true;
});
const queryFilter = {urls: ["https://kyfw.12306.cn/otn/leftTicket/query*"]};
async function relay(phase, details) {
  const run = await getRun();
  if (!run?.active || details.tabId !== run.tabId || details.frameId !== 0) return;
  const key = "queryRequests";
  const requests = (await chrome.storage.session.get(key))[key] || {};
  if (phase === "start") {
    // A completed request can belong to the previous page. Correlate its start too.
    for (const [id, value] of Object.entries(requests)) if (Date.now() - value > 60000) delete requests[id];
    requests[details.requestId] = details.timeStamp;
    await chrome.storage.session.set({[key]: requests});
  }
  const startedAt = requests[details.requestId];
  if (!startedAt) return;
  if (phase !== "start") { delete requests[details.requestId]; await chrome.storage.session.set({[key]: requests}); }
  // Only public query metadata, never request headers, cookies or response bodies.
  try { await chrome.tabs.sendMessage(details.tabId, {type: "QUERY_NETWORK", phase, requestId: details.requestId, url: details.url, status: details.statusCode, error: details.error, at: details.timeStamp, startedAt}); } catch {}
}
chrome.webRequest.onBeforeRequest.addListener(d => { void queued(() => relay("start", d)); }, queryFilter);
chrome.webRequest.onCompleted.addListener(d => { void queued(() => relay("end", d)); }, queryFilter);
chrome.webRequest.onErrorOccurred.addListener(d => { void queued(() => relay("error", d)); }, queryFilter);
chrome.webRequest.onBeforeRequest.addListener(details => { void queued(async () => {
  const run=await getRun();
  if(run?.active && run.tabId===details.tabId && details.frameId===0) {
    run.orderActivityAt=details.timeStamp;
    if(new URL(details.url).pathname.includes('/confirmSingle'))run.confirmRequestSeen=true;
    await save(run);
  }
}); }, {urls:["https://kyfw.12306.cn/otn/confirmPassenger/*"],types:["xmlhttprequest"]});
chrome.tabs.onRemoved.addListener(tabId => { void queued(async () => {
  const run = await getRun();
  if (run?.active && run.tabId === tabId) { run.active = false; run.phase = "stopped"; run.text = "任务标签页已关闭。"; await save(run); }
}); });
chrome.notifications.onClicked.addListener(async () => {
  const run = await getRun();
  if (run?.tabId) { try { await chrome.tabs.update(run.tabId, {active: true}); } catch {} }
});
