// 业务流冒烟测试：种子一致性 + 登记/复测/放行/版本全流程，使用内存版 localStorage。
import { build } from "esbuild";
import { writeFileSync, rmSync } from "node:fs";

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new MemoryStorage();

const entry = `
export { loadRecords, saveRecords } from "./src/data/storage.ts";
export { useInspectionStore, consoleMetrics, pointSummaries } from "./src/state/store.ts";
export { evaluateReading } from "./src/domain/rules.ts";
`;
writeFileSync("__flow_entry.ts", entry);

const result = await build({
  entryPoints: ["__flow_entry.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  loader: { ".ts": "ts" }
});
const mod = await import("data:text/javascript," + encodeURIComponent(result.outputFiles[0].text));

let pass = 0, fail = 0;
function assert(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ✅", name); }
  else { fail++; console.log("  ❌", name, detail); }
}

function today() { return new Date().toISOString().slice(0, 10); }

// ---- 种子 ----
const seed = mod.loadRecords();
assert("种子 6 条记录", seed.length === 6, seed.length);
const p3 = seed.find(r => r.pointId === "P3");
assert("P3 已放行", p3.status === "已放行");
assert("P3 冻结读数 2.1Ω", p3.release.frozen.resistance === "2.1", p3.release.frozen.resistance);
assert("P3 当前读数 2.3Ω（经版本）", p3.release.current.resistance === "2.3");
assert("P3 冻结班组不可变", p3.release.frozen.crew === "甲班");
assert("P3 有 1 个原因版本且留旧值", p3.versions.length === 1 && p3.versions[0].changes[0].oldValue === "2.1Ω");
const p4 = seed.find(r => r.pointId === "P4");
assert("P4 复测中，已有 1 次合格", p4.status === "复测中" && p4.retests.length === 1 && p4.retests[0].passed);
const p5 = seed.find(r => r.pointId === "P5");
assert("P5 停在异常，读数保留 6.5Ω", p5.status === "异常" && p5.resistance === "6.5");
const m = mod.consoleMetrics(seed);
assert("指标：1 异常 / 1 复测中 / 1 放行 / 1 闭锁区域",
  m.openFaults === 1 && m.pendingRetests === 1 && m.released === 1 && m.lockedAreas === 1,
  JSON.stringify(m));

// ---- 重载一致性 ----
mod.saveRecords(seed);
const reloaded = mod.loadRecords();
assert("重载后记录数一致", reloaded.length === seed.length);
assert("重载后异常/复测/版本对应一致",
  reloaded.find(r => r.id === "seed-3").versions.length === 1 &&
  reloaded.find(r => r.id === "seed-4").retests.length === 1 &&
  reloaded.find(r => r.id === "seed-5").status === "异常");

// ---- 走 store：全新状态下跑完整流程 ----
globalThis.localStorage.clear();
const store = mod.useInspectionStore;
store.getState().clearAll();
assert("清空后无记录", store.getState().records.length === 0);
const baseDraft = {
  pointId: "P1", shift: "白班", crew: "甲班", resistance: "5.0",
  meterId: "ZC-3001", meterFault: false, calibratedAt: today(),
  checkedAt: today(), note: "超标"
};
const r1 = store.getState().register(baseDraft);
assert("超 4Ω 登记成功但停在异常", r1.ok && r1.stoppedAtFault);
const rec1 = store.getState().records.find(x => x.id === r1.recordId);
assert("记录状态为异常且保留 5.0", rec1.status === "异常" && rec1.resistance === "5.0");

// 区域闭锁：加油区合格登记 P2 应被拦
const blockedNormal = store.getState().register({
  ...baseDraft, pointId: "P2", resistance: "1.0", note: ""
});
assert("加油区闭锁，P2 正常登记被拦", blockedNormal.blocked.some(b => b.ruleId === "AREA_LOCKED"));

// 同班重复也拦
const dup = store.getState().register({ ...baseDraft });
assert("P1 白班重复登记被拦", dup.blocked.some(b => b.ruleId === "DUPLICATE_POINT_SHIFT"));

// 复测：不换班被拒，输入不产生尝试
const badShift = store.getState().submitRetest(rec1.id, {
  shift: "白班", crew: "乙班", resistance: "1.2", meterId: "ZC-3001",
  meterFault: false, calibratedAt: today(), testedAt: today(), note: ""
});
assert("同班复测被拦", badShift.blocked.some(b => b.ruleId === "RETEST_SHIFT"));
assert("被拦复测不入尝试", store.getState().records.find(x => x.id === rec1.id).retests.length === 0);

// 第一次换班合格（夜班）
const t1 = store.getState().submitRetest(rec1.id, {
  shift: "夜班", crew: "丙班", resistance: "1.2", meterId: "ZC-3001",
  meterFault: false, calibratedAt: today(), testedAt: today(), note: "第一次"
});
assert("第一次换班合格，未放行", t1.ok && !t1.released);
assert("状态变为复测中", store.getState().records.find(x => x.id === rec1.id).status === "复测中");

// 第二次不换班（仍夜班）应被拦
const t2bad = store.getState().submitRetest(rec1.id, {
  shift: "夜班", crew: "甲班", resistance: "1.1", meterId: "ZC-3001",
  meterFault: false, calibratedAt: today(), testedAt: today(), note: ""
});
assert("第二次仍夜班被拦", t2bad.blocked.some(b => b.ruleId === "RETEST_SHIFT"));

// 第二次换班但不合格：中断连续，需再来两次
const t2fail = store.getState().submitRetest(rec1.id, {
  shift: "白班", crew: "甲班", resistance: "9", meterId: "ZC-3001",
  meterFault: false, calibratedAt: today(), testedAt: today(), note: "又超"
});
assert("换班但不合格：留存不放行", t2fail.ok && !t2fail.released && t2fail.stoppedAtFault);
assert("不合格尝试已保留", store.getState().records.find(x => x.id === rec1.id).retests.length === 2);

// 夜班合格（第3次）
store.getState().submitRetest(rec1.id, {
  shift: "夜班", crew: "丙班", resistance: "1.0", meterId: "ZC-3001",
  meterFault: false, calibratedAt: today(), testedAt: today(), note: "恢复1"
});
// 白班合格（第4次）→ 连续两次，放行
const t4 = store.getState().submitRetest(rec1.id, {
  shift: "白班", crew: "甲班", resistance: "1.0", meterId: "ZC-3001",
  meterFault: false, calibratedAt: today(), testedAt: today(), note: "恢复2"
});
assert("连续两次换班合格后放行", t4.released === true);
const released = store.getState().records.find(x => x.id === rec1.id);
assert("放行后冻结读数 1.0 / 班组 甲班 / 班次白班",
  released.release.frozen.resistance === "1.0" &&
  released.release.frozen.crew === "甲班" &&
  released.release.frozen.shift === "白班");
assert("放行后加油区解除闭锁", mod.consoleMetrics(store.getState().records).lockedAreas === 0);

// 放行后无原因改动被拦
const amendBlocked = store.getState().amendReleased(rec1.id,
  { crew: "甲班", resistance: "1.1", meterId: "ZC-3001", calibratedAt: today() }, "", "");
assert("无原因改动放行记录被拦", amendBlocked.blocked.some(b => b.ruleId === "AMEND_REASON"));
assert("被拦后冻结值仍是 1.0", store.getState().records.find(x => x.id === rec1.id).release.frozen.resistance === "1.0");

// 带原因改动：另建版本、留旧值、冻结不变、现值更新
const amendOk = store.getState().amendReleased(rec1.id,
  { crew: "甲班", resistance: "1.1", meterId: "ZC-3001", calibratedAt: today() },
  "据原始单据更正", "安全员 周敏");
assert("带原因改动成功并生成版本", amendOk.ok);
const after = store.getState().records.find(x => x.id === rec1.id);
assert("冻结值保持 1.0", after.release.frozen.resistance === "1.0");
assert("现值变为 1.1", after.release.current.resistance === "1.1");
assert("版本保留旧值 1.0Ω → 1.1Ω",
  after.versions.length === 1 &&
  after.versions[0].changes[0].oldValue === "1.0Ω" &&
  after.versions[0].changes[0].newValue === "1.1Ω");

// 再重载一次，全链路仍对应
const persisted = mod.loadRecords();
const p = persisted.find(x => x.id === rec1.id);
assert("重载后放行+版本链路完整",
  p.status === "已放行" && p.versions.length === 1 && p.retests.length === 4 &&
  p.release.frozen.resistance === "1.0" && p.release.current.resistance === "1.1");

rmSync("__flow_entry.ts", { force: true });
console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
