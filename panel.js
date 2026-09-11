(function (root) {
  "use strict";
  root.RailPanel = function (run, onStop, onMode) {
    const host = document.createElement("div"); host.id = "rail-helper-panel";
    host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647";
    const shadow = host.attachShadow({mode:"open"});
    const style = document.createElement("style");
    style.textContent = ":host{all:initial}aside{font:14px/1.6 'Microsoft YaHei',sans-serif;width:310px;padding:16px;background:#102c3b;color:white;border-radius:16px;box-shadow:0 8px 40px #0004}header{display:flex;gap:8px;align-items:center}h3{margin:0;flex:1;font-size:15px}p{margin:8px 0;overflow-wrap:anywhere}.route{color:#86ddd4}button,a{font:inherit;padding:7px 10px;border:0;border-radius:7px;cursor:pointer}button{background:#fff;color:#173744}a{display:inline-block;color:#abe4e0;font-size:12px}small{color:#beced5}button:disabled{opacity:.6}.icon{padding:0 7px;font-size:19px;background:#295261;color:white}.mini{background:#102c3b;color:white;border:1px solid #85c7cb;border-radius:30px;box-shadow:0 4px 20px #0003}.tip{font-size:11px;color:#adcbd4}[hidden]{display:none!important}";
    const panel = document.createElement("aside");
    const header = document.createElement("header");
    const title = document.createElement("h3"); title.textContent = `高铁出发 · ${RailCore.seatName(run.config)}`;
    const minimize = document.createElement("button"); minimize.className="icon"; minimize.textContent="−"; minimize.title="缩小面板"; minimize.setAttribute("aria-label","缩小面板");
    const close = document.createElement("button"); close.className="icon"; close.textContent="×"; close.title="关闭面板（任务继续；从扩展图标重新打开）"; close.setAttribute("aria-label","关闭面板");
    header.append(title,minimize,close);
    const route = document.createElement("p"); route.className="route"; route.textContent=`${run.config.from.name} → ${run.config.to.name} · ${run.config.date}`;
    const note = document.createElement("p"); note.setAttribute("aria-live","polite"); note.textContent=run.text;
    const stop = document.createElement("button"); stop.textContent="停止自动操作"; stop.disabled=!run.active;
    stop.onclick=()=>{stop.disabled=true;onStop();};
    const help = document.createElement("a"); help.href="https://kyfw.12306.cn/otn/gonggao/alternate.html"; help.target="_blank";help.rel="noopener";help.textContent="官方候补说明";
    const tip=document.createElement("p");tip.className="tip";tip.textContent="缩小/关闭只隐藏面板，任务继续。可从扩展图标重新打开。请保持网页前台，电脑不休眠。";
    panel.append(header,route,note,stop,help,tip);
    const mini=document.createElement("button");mini.className="mini";mini.textContent="高铁出发 · 展开";mini.setAttribute("aria-label","展开购票面板");
    function setMode(mode, persist=true) {
      host.hidden=mode==="hidden";panel.hidden=mode!=="normal";mini.hidden=mode!=="minimized";
      if(persist)onMode(mode);
    }
    minimize.onclick=()=>setMode("minimized");close.onclick=()=>setMode("hidden");mini.onclick=()=>setMode("normal");
    shadow.append(style,panel,mini);document.documentElement.append(host);setMode(run.panelMode||"normal",false);
    return {note,setMode};
  };
})(globalThis);
