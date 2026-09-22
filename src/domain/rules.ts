import {
  CALIBRATION_VALID_MONTHS,
  GROUND_POINTS,
  RESISTANCE_LIMIT_OHM,
  otherShift,
  pointContext
} from "./catalog";
import type {
  ActionResult,
  BlockDetail,
  BlockRow,
  Fault,
  InspectionRecord,
  ReadingDraft,
  RetestDraft,
  Shift
} from "./types";

// 判定层：电阻、检定、换班、区域闭锁等规则，全部为纯函数。

export function emptyBlocked(): ActionResult {
  return { ok: true, blocked: [] };
}

export function parseResistance(raw: string): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === "") return null;
  const value = Number(String(raw).trim());
  return Number.isFinite(value) ? value : null;
}

function monthDiff(from: Date, to: Date) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

/** 检定日是否在有效期内（12 个月） */
export function calibrationValid(calibratedAt: string, today = new Date()): boolean {
  if (!calibratedAt) return false;
  const date = new Date(`${calibratedAt}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  return monthDiff(date, today) <= CALIBRATION_VALID_MONTHS;
}

export interface ReadingInput {
  resistance: string;
  meterFault: boolean;
  calibratedAt: string;
}

/** 仪器失效 / 检定过期 / 电阻超 4Ω / 读数无效 */
export function evaluateReading(input: ReadingInput, today = new Date()): Fault[] {
  const faults: Fault[] = [];
  if (input.meterFault) {
    faults.push({ code: "INSTRUMENT_INVALID", message: "仪器失效，读数不可采信" });
  }

  if (!calibrationValid(input.calibratedAt, today)) {
    faults.push({
      code: "CALIBRATION_EXPIRED",
      message: input.calibratedAt
        ? `仪器检定日 ${input.calibratedAt} 已超过 ${CALIBRATION_VALID_MONTHS} 个月有效期`
        : "缺少仪器检定日，视为未在检定有效期内"
    });
  }

  const resistance = parseResistance(input.resistance);
  if (resistance === null) {
    faults.push({ code: "READING_INVALID", message: "接地电阻读数无法识别，请核对仪器显示后重新填写" });
  } else if (resistance < 0) {
    faults.push({ code: "READING_INVALID", message: "接地电阻读数不能为负值" });
  } else if (resistance > RESISTANCE_LIMIT_OHM) {
    faults.push({
      code: "RESISTANCE_OVER",
      message: `接地电阻 ${resistance}Ω 超过限值 ${RESISTANCE_LIMIT_OHM}Ω`
    });
  }

  // 仪器失效时读数不可信，不再重复给出"超 4Ω"结论
  if (input.meterFault) {
    return faults.filter((f) => f.code !== "RESISTANCE_OVER");
  }
  return faults;
}

const POINT_AREA: Record<string, string> = Object.fromEntries(
  GROUND_POINTS.map((p) => [p.id, p.areaId])
);

export function pointArea(pointId: string): string | undefined {
  return POINT_AREA[pointId];
}

/** 区域内是否存在未放行异常（异常 / 复测中） */
export function areaHasOpenFault(records: InspectionRecord[], areaId: string): boolean {
  return records.some(
    (r) =>
      POINT_AREA[r.pointId] === areaId &&
      (r.status === "异常" || r.status === "复测中")
  );
}

export function findSamePointShift(
  records: InspectionRecord[],
  pointId: string,
  shift: Shift
): InspectionRecord | undefined {
  return records.find((r) => r.pointId === pointId && r.shift === shift);
}

/** 该区域未放行异常记录（用于逐行说明） */
export function openFaultRecords(records: InspectionRecord[], areaId: string): InspectionRecord[] {
  return records.filter(
    (r) =>
      POINT_AREA[r.pointId] === areaId &&
      (r.status === "异常" || r.status === "复测中")
  );
}

function proposedRows(draft: ReadingDraft): BlockRow[] {
  const ctx = pointContext(draft.pointId);
  return [
    { label: "区域", old: "", current: ctx.areaName },
    { label: "设备", old: "", current: ctx.equipmentName },
    { label: "接地点", old: "", current: `${ctx.pointCode} ${ctx.pointName}` },
    { label: "班次", old: "", current: draft.shift },
    { label: "班组", old: "", current: draft.crew || "未填" },
    { label: "接地电阻", old: "", current: draft.resistance === "" ? "未填" : `${draft.resistance}Ω` },
    { label: "仪器", old: "", current: draft.meterId || "未选" },
    { label: "仪器失效", old: "", current: draft.meterFault ? "是" : "否" },
    { label: "检定日", old: "", current: draft.calibratedAt || "未填" }
  ];
}

/**
 * 登记前置规则：
 * 1) 同点位同班仅一条；
 * 2) 判定异常时直接登记为异常（区域闭锁只拦"正常"）；
 * 3) 判定合格但区域有未放行异常时，禁止登记正常。
 */
export function checkRegister(
  draft: ReadingDraft,
  records: InspectionRecord[]
): ActionResult {
  const blocked: BlockDetail[] = [];
  const areaId = POINT_AREA[draft.pointId];

  // 规则 1：同点位同班仅一条
  const duplicate = findSamePointShift(records, draft.pointId, draft.shift);
  if (duplicate) {
    blocked.push({
      ruleId: "DUPLICATE_POINT_SHIFT",
      rule: "同一接地点同一班次仅允许一条登记；如需变更请在已放行记录上走“原因版本”。",
      refRecordId: duplicate.id,
      rows: [
        { label: "接地点", old: `${pointContext(duplicate.pointId).pointCode} ${pointContext(duplicate.pointId).pointName}`, current: `${pointContext(draft.pointId).pointCode} ${pointContext(draft.pointId).pointName}` },
        { label: "班次", old: duplicate.shift, current: draft.shift },
        { label: "班组", old: duplicate.crew, current: draft.crew || "未填" },
        { label: "接地电阻", old: `${duplicate.resistance}Ω`, current: draft.resistance === "" ? "未填" : `${draft.resistance}Ω` },
        { label: "检定日", old: duplicate.calibratedAt, current: draft.calibratedAt || "未填" },
        { label: "状态", old: duplicate.status, current: "拟登记" }
      ]
    });
  }

  // 读数判定（异常直接允许登记，停在异常并保留输入）
  const faults = evaluateReading(draft);
  if (faults.length > 0) {
    return { ok: blocked.length === 0, blocked, stoppedAtFault: true };
  }

  // 规则 3：合格登记时区域不得存在未放行异常
  if (areaId) {
    const open = openFaultRecords(records, areaId);
    if (open.length > 0) {
      blocked.push({
        ruleId: "AREA_LOCKED",
        rule: "区域内存在未放行异常，复测合格放行前该区域不得登记“正常”；仍可登记异常读数。",
        rows: [
          ...proposedRows(draft),
          ...open.map((r) => ({
            label: `未放行点位 ${pointContext(r.pointId).pointCode}`,
            old: `${r.status} / ${r.shift} / ${r.resistance}Ω`,
            current: "等待复测放行"
          }))
        ]
      });
    }
  }

  return { ok: blocked.length === 0, blocked };
}

/** 复测规则：必须与上一次有效尝试（或原登记）换班 */
export function checkRetestShift(
  record: InspectionRecord,
  shift: Shift
): { allowed: boolean; required: Shift } {
  const attempts = record.retests;
  const required =
    attempts.length > 0
      ? otherShift(attempts[attempts.length - 1].shift)
      : otherShift(record.shift);
  return { allowed: shift === required, required };
}

export function retestBlock(
  record: InspectionRecord,
  draft: RetestDraft
): BlockDetail {
  const shiftCheck = checkRetestShift(record, draft.shift);
  const lastShift = record.retests.length
    ? record.retests[record.retests.length - 1].shift
    : record.shift;
  return {
    ruleId: "RETEST_SHIFT",
    rule: `复测必须换班：本次应使用「${shiftCheck.required}」，且须连续两次合格后方可放行。`,
    refRecordId: record.id,
    rows: [
      { label: "接地点", old: `${pointContext(record.pointId).pointCode} ${pointContext(record.pointId).pointName}`, current: "" },
      { label: "上一次班次", old: lastShift, current: "" },
      { label: "本次班次", old: "", current: draft.shift },
      { label: "要求班次", old: "", current: shiftCheck.required },
      { label: "本次电阻", old: "", current: draft.resistance === "" ? "未填" : `${draft.resistance}Ω` }
    ]
  };
}

export interface AmendChange {
  field: string;
  label: string;
  old: string;
  current: string;
}

/** 放行后改动的原因版本校验 */
export function checkAmend(changes: AmendChange[], reason: string): BlockDetail[] {
  const blocked: BlockDetail[] = [];
  if (changes.length === 0) {
    blocked.push({
      ruleId: "AMEND_NO_CHANGE",
      rule: "没有发现实际改动，不生成原因版本。",
      rows: [{ label: "改动项", old: "0 项", current: "0 项" }]
    });
  }
  if (!reason.trim()) {
    blocked.push({
      ruleId: "AMEND_REASON",
      rule: "放行后读数与班组已冻结，改动必须填写原因并另建版本，旧值会原样保留。",
      rows:
        changes.length > 0
          ? changes.map((c) => ({ label: c.label, old: c.old, current: c.current }))
          : [{ label: "改动原因", old: "", current: "（空）" }]
    });
  }
  return blocked;
}
