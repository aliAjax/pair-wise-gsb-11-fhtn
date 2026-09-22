// 规则引擎冒烟测试（不经过界面与存储），用 esbuild 即时编译 TS。
import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const virtual = `
export { evaluateReading, calibrationValid, checkRegister, checkRetestShift, checkAmend } from "./src/domain/rules.ts";
export { GROUND_POINTS, METERS, SHIFTS, otherShift } from "./src/domain/catalog.ts";
export function makeDraft(over = {}) {
  return {
    pointId: "P5", shift: "白班", crew: "甲班", resistance: "1.0",
    meterId: "ZC-3001", meterFault: false,
    calibratedAt: new Date().toISOString().slice(0, 10),
    checkedAt: new Date().toISOString().slice(0, 10),
    note: "", ...over
  };
}
export function makeRecord(over = {}) {
  const now = new Date().toISOString();
  return {
    id: "r1", pointId: "P5", shift: "白班", crew: "乙班", resistance: "6.5",
    meterId: "ZC-3001", meterFault: false, calibratedAt: "2026-01-01",
    checkedAt: "2026-09-20", note: "", status: "异常",
    faults: [{ code: "RESISTANCE_OVER", message: "x" }],
    retests: [], versions: [], createdAt: now, updatedAt: now, ...over
  };
}
`;
writeFileSync("__rules_entry.ts", virtual);

