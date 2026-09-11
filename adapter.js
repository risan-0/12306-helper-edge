(function (root) {
  "use strict";
  const clean = text => String(text || "").replace(/\s+/g, "").trim();
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const available = el => visible(el) && !el.disabled && el.getAttribute("aria-disabled") !== "true" && !el.classList.contains("btn-disabled") && !el.classList.contains("disabled");
  function setValue(el, value) {
    if (!el) throw new Error("未找到输入控件，页面可能已更新。");
    const setter = Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", {bubbles: true}));
    el.dispatchEvent(new Event("change", {bubbles: true}));
  }
  function controlsMatch(config) {
    return document.querySelector("#fromStation")?.value === config.from.code && document.querySelector("#toStation")?.value === config.to.code && document.querySelector("#train_date")?.value === config.date && document.querySelector("#fromStationText")?.value === config.from.name && document.querySelector("#toStationText")?.value === config.to.name;
  }
  function rows(config = {}) {
    return [...document.querySelectorAll('#queryLeftTable tr[id^="ticket_"]')].filter(visible).map(el => {
      const stations = [...el.querySelectorAll(".cdz strong")].map(s => clean(s.title || s.textContent));
      const trainLink = el.querySelector("a.number");
      const codes = trainLink?.id.match(/_([A-Z]{3})_([A-Z]{3})$/);
      const button = [...el.querySelectorAll("a.btn72")].find(a => clean(a.textContent) === "预订" && available(a));
      const cell = RailCore.seatType(config).prefixes.map(prefix => el.querySelector(`[id^="${prefix}_"]`)).find(Boolean);
      return {el, button, code: clean(trainLink?.textContent), from: stations[0], to: stations[1], fromCode: codes?.[1], toCode: codes?.[2], seats: clean(cell?.textContent), bookable: !!button};
    });
  }
  function blockingReason() {
    if (visible(document.querySelector("#no_filter_ticket_6"))) return "12306 提示操作频率过快。请稍后在官网重试或使用候补。";
    const challenge = [".modal-login", "#login", "#loginForm", "#nc_1_n1z", "#nc_1_wrapper", "#J-loginImg", "#J-login-code-loading"].some(s => visible(document.querySelector(s)));
    if (challenge) return "请在 12306 页面完成登录或验证码，然后重新启动任务；进入订单后请手动接手。";
    const dialogs = [...document.querySelectorAll('.dhtmlx_message_area .dhtmlx_message, .dhtmlx-alert, .dhtmlx-confirm, .dhx_modal_cover + .dhtmlx_modal_box, [role="dialog"]')].filter(visible);
    if (dialogs.some(el => !el.querySelector('#qr_submit_id') && /频繁|频率|验证码|验证身份|网络忙|系统忙|操作失败|未完成订单|余票不足|登录|确认|错误|重试/.test(el.textContent))) {
      return "12306 显示了需要处理的提示，请在官方页面查看并接手。";
    }
    return null;
  }
  function passengerTargets(names) {
    const box = document.querySelector("#normal_passenger_id");
    if (!box) throw new Error("未找到官方乘车人列表，请登录并检查页面。");
    const checkboxes = [...box.querySelectorAll('input[type="checkbox"]')];
    const targets = names.map(name => {
      const matches = checkboxes.filter(el => {
        const label = [...box.querySelectorAll("label")].find(l => l.htmlFor === el.id);
        return label?.textContent.trim() === name.trim();
      });
      if (matches.length !== 1 || !available(matches[0])) throw new Error("乘车人姓名未能唯一匹配、被禁用或尚未加载。请手动选择乘车人。");
      return matches[0];
    });
    if (checkboxes.some(el => el.checked && !targets.includes(el))) throw new Error("订单中已勾选其他乘车人，请手动检查。");
    return targets;
  }
  function seatControls(count) {
    const seats = [...document.querySelectorAll('select[id^="seatType_"]')].filter(visible);
    const types = [...document.querySelectorAll('select[id^="ticketType_"]')].filter(visible);
    if (seats.length !== count || types.length !== count) throw new Error("乘车人数或席别控件未能核对，请手动检查订单。");
    for (const type of types) {
      if (clean(type.selectedOptions[0]?.textContent) !== "成人票" && clean(type.selectedOptions[0]?.textContent) !== "成人") throw new Error("此版本仅自动处理成人票；学生、儿童及优惠票请手动提交。");
    }
    return seats;
  }
  const optionName = option => clean(option?.textContent).replace(/[（(].*$/, "");
  function selectSeatClass(count, config) {
    const seats = seatControls(count);
    const name = RailCore.seatName(config);
    const options = seats.map(el => [...el.options].find(o => !o.disabled && optionName(o) === name));
    if (options.some(o => !o)) throw new Error(`订单中没有可选${name}，请检查余票或使用官方候补。不会改买其他席别。`);
    seats.forEach((el, i) => setValue(el, options[i].value));
  }
  function assertSeats(count, config) {
    if (seatControls(count).some(el => optionName(el.selectedOptions[0]) !== RailCore.seatName(config))) throw new Error("席别发生变化，请手动检查订单。");
  }
  function confirmationPreferences(config, click) {
    const notes = [];
    let chosenSeats = null, expectedQuiet = null, seatElements = [];
    const selected = el => el.classList.contains("cur") || el.getAttribute("aria-pressed") === "true";
    const box = document.querySelector("#id-seat-sel");
    if (visible(box)) {
      // Official selector and `cur` state are verified against the public query script.
      const seats = [...box.querySelectorAll(".sel-item a")].filter(visible);
      seatElements = seats;
      const wanted = config.position === "auto" ? "" : (config.position || "CD");
      const desired = seats.filter(el => available(el) && !el.classList.contains("unselectable") && wanted.includes(clean(el.textContent)) && /^[ABCDF]$/.test(clean(el.textContent)));
      for (const el of seats.filter(selected)) click(el);
      if (seats.some(selected)) throw new Error("无法清除原选座偏好，请手动检查后确认。");
      if (desired.length >= config.passengers.length) {
        const choices = desired.slice(0, config.passengers.length);
        for (const el of choices) click(el);
        if (seats.filter(selected).length !== choices.length || choices.some(el => !selected(el))) throw new Error("选座偏好未能生效，请手动选择后确认。");
        chosenSeats = choices;
        notes.push(`已选择 ${choices.map(el => clean(el.textContent)).join("、")} 偏好`);
      } else { chosenSeats = []; notes.push("可选偏好位不足，使用官网自动分配"); }
    } else { notes.push("本席别未提供指定座位或已选择自动分配"); }
    {
      const labels = [...document.querySelectorAll("label,span,p,div")].filter(el => visible(el) && el.textContent.length < 140 && /请优先为我分配.*静音车厢/.test(clean(el.textContent)));
      const boxes = new Set();
      for (const label of labels) {
        if (label.htmlFor) { const el = document.getElementById(label.htmlFor); if (el?.matches('input[type="checkbox"]')) boxes.add(el); }
        const parent = label.matches("label") ? label : label.parentElement;
        if (parent && parent.textContent.length < 160) {
          const inputs = parent.querySelectorAll('input[type="checkbox"]');
          if (inputs.length === 1) boxes.add(inputs[0]);
        }
      }
      const candidates = [...boxes].filter(available);
      if (candidates.length > 1) throw new Error("静音车厢选项不唯一，请手动选择后确认。");
      if (candidates.length === 1) {
        const checkbox = candidates[0], desiredQuiet = config.quiet !== false;
        if (checkbox.checked !== desiredQuiet) click(checkbox);
        if (checkbox.checked !== desiredQuiet) throw new Error("静音车厢偏好未能设置，请手动检查。");
        expectedQuiet = {el:checkbox,checked:desiredQuiet};
        notes.push(desiredQuiet ? "已勾选优先静音车厢" : "已关闭静音车厢偏好");
      } else if (config.quiet !== false && labels.length && !boxes.size) { throw new Error("已找到静音车厢提示，但无法识别勾选控件，请手动检查。"); }
      else { notes.push("本车次/席别没有可用的静音车厢选项"); }
    }
    return {quietSelected: !!expectedQuiet?.checked, text: notes.join("；"), assert() {
      if (chosenSeats && (seatElements.filter(selected).length !== chosenSeats.length || chosenSeats.some(el => !el.isConnected || !selected(el)))) throw new Error("确认前座位偏好发生变化，请手动检查。");
      if (expectedQuiet && (!expectedQuiet.el.isConnected || expectedQuiet.el.checked !== expectedQuiet.checked)) throw new Error("确认前静音车厢偏好发生变化，请手动检查。");
    }};
  }
  function quietNotice() {
    // Match this specific service notice, never an arbitrary “确定” button.
    const matches = [];
    for (const button of document.querySelectorAll('a,button,input[type="button"]')) {
      if (!available(button) || clean(button.textContent || button.value) !== "确定") continue;
      for (let box=button.parentElement; box && box!==document.body; box=box.parentElement) {
        const text=clean(box.textContent);
        if (text.length>1200 || box.querySelector('#qr_submit_id')) break;
        if (/温馨提示/.test(text) && /静音车厢/.test(text) && /保持安静/.test(text) && /耳机|音源外放/.test(text) && /接打电话|手机.*静音/.test(text)) {
          matches.push({box,button});break;
        }
      }
    }
    if(matches.length>1)throw new Error("检测到多个静音说明窗口，请手动确认。");
    return matches[0] || null;
  }
  function unobstructed(el) {
    if(!available(el))return false;
    const r=el.getBoundingClientRect();
    const top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
    return !!top && (top===el || el.contains(top));
  }
  function orderConfirmButton() {
    const known=[...document.querySelectorAll('[id="qr_submit_id"]')].filter(unobstructed);
    if(known.length===1)return known[0];
    const buttons=[...document.querySelectorAll('a,button,input[type="button"]')].filter(el=>unobstructed(el) && clean(el.textContent||el.value)==="确认");
    const matches=buttons.filter(el=>{
      for(let parent=el.parentElement;parent && parent!==document.body;parent=parent.parentElement){
        if(parent.querySelector('#submitOrder_id'))break;
        if(/请核对以下信息/.test(clean(parent.textContent)) && parent.querySelector('table'))return true;
      }
      return false;
    });
    return matches.length===1?matches[0]:null;
  }
  root.RailDOM = {clean, visible, available, setValue, controlsMatch, rows, blockingReason, passengerTargets, seatControls, selectSeatClass, assertSeats, confirmationPreferences, quietNotice, unobstructed, orderConfirmButton};
})(globalThis);
