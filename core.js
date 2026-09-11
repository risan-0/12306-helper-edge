(function (root) {
  "use strict";
  const seatTypes = [
    {key:"ZE",name:"二等座",prefixes:["ZE"]}, {key:"ZY",name:"一等座",prefixes:["ZY"]},
    {key:"SWZ",name:"商务座",prefixes:["SWZ"]}, {key:"TZ",name:"特等座",prefixes:["TZ","SWZ"]},
    {key:"GG",name:"优选一等座",prefixes:["GG"]}, {key:"BZ",name:"二等包座",prefixes:["ZE"]},
    {key:"GR",name:"高级软卧",prefixes:["GR"]}, {key:"RW",name:"软卧",prefixes:["RW"]},
    {key:"SRRB",name:"动卧",prefixes:["SRRB","RW"]}, {key:"YYRW",name:"高级动卧",prefixes:["YYRW","GR"]},
    {key:"YW",name:"硬卧",prefixes:["YW"]}, {key:"YDW",name:"一等卧",prefixes:["RW"]},
    {key:"EDW",name:"二等卧",prefixes:["YW"]}, {key:"RZ",name:"软座",prefixes:["RZ"]},
    {key:"YZ",name:"硬座",prefixes:["YZ"]}, {key:"WZ",name:"无座",prefixes:["WZ"]},
    {key:"QT",name:"其他",prefixes:["QT"]}
  ];
  const seatType = config => seatTypes.find(s => s.key === (config.seatKey || "ZE"));
  const seatName = config => seatType(config)?.name || "未知席别";
  const split = value => [...new Set(String(value || "").trim().split(/[,，;；\n]+/).map(s => s.trim()).filter(Boolean))];
  const chinaDate = (time = Date.now()) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(time);
  function validate(input, stations, now = Date.now()) {
    const from = stations.find(s => s.name === input.from);
    const to = stations.find(s => s.name === input.to);
    if (!from || !to) throw new Error("请从站名建议中选择完整车站名，例如“北京南”。");
    if (from.code === to.code) throw new Error("出发站和到达站不能相同。");
    const date = String(input.date || "");
    const dateTime = Date.parse(date + "T12:00:00+08:00");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(dateTime) || chinaDate(dateTime) !== date || date < chinaDate(now)) {
      throw new Error("请选择有效的乘车日期，不能早于北京时间今天。");
    }
    const trains = split(String(input.trains ?? "").toUpperCase());
    if (trains.length > 10 || trains.some(t => !/^[A-Z]?\d{1,5}$/.test(t))) {
      throw new Error("目标车次可留空；指定时请输入最多 10 个车次，以逗号分隔，例如 G101,K151,1461。");
    }
    const passengers = split(input.passengers);
    if (!passengers.length || passengers.length > 5 || passengers.some(p => p.length > 60)) {
      throw new Error("请输入 1–5 位已保存在 12306 账户中的成人乘车人姓名，以逗号分隔。");
    }
    let saleAt = 0;
    if (input.saleTime) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(input.saleTime)) throw new Error("起售时间格式无效。");
      saleAt = Date.parse(input.saleTime + "+08:00");
      if (!Number.isFinite(saleAt) || saleAt < now - 60000 || saleAt > dateTime + 12 * 3600000) throw new Error("起售时间应在未来，且不能晚于乘车日期。");
    }
    const interval = Number(input.interval ?? 15);
    const duration = Number(input.duration ?? 30);
    if (!Number.isInteger(interval) || interval < 10 || interval > 120) throw new Error("查询间隔应为 10–120 秒。");
    if (!Number.isInteger(duration) || duration < 1 || duration > 120) throw new Error("持续查询应为 1–120 分钟。");
    const seatKey = input.seatKey || "ZE";
    if (!seatTypes.some(s => s.key === seatKey)) throw new Error("请选择有效席别。");
    const position = input.position ?? "CD";
    if (!["CD","AF","A","B","C","D","F","auto"].includes(position)) throw new Error("请选择有效座位偏好。");
    return {from, to, date, trains, passengers, saleAt, interval, duration, seatKey, position, quiet: input.quiet !== false, autoSubmit: input.autoSubmit === true};
  }
  function hasSeats(text, count) {
    const value = String(text || "").replace(/\s/g, "");
    return value === "有" || (/^\d+$/.test(value) && Number(value) >= count);
  }
  function choose(rows, config) {
    if (!config.trains.length) return rows.find(r => /^[A-Z]?\d{1,5}$/.test(r.code) && r.fromCode === config.from.code && r.toCode === config.to.code && r.bookable && hasSeats(r.seats, config.passengers.length)) || null;
    for (const code of config.trains) {
      const row = rows.find(r => r.code === code && r.fromCode === config.from.code && r.toCode === config.to.code && r.bookable && hasSeats(r.seats, config.passengers.length));
      if (row) return row;
    }
    return null;
  }
  function assertJourney(journey, config, train) {
    if (!journey || journey.train !== train || journey.date !== config.date || journey.from !== config.from.code || journey.to !== config.to.code) {
      throw new Error("无法确认订单车次、日期和区间完全匹配。请在官方页面手动核对后提交。");
    }
  }
  function explainNoMatch(rows, config) {
    const targets = rows.filter(r => config.trains.length ? config.trains.includes(r.code) : /^[A-Z]?\d{1,5}$/.test(r.code));
    if (!targets.length) return {pause: false, text: config.trains.length ? "当前结果中未找到指定车次，请检查车次、日期和官网筛选条件。" : "当前结果中没有可识别的车次，请检查日期、区间和官网筛选条件。"};
    if (targets.some(r => !r.fromCode || !r.toCode)) return {pause: true, text: "已找到目标车次，但无法读取实际站点代码。请手动查看官网，当前页面需要更新适配。"};
    const exact = targets.filter(r => r.fromCode === config.from.code && r.toCode === config.to.code);
    if (!exact.length) {
      const routes = [...new Set(targets.map(r => `${r.code}：${r.from || r.fromCode} → ${r.to || r.toCode}`))].join("；");
      return {pause: true, text: `车站不一致：设置为 ${config.from.name} → ${config.to.name}，官网显示 ${routes}。请将设置改为实际乘车站后重新启动（例如上海与上海虹桥不同）。`};
    }
    if (exact.some(r => hasSeats(r.seats, config.passengers.length) && !r.bookable)) return {pause: false, text: `目标车次显示${seatName(config)}余票，但预订按钮未能识别或当前不可用，请查看官网。`};
    if (exact.some(r => !r.seats)) return {pause: true, text: `目标车次已找到，但无法读取${seatName(config)}余票。请手动查看官网，当前页面需要更新适配。`};
    return {pause: false, text: `目标区间暂无满足全部乘车人数的${seatName(config)}，可考虑官方候补。`};
  }
  const api = {split, chinaDate, validate, hasSeats, choose, assertJourney, explainNoMatch, seatTypes, seatType, seatName};
  root.RailCore = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