const result = await build({
  entryPoints: ["__rules_entry.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  loader: { ".ts": "ts" }
});

const mod = await import("data:text/javascript," + encodeURIComponent(result.outputFiles[0].text));

let pass = 0;
let fail = 0;
function assert(name, cond, detail = "") {
  if (cond) { pass++; console.log("  ✅", name); }
  else { fail++; console.log("  ❌", name, detail); }
}

// 1. 电阻判定
assert("1.0Ω 合格", mod.evaluateReading(mod.makeDraft()).length === 0);
assert("4.0Ω 恰好合格", mod.evaluateReading(mod.makeDraft({ resistance: "4" })).length === 0);
assert("4.1Ω 超限", mod.evaluateReading(mod.makeDraft({ resistance: "4.1" }))[0]?.code === "RESISTANCE_OVER");
assert("空读数无效", mod.evaluateReading(mod.makeDraft({ resistance: "" }))[0]?.code === "READING_INVALID");
assert("abc 读数无效", mod.evaluateReading(mod.makeDraft({ resistance: "abc" }))[0]?.code === "READING_INVALID");

// 2. 仪器失效
const f1 = mod.evaluateReading(mod.makeDraft({ meterFault: true, resistance: "9" })).map(f => f.code);
assert("仪器失效判异常", f1.includes("INSTRUMENT_INVALID"));
assert("仪器失效时不重复判超限", !f1.includes("RESISTANCE_OVER"), f1.join(","));

// 3. 检定日
assert("检定日在 12 个月内有效", mod.calibrationValid("2026-01-01", new Date("2026-09-22")) === true);
assert("检定日超 12 个月失效", mod.calibrationValid("2025-01-01", new Date("2026-09-22")) === false);
assert("缺检定日失效", mod.calibrationValid("", new Date()) === false);
assert("缺检定日判 CALIBRATION_EXPIRED", mod.evaluateReading(mod.makeDraft({ calibratedAt: "" }))[0]?.code === "CALIBRATION_EXPIRED");

// 4. 同点位同班仅一条
const r1 = mod.makeRecord();
assert("同班重复被拦", mod.checkRegister(mod.makeDraft(), [r1]).blocked.some(b => b.ruleId === "DUPLICATE_POINT_SHIFT"));
assert("同班重复阻断含原值现值", (() => {
  const b = mod.checkRegister(mod.makeDraft(), [r1]).blocked.find(b => b.ruleId === "DUPLICATE_POINT_SHIFT");
  return b.rows.some(row => row.label === "接地电阻" && row.old === "6.5Ω" && row.current === "1.0Ω");
})());
assert("同班登记异常（6.5Ω）也被重复规则拦", (() => {
  const res = mod.checkRegister(mod.makeDraft({ resistance: "9" }), [r1]);
  return res.blocked.some(b => b.ruleId === "DUPLICATE_POINT_SHIFT");
})());
assert("换班（夜班）不受重复限制", (() => {
  const normal = mod.makeRecord({ id: "n1", pointId: "P6", status: "正常", faults: [], resistance: "1.2" });
  const res = mod.checkRegister(mod.makeDraft({ pointId: "P5", shift: "夜班" }), [normal]);
  return !res.blocked.some(b => b.ruleId === "DUPLICATE_POINT_SHIFT");
})());

// 5. 区域闭锁：油罐区（P3/P4/P5）有未放行异常时，合格登记被拦，异常登记可入
const openFault = mod.makeRecord();
const goodDraft = mod.makeDraft({ pointId: "P4", resistance: "1.5" });
const res5 = mod.checkRegister(goodDraft, [openFault]);
assert("区域有异常时合格登记被 AREA_LOCKED 拦", res5.blocked.some(b => b.ruleId === "AREA_LOCKED"));
assert("闭锁阻断列出未放行点位原值", (() => {
  const b = res5.blocked.find(b => b.ruleId === "AREA_LOCKED");
  return b.rows.some(row => row.old.includes("6.5Ω") && row.current === "等待复测放行");
})());
const badDraft = mod.makeDraft({ pointId: "P4", resistance: "9" });
const res5b = mod.checkRegister(badDraft, [openFault]);
assert("区域闭锁下异常读数仍可登记（无 AREA_LOCKED）", !res5b.blocked.some(b => b.ruleId === "AREA_LOCKED"));
assert("异常读数登记 stoppedAtFault", res5b.stoppedAtFault === true);

// 配电区正常不受油罐区异常影响
const res5c = mod.checkRegister(mod.makeDraft({ pointId: "P6", resistance: "1.0" }), [openFault]);
assert("其它区域（配电区）合格登记不被拦", res5c.ok === true);

// 已放行记录不再闭锁区域
const released = mod.makeRecord({ status: "已放行", faults: [] });
const res5d = mod.checkRegister(mod.makeDraft({ pointId: "P4", resistance: "1.0" }), [released]);
assert("异常已放行后区域解除闭锁", res5d.ok === true);

// 6. 复测必须换班
assert("原白班 → 白班复测被拒", mod.checkRetestShift(mod.makeRecord(), "白班").allowed === false);
assert("原白班 → 夜班复测允许", mod.checkRetestShift(mod.makeRecord(), "夜班").allowed === true);
const withOne = mod.makeRecord({ retests: [{ ...baseAttempt(), shift: "夜班" }] });
assert("一次夜班后 → 夜班再测被拒", mod.checkRetestShift(withOne, "夜班").allowed === false);
assert("一次夜班后 → 白班再测允许", mod.checkRetestShift(withOne, "白班").allowed === true);

function baseAttempt() {
  return {
    id: "a1", seq: 1, crew: "丙班", resistance: "1.9", meterId: "BY-2581",
    meterFault: false, calibratedAt: "2026-09-01", testedAt: "2026-09-21",
    note: "", passed: true, faults: []
  };
}

// 7. 原因版本校验
assert("无改动且无原因 -> 两条阻断", mod.checkAmend([], "").length === 2);
assert("有改动但无原因 -> AMEND_REASON", mod.checkAmend([{ field: "resistance", label: "接地电阻", old: "2.1Ω", current: "2.3Ω" }], "").some(b => b.ruleId === "AMEND_REASON"));
assert("有改动且有原因 -> 放行", mod.checkAmend([{ field: "resistance", label: "x", old: "1", current: "2" }], "更正").length === 0);

console.log(`\n结果：通过 ${pass}，失败 ${fail}`);
process.exit(fail ? 1 : 0);
