(async function () {
  "use strict";
  if (globalThis.__railHelperLoaded) return;
  globalThis.__railHelperLoaded = true;
  const D = RailDOM;
  let run, stopped = false, networkWaiter = null, panel, note, internalAction = false;
  function click(el) {
    internalAction = true;
    try { el.click(); } finally { internalAction = false; }
  }
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function send(type, data = {}) {
    const response = await chrome.runtime.sendMessage({type, id: run?.id, ...data});
    if (!response?.ok) throw new Error(response?.error || "扩展连接中断，请重新加载页面。");
    return response;
  }
  function mount() {
    panel = RailPanel(run, async () => {
      stopped = true;
      note.textContent = "已停止。已经发出的订单请求，请在 12306 检查结果。";
      try { await send("STOP"); } catch {}
    }, mode => { void send("PANEL_MODE", {mode}).catch(() => {}); });
    note = panel.note;
  }
  async function status(phase, text, stop = false, alert = false) {
    if (note) note.textContent = text;
    if (stop) stopped = true;
    const response = await send("UPDATE", {phase, text, stop, alert});
    if (!response.run?.active) stopped = true;
  }
  async function check() {
    if (stopped || !(await send("CHECK")).active) throw new Error("任务已停止。");
  }
  async function until(predicate, timeout, description) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (stopped) throw new Error("任务已停止。");
      const result = predicate();
      if (result) return result;
      await sleep(150);
    }
    throw new Error(description);
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === "SHOW_PANEL") { panel?.setMode("normal", false); reply({ok:!!panel}); return; }
    if (message.type === "STOP_NOW") { stopped = true; if (note) note.textContent = "已停止自动操作，请在官网检查已发出的订单请求。"; }
    if (message.type !== "QUERY_NETWORK" || !networkWaiter || !run) return;
    const url = new URL(message.url);
    const c = run.config;
    if (message.startedAt < networkWaiter.since || !message.startedAt || url.searchParams.get("leftTicketDTO.train_date") !== c.date || url.searchParams.get("leftTicketDTO.from_station") !== c.from.code || url.searchParams.get("leftTicketDTO.to_station") !== c.to.code) return;
    if (message.phase === "start") networkWaiter.requestId = message.requestId;
    if (message.phase === "end" || message.phase === "error") {
      // Completion itself identifies a request started after this query was armed.
      // A start notification may arrive after completion when a service worker wakes.
      networkWaiter.completed = message;
    }
  });
  // Real user edits during automation pause before another automatic query or order click.
  function onUserChange(event) {
    if (internalAction || !event.isTrusted || !run?.active || stopped || !(event.target instanceof Element)) return;
    if (event.target.closest('#query_ticket,#submitOrder_id,#qr_submit_id,#fromStationText,#toStationText,#train_date,#dc,#wf,#sf1,#sf2,#normal_passenger_id,select[id^="seatType_"],select[id^="ticketType_"]')) {
      void status("paused", "你修改了购票条件，自动操作已暂停；请核对后手动接手或重新启动。", true).catch(() => { stopped = true; });
    }
  }
  document.addEventListener("change", onUserChange, true);
  document.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest('#query_ticket,#submitOrder_id,#qr_submit_id')) onUserChange(event);
  }, true);
  async function prepareQuery() {
    const c = run.config;
    await until(() => D.available(document.querySelector("#query_ticket")), 25000, "查询页未能就绪，请完成登录、验证或检查网络后重新启动。");
    if (run.locks.book) throw new Error("任务已经进入过预订流程，不会重复预订。请检查未完成订单或手动接手。");
    const autoQuery = document.querySelector("#auto_query");
    if (D.clean(document.querySelector("#query_ticket").textContent) !== "查询") throw new Error("网页已有查询任务，请先在官网停止该任务。");
    for (const el of [autoQuery, document.querySelector("#autoSubmit"), document.querySelector("#partSubmit")]) {
      if (el?.checked) { if (el.disabled) throw new Error("官网正在执行自动提交，请先检查原任务。"); click(el); }
    }
    for (const id of ["#dc", "#sf1"]) { const el = document.querySelector(id); if (el && !el.checked && !el.disabled) click(el); }
    D.setValue(document.querySelector("#fromStationText"), c.from.name);
    D.setValue(document.querySelector("#toStationText"), c.to.name);
    D.setValue(document.querySelector("#fromStation"), c.from.code);
    D.setValue(document.querySelector("#toStation"), c.to.code);
    D.setValue(document.querySelector("#train_date"), c.date);
    document.querySelector("#train_date").blur();
    if (!D.controlsMatch(c)) throw new Error("出发站、到达站或日期填写失败，请在官网核对。");
  }
  async function queryOnce() {
    const c = run.config;
    await check();
    const blocker = D.blockingReason(); if (blocker) throw new Error(blocker);
    if (!D.controlsMatch(c)) throw new Error("官网查询条件发生变化，已暂停以避免买错票。");
    if (["#auto_query", "#autoSubmit", "#partSubmit"].some(s => document.querySelector(s)?.checked)) throw new Error("官网自动任务已开启，请勿与扩展同时运行。");
    const button = document.querySelector("#query_ticket");
    if (!D.available(button) || D.clean(button.textContent) !== "查询") throw new Error("官网查询尚未结束，请手动检查页面。");
    const oldTable = document.querySelector("#queryLeftTable");
    networkWaiter = {since: Date.now(), completed: null};
    click(button);
    const completed = await until(() => networkWaiter?.completed, 25000, "未能确认查询结束（超时或页面变化）。已暂停，避免叠加请求。");
    networkWaiter = null;
    if ([403, 429].includes(completed.status)) throw new Error("官网限制了本次访问，请稍后重试或使用官方候补。");
    if (completed.phase === "error" || completed.status >= 500) return {error: true};
    if (completed.status !== 200) throw new Error("查询返回异常，请在 12306 页面检查。");
    await until(() => {
      const reason = D.blockingReason(); if (reason) throw new Error(reason);
      return (document.querySelector("#queryLeftTable") !== oldTable && document.querySelector("#queryLeftTable")) || D.visible(document.querySelector("#no_filter_ticket_2"));
    }, 6000, "查询已返回，但无法可靠识别新结果。请手动查看官网。");
    await sleep(200);
    return {rows: D.rows(c)};
  }
  async function queryLoop() {
    await prepareQuery();
    const c = run.config;
    if (c.saleAt > Date.now()) {
      await status("waiting", "条件已填好，等待北京时间起售。请保持此页在前台。");
      while (Date.now() < c.saleAt) {
        if (stopped) return;
        const seconds = Math.ceil((c.saleAt - Date.now()) / 1000);
        note.textContent = `起售倒计时 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒 · ${RailCore.seatName(c)}`;
        await sleep(Math.min(500, c.saleAt - Date.now()));
      }
      if (Date.now() - c.saleAt > 60000) throw new Error("起售计时因休眠或页面冻结延迟超过 1 分钟，请重新检查并启动。");
    }
    const deadline = Math.max(run.startedAt, c.saleAt) + c.duration * 60000;
    let attempts = 0, failures = 0;
    while (!stopped && Date.now() < deadline) {
      await status("querying", `第 ${++attempts} 次查询 · ${c.trains.length ? c.trains.join(" / ") : "所选日期全部车次（按官网列表顺序）"} · ${RailCore.seatName(c)}`);
      const result = await queryOnce();
      let missText = "";
      if (result.error) {
        if (++failures >= 3) throw new Error("连续三次网络或服务器错误，已暂停。请检查官网或使用候补。");
      } else {
        failures = 0;
        const match = RailCore.choose(result.rows, c);
        if (match) {
          await check();
          if (!D.controlsMatch(c) || !D.available(match.button)) throw new Error("匹配结果已变化，请手动核对。");
          if (!(await send("CLAIM", {action: "book", train: match.code})).granted) throw new Error("已处理过预订或任务已停止，请查看官方订单。");
          await status("booking", `找到 ${match.code} ${RailCore.seatName(c)}，正在进入预订页…`);
          await check();
          click(match.button);
          await sleep(12000);
          if (!stopped) throw new Error("已点击预订；如果出现登录、验证或其他提示，请完成后手动接手。不会再次点击预订。");
          return;
        }
        const reason = RailCore.explainNoMatch(result.rows, c);
        if (reason.pause) throw new Error(reason.text);
        missText = reason.text;
      }
      const delay = Math.min(120, c.interval * (2 ** failures)) * 1000 + Math.floor(Math.random() * 1000);
      await status("watching", result.error ? `本次网络异常，${Math.round(delay / 1000)} 秒后再查询。` : `${missText} ${Math.round(delay / 1000)} 秒后再查。`);
      const next = Math.min(Date.now() + delay, deadline);
      while (!stopped && Date.now() < next) await sleep(Math.min(500, next - Date.now()));
    }
    if (!stopped) await status("finished", "已达到设置的查询时长。可在官网查看余票或提交候补。", true, true);
  }
  async function verifyOrder() {
    await check();
    const blocker = D.blockingReason(); if (blocker) throw new Error(blocker);
    const {journey} = await send("JOURNEY");
    RailCore.assertJourney(journey, run.config, run.train);
    const targets = D.passengerTargets(run.config.passengers);
    if (targets.some(el => !el.checked)) throw new Error("乘车人勾选状态发生变化，请手动检查。");
    D.assertSeats(run.config.passengers.length, run.config);
  }
  async function orderFlow() {
    if (!run.locks.book || !run.train) throw new Error("没有与此订单关联的目标车次，请手动操作。");
    if (run.locks.submit) throw new Error("已发出过提交请求，刷新后不会重复提交。请检查未完成订单。");
    await until(() => document.querySelector('#normal_passenger_id input[type="checkbox"]'), 20000, "乘车人列表未能加载，请手动检查登录状态。");
    const {journey} = await send("JOURNEY");
    RailCore.assertJourney(journey, run.config, run.train);
    const blocker = D.blockingReason(); if (blocker) throw new Error(blocker);
    const targets = D.passengerTargets(run.config.passengers);
    for (const el of targets) { await check(); if (!el.checked) click(el); }
    await until(() => [...document.querySelectorAll('select[id^="seatType_"]')].filter(D.visible).length === targets.length, 5000, "席别选择框没有正常加载，请手动接手。");
    D.selectSeatClass(targets.length, run.config);
    await verifyOrder();
    if (!run.config.autoSubmit) {
      await status("prepared", `已选好成人乘车人和${RailCore.seatName(run.config)}。当前为演练模式，不提交；C/D及静音偏好在提交后的确认页设置。`, true, true);
      return;
    }
    const submit = document.querySelector("#submitOrder_id");
    if (!D.available(submit)) throw new Error("提交按钮不可用，请完成页面要求后手动提交。");
    if (!(await send("CLAIM", {action: "submit"})).granted) throw new Error("任务已停止或已提交，不会重复提交。");
    await status("submitting", "正在提交，请勿刷新或在其他标签页重复购票…");
    await verifyOrder();
    click(submit);
    const confirm = await until(() => {
      const reason = D.blockingReason(); if (reason) throw new Error(reason);
      return D.orderConfirmButton();
    }, 25000, "提交后未能识别可用的确认按钮。请检查验证提示和订单状态，扩展不会重复提交。");
    await verifyOrder();
    const preferences = D.confirmationPreferences(run.config, click);
    await status("preferences", preferences.text + "；准备确认。");
    async function acceptQuietNotice() {
      if(!preferences.quietSelected)return false;
      const deadline=Date.now()+2000;
      let notice;
      while(Date.now()<deadline) {
        await check();notice=D.quietNotice();if(notice)break;await sleep(100);
      }
      if(!notice)return false;
      await status("quiet_notice", "正在确认静音车厢乘车说明，随后返回核对信息…");
      await check();
      if(!D.unobstructed(notice.button))throw new Error("静音说明的确定按钮被其他窗口遮挡，请手动处理。");
      if(!(await send("CLAIM",{action:"quietNotice"})).granted)throw new Error("静音说明已处理或任务已停止，请手动检查。");
      await check();click(notice.button);
      await until(()=>!D.visible(notice.box),5000,"静音说明未能关闭，请手动确认；不会重复点击。");
      await until(()=>D.orderConfirmButton(),5000,"核对信息的确认按钮仍被遮挡，请手动检查。");
      preferences.assert();return true;
    }
    const acceptedBefore=await acceptQuietNotice();
    const confirmStartedAt=Date.now();
    await verifyOrder();
    await until(()=>D.orderConfirmButton(),5000,"确认按钮被遮挡，请先处理官网提示。");
    if (!(await send("CLAIM", {action: "confirm"})).granted) throw new Error("已确认过订单或任务已停止，请查看订单结果。");
    await check();
    preferences.assert();
    click(D.orderConfirmButton());
    // Some page variants show the quiet notice only after the first confirm click.
    if(!acceptedBefore && await acceptQuietNotice()) {
      await verifyOrder();
      if(!(await send("CLAIM",{action:"confirmAfterQuiet"})).granted)throw new Error("已发出订单确认请求或无法确认是否提交，不会再次点击。请检查官网订单。");
      await check();preferences.assert();
      const nextConfirm=D.orderConfirmButton();
      if(!D.unobstructed(nextConfirm))throw new Error("确认按钮仍被遮挡，请手动检查。");
      click(nextConfirm);
    }
    await status("confirm_check", "正在检查确认是否生效，等待官网发起订单处理…");
    async function waitForConfirmationActivity() {
      const deadline=Date.now()+4000;
      while(Date.now()<deadline) {
        await check();
        const state=await send("CHECK");
        if(state.confirmRequestSeen || state.orderActivityAt >= confirmStartedAt) return true;
        const reason=D.blockingReason();if(reason)throw new Error(reason);
        await sleep(150);
      }
      return false;
    }
    if(!await waitForConfirmationActivity()) {
      await verifyOrder();preferences.assert();
      if(!(await send("CLAIM",{action:"confirmRetry"})).granted)throw new Error("检测到订单请求或已重试过确认，请在官网查看结果。");
      await status("confirm_retry", "核对窗口仍未响应且未检测到订单请求，正在再点一次确认…");
      await check();const retryButton=D.orderConfirmButton();
      if(!retryButton)throw new Error("确认按钮状态已变化，请查看官网。");
      click(retryButton);
      if(!await waitForConfirmationActivity())throw new Error("确认按钮仍未触发可检测的订单处理，请手动点击红框确认。扩展已暂停，不会继续空等或反复点击。");
    }
    await status("queue", "已检测到官网订单处理请求，等待结果；成功以官网订单为准。");
    // The official page owns its order queue polling. Do not add queue requests or retries.
    const deadline = Date.now() + 10 * 60000;
    while (!stopped && Date.now() < deadline) {
      const reason = D.blockingReason(); if (reason) throw new Error(reason);
      await sleep(1000);
    }
    if (!stopped) await status("handoff", "官网排队仍未跳转，自动操作已结束。请留在官网查看订单处理结果。", true, true);
  }
  try {
    run = (await send("HELLO")).run;
    if (!run) return;
    mount();
    if (!run.active) { stopped = true; return; }
    if (location.pathname.startsWith("/otn/leftTicket/")) await queryLoop();
    else if (location.pathname.startsWith("/otn/confirmPassenger/")) await orderFlow();
    else if (location.pathname.startsWith("/otn/payOrder/") && run.locks.submit) {
      await status("done", "已进入 12306 订单支付页，请核对订单并在页面提示时限内付款。", true, true);
    } else {
      await status("paused", "已跳转到登录或其他页面。请完成官网要求并查看订单；需要时重新启动任务。", true, true);
    }
  } catch (error) {
    if (!stopped && run) {
      try { await status("paused", error.message, true, true); }
      catch { if (note) note.textContent = "扩展已断开，请在官网手动检查当前订单。"; }
    }
    stopped = true;
  }
})();
