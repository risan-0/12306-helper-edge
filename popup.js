"use strict";
const $ = id => document.getElementById(id);
const fields = ["from", "to", "date", "trains", "passengers", "saleTime", "interval", "duration", "seatKey", "position"];
let busy = false, lastRun;
function show(text, error = false) { $("status").textContent = text; $("status").classList.toggle("error", error); }
async function message(type, data = {}) {
  const response = await chrome.runtime.sendMessage({type, ...data});
  if (!response?.ok) throw new Error(response?.error || "扩展服务未响应，请重试。");
  return response;
}
function render(run) {
  lastRun = run;
  $("fields").disabled = !!run?.active;
  $("start").disabled = busy || !!run?.active;
  $("stop").disabled = busy || !run?.active;
  $("clear").disabled = busy || !!run?.active;
  $("reviewRow").hidden = !run?.locks?.book || !!run?.active;
  $("showPanel").disabled = !run;
  if (run) show(run.text, run.phase === "paused");
}
async function init() {
  $("start").disabled = true;
  for (const seat of RailCore.seatTypes) { const opt=document.createElement("option");opt.value=seat.key;opt.textContent=seat.name;$("seatKey").append(opt); }
  const stations = await (await fetch("stations.json")).json();
  const fragment = document.createDocumentFragment();
  for (const station of stations) { const opt = document.createElement("option"); opt.value = station.name; fragment.append(opt); }
  $("stations").append(fragment);
  const {configInput} = await chrome.storage.local.get("configInput");
  if (configInput) {
    fields.forEach(id => { if (configInput[id] != null) $(id).value = configInput[id]; });
    $("autoSubmit").checked = configInput.autoSubmit === true;
    $("quiet").checked = configInput.quiet !== false;
  }
  $("date").min = RailCore.chinaDate();
  render((await message("STATUS")).run);
  $("form").addEventListener("submit", async event => {
    event.preventDefault(); if (busy) return;
    busy = true; render(lastRun);
    try {
      const config = Object.fromEntries(fields.map(id => [id, $(id).value.trim()]));
      config.autoSubmit = $("autoSubmit").checked;
      config.quiet = $("quiet").checked;
      RailCore.validate(config, stations);
      render((await message("START", {config, reviewed: $("reviewed").checked})).run);
      $("reviewed").checked = false;
    } catch (error) { show(error.message, true); }
    finally { busy = false; $("start").disabled = !!lastRun?.active; $("stop").disabled = !lastRun?.active; $("clear").disabled = !!lastRun?.active; }
  });
  $("stop").onclick = async () => { try { render((await message("STOP")).run); } catch (e) { show(e.message, true); } };
  $("showPanel").onclick = async () => { try { await message("SHOW_PANEL"); } catch { show("未能打开面板，请检查原任务网页是否仍打开；扩展更新后需要重新打开任务页。",true); } };
  $("clear").onclick = async () => {
    if (lastRun?.active) return;
    await chrome.storage.local.remove("configInput");
    for (const id of fields) $(id).value = id === "interval" ? "15" : id === "duration" ? "30" : "";
    $("autoSubmit").checked = true;
    $("seatKey").value="ZE";$("position").value="CD";$("quiet").checked=true;
    show("已清除本地行程和姓名设置。本次浏览器会话中的订单防重复记录将在关闭浏览器后清除。");
  };
  chrome.storage.onChanged.addListener((changes, area) => { if (area === "session" && changes.run) render(changes.run.newValue); });
}
init().catch(error => show(error.message, true));
