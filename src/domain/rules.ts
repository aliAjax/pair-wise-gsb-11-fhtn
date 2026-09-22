// 判定层：全部业务规则均为纯函数，不依赖界面与存储。
// 受阻时统一返回 BlockInfo：规则、原值、现值，供界面展示。

import { RESISTANCE_LIMIT } from "../data/master";
import type { ExceptionOrder, ExceptionStatus, InspectionRecord } from "./types";

export interface BlockInfo {
  rule: string;
  original: string;
  current: string;
}

export type RuleResult = { ok: true } | { ok: false; blocks: BlockInfo[] };

const pass: RuleResult = { ok: true };
const blocked = (blocks: BlockInfo[]): RuleResult => ({ ok: false, blocks });

export const RULE_TEXT = {
  limit: `电阻超过 ${RESISTANCE_LIMIT}Ω 或仪器检定失效即停在异常`,
  duplicate: "同一接地点同一班次仅允许一条记录",
  areaLocked: "复测合格放行前，该区域不得登记正常",
  retestShift: "复测须换班：不得与异常登记班次或已合格复测班次重复",
  release: "两次合格才放行",
  frozen: "放行后冻结读数与班组，改动须另建原因版本并留旧值",
};

export function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

/** 读数判定：电阻超四欧或仪器检定失效即异常 */
export function evaluateReading(
  resistance: number,
  instrumentValidUntil: string,
  measuredAt: string
): string[] {
  const problems: string[] = [];
  if (!Number.isFinite(resistance) || resistance <= 0) {
    problems.push("电阻读数无效");
  } else if (resistance > RESISTANCE_LIMIT) {
    problems.push(`电阻超限（${resistance}Ω > ${RESISTANCE_LIMIT}Ω）`);
  }
  if (measuredAt.slice(0, 10) > instrumentValidUntil) {
    problems.push(`仪器检定失效（检定至 ${instrumentValidUntil}）`);
  }
  return problems;
}

/** 同点位同班（同一班次日期）仅一条 */
export function checkDuplicate(
  records: InspectionRecord[],
  pointId: string,
  shift: string,
  measuredAt: string
): RuleResult {
  const day = measuredAt.slice(0, 10);
  const hit = records.find(
    (record) =>
      record.pointId === pointId &&
      record.shift === shift &&
      record.measuredAt.slice(0, 10) === day
  );
  if (!hit) return pass;
  return blocked([
    {
      rule: RULE_TEXT.duplicate,
      original: `已有：${hit.kind} · ${hit.shift} · ${hit.resistance}Ω · ${hit.inspector} · ${formatTime(hit.measuredAt)}`,
      current: `拟登记：${shift} · ${day}`,
    },
  ]);
}

/** 区域封锁：存在未放行异常时，该区域不得登记正常 */
export function checkAreaLocked(
  exceptions: ExceptionOrder[],
  areaId: string,
  areaName: string
): RuleResult {
  const open = exceptions.filter((item) => item.areaId === areaId && item.status !== "已放行");
  if (open.length === 0) return pass;
  return blocked(
    open.map((item) => ({
      rule: RULE_TEXT.areaLocked,
      original: `${areaName} 未放行异常：${item.reason}（${item.status}）`,
      current: "拟登记：正常",
    }))
  );
}

/** 复测换班：不得与异常登记班次、已合格复测班次重复（未合格复测不占班次） */
export function checkRetestShift(exception: ExceptionOrder, shift: string): RuleResult {
  const qualifiedShifts = exception.retests.filter((item) => item.qualified).map((item) => item.shift);
  const used = [exception.shift, ...qualifiedShifts];
  if (!used.includes(shift)) return pass;
  return blocked([
    {
      rule: RULE_TEXT.retestShift,
      original: `异常登记班次：${exception.shift}${
        qualifiedShifts.length ? `；已合格班次：${qualifiedShifts.join("、")}` : ""
      }`,
      current: `复测班次：${shift}`,
    },
  ]);
}

/** 放行条件：两次合格才放行 */
export function checkRelease(exception: ExceptionOrder): RuleResult {
  const qualified = qualifiedCount(exception);
  if (qualified >= 2) return pass;
  return blocked([
    {
      rule: RULE_TEXT.release,
      original: `合格复测 ${qualified} 次`,
      current: "放行要求 2 次合格",
    },
  ]);
}

/** 冻结变更：必须填写变更原因，旧值另存为版本 */
export function checkFrozenChange(record: InspectionRecord, reason: string): RuleResult {
  if (!record.frozen) return pass;
  if (reason.trim()) return pass;
  return blocked([
    {
      rule: RULE_TEXT.frozen,
      original: `当前值：${record.resistance}Ω · ${record.shift} · ${record.inspector} · 检定至 ${record.instrumentValidUntil}`,
      current: "变更原因：空",
    },
  ]);
}

export function qualifiedCount(exception: ExceptionOrder): number {
  return exception.retests.filter((item) => item.qualified).length;
}

/** 由合格复测次数推导异常单状态（已放行不可逆） */
export function statusFor(exception: ExceptionOrder): ExceptionStatus {
  if (exception.status === "已放行") return "已放行";
  const qualified = qualifiedCount(exception);
  if (qualified >= 2) return "待放行";
  if (qualified === 1) return "复测中";
  return "待复测";
}
