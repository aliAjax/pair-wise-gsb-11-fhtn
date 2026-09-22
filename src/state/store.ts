import { create } from "zustand";
import { GROUND_POINTS } from "../domain/catalog";
import {
  checkAmend,
  checkRegister,
  checkRetestShift,
  evaluateReading,
  retestBlock
} from "../domain/rules";
import type {
  ActionResult,
  BlockDetail,
  CheckStatus,
  FieldChange,
  FrozenReading,
  InspectionRecord,
  ReadingDraft,
  RetestAttempt,
  RetestDraft,
  VersionRecord
} from "../domain/types";
import { loadRecords, resetDemo, saveRecords } from "../data/storage";

// 状态层：调用判定层做规则校验、调用存储层持久化；不包含任何界面代码。

interface InspectionState {
  records: InspectionRecord[];
  ensureLoaded: () => void;
  register: (draft: ReadingDraft) => ActionResult;
  submitRetest: (recordId: string, draft: RetestDraft) => ActionResult;
  amendReleased: (
    recordId: string,
    input: { crew: string; resistance: string; meterId: string; calibratedAt: string },
    reason: string,
    changedBy: string
  ) => ActionResult;
  resetDemo: () => void;
  clearAll: () => void;
}

function persist(records: InspectionRecord[]) {
  saveRecords(records);
  return records;
}

// 模块级懒加载标志（与界面、存储均无关）
let loadAttempted = false;

function makeId() {
  return crypto.randomUUID();
}

export const useInspectionStore = create<InspectionState>((set, get) => ({
  // 懒加载：首次使用时才从存储层读取，保证存储层与状态层可独立替换/测试
  records: [],
  ensureLoaded: () => {
    if (!loadAttempted) {
      loadAttempted = true;
      set({ records: loadRecords() });
    }
  },

  register: (draft) => {
    get().ensureLoaded();
    const { records } = get();
    const check = checkRegister(draft, records);

    // 硬性规则受阻（同班重复 / 区域闭锁登记正常）：不保存，输入由界面保留
    if (check.blocked.length > 0) {
      return check;
    }

    const faults = evaluateReading(draft);
    const now = new Date().toISOString();
    const record: InspectionRecord = {
      id: makeId(),
      pointId: draft.pointId,
      shift: draft.shift,
      crew: draft.crew,
      resistance: draft.resistance, // 异常时原样保留（可能为空或超量程字符串）
      meterId: draft.meterId,
      meterFault: draft.meterFault,
      calibratedAt: draft.calibratedAt,
      checkedAt: draft.checkedAt,
      note: draft.note,
      status: faults.length > 0 ? "异常" : "正常",
      faults,
      retests: [],
      versions: [],
      createdAt: now,
      updatedAt: now
    };
    set({ records: persist([record, ...records]) });
    return { ok: true, blocked: [], recordId: record.id, stoppedAtFault: faults.length > 0 };
  },

  submitRetest: (recordId, draft) => {
    get().ensureLoaded();
    const { records } = get();
    const record = records.find((r) => r.id === recordId);
    if (!record || record.status === "已放行") {
      const blocked: BlockDetail[] = [
        {
          ruleId: "RETEST_SHIFT",
          rule: "该点位记录不存在或已放行，不能继续复测。",
          rows: []
        }
      ];
      return { ok: false, blocked };
    }

    // 规则：必须换班（换班受阻时不保留为一次尝试）
    const shiftCheck = checkRetestShift(record, draft.shift);
    if (!shiftCheck.allowed) {
      return { ok: false, blocked: [retestBlock(record, draft)] };
    }

    const faults = evaluateReading(draft);
    const passed = faults.length === 0;
    const attempt: RetestAttempt = {
      ...draft,
      id: makeId(),
      seq: record.retests.length + 1,
      passed,
      faults
    };

    // 连续两次合格才放行：失败即中断连续性，需重新累计两次
    const previousPassed = record.retests.length > 0
      ? record.retests[record.retests.length - 1].passed
      : false;
    const consecutivePassed = (previousPassed ? 1 : 0) + (passed ? 1 : 0);
    const shouldRelease = passed && consecutivePassed >= 2;

    let release: InspectionRecord["release"];
    let status: CheckStatus;
    if (shouldRelease) {
      const frozen: FrozenReading = {
        shift: draft.shift,
        crew: draft.crew,
        resistance: draft.resistance,
        meterId: draft.meterId,
        meterFault: draft.meterFault,
        calibratedAt: draft.calibratedAt,
        testedAt: draft.testedAt
      };
      release = { releasedAt: new Date().toISOString(), frozen, current: { ...frozen } };
      status = "已放行";
    } else {
      status = "复测中";
    }

    const next: InspectionRecord = {
      ...record,
      status,
      release,
      retests: [...record.retests, attempt],
      updatedAt: new Date().toISOString()
    };
    set({
      records: persist(records.map((r) => (r.id === recordId ? next : r)))
    });
    return {
      ok: true,
      blocked: [],
      recordId,
      stoppedAtFault: !passed && !shouldRelease,
      released: shouldRelease
    };
  },

  amendReleased: (recordId, input, reason, changedBy) => {
    get().ensureLoaded();
    const { records } = get();
    const record = records.find((r) => r.id === recordId);
    if (!record || record.status !== "已放行" || !record.release) {
      return {
        ok: false,
        blocked: [
          {
            ruleId: "AMEND_REASON",
            rule: "只有已放行记录可以走原因版本改动。",
            rows: []
          }
        ]
      };
    }

    const current = record.release.current;
    const candidates: FieldChange[] = [
      { field: "crew", label: "班组", oldValue: current.crew, newValue: input.crew },
      { field: "resistance", label: "接地电阻", oldValue: `${current.resistance}Ω`, newValue: `${input.resistance}Ω` },
      { field: "meterId", label: "仪器", oldValue: current.meterId, newValue: input.meterId },
      { field: "calibratedAt", label: "检定日", oldValue: current.calibratedAt, newValue: input.calibratedAt }
    ];
    const changes = candidates.filter(
      (c) => String(c.oldValue) !== String(c.newValue) && c.newValue !== ""
    );

    const blocked = checkAmend(
      changes.map((c) => ({ field: c.field, label: c.label, old: c.oldValue, current: c.newValue })),
      reason
    );
    if (blocked.length > 0) return { ok: false, blocked };

    const updatedCurrent: FrozenReading = {
      ...current,
      crew: input.crew,
      resistance: input.resistance,
      meterId: input.meterId,
      calibratedAt: input.calibratedAt
    };

    const version: VersionRecord = {
      id: makeId(),
      versionNo: record.versions.length + 1,
      reason: reason.trim(),
      changedBy: changedBy.trim() || "未署名",
      changedAt: new Date().toISOString(),
      changes,
      snapshot: { ...updatedCurrent }
    };

    const next: InspectionRecord = {
      ...record,
      release: { ...record.release, current: updatedCurrent },
      versions: [...record.versions, version],
      updatedAt: new Date().toISOString()
    };
    set({ records: persist(records.map((r) => (r.id === recordId ? next : r))) });
    return { ok: true, blocked: [], recordId };
  },

  resetDemo: () => {
    loadAttempted = true;
    set({ records: resetDemo() });
  },
  clearAll: () => {
    loadAttempted = true;
    saveRecords([]);
    set({ records: [] });
  }
}));

// ---- 选择器（供界面使用的派生数据） ----

export type PointState =
  | "clear" // 无记录
  | "正常"
  | "异常"
  | "复测中"
  | "已放行";

/** 点位对应其最新一条登记（同点位同班仅一条，但可能跨班多条） */
export function pointSummaries(records: InspectionRecord[]) {
  const byPoint = new Map<string, InspectionRecord[]>();
  for (const r of records) {
    const list = byPoint.get(r.pointId) ?? [];
    list.push(r);
    byPoint.set(r.pointId, list);
  }
  return GROUND_POINTS.map((point) => {
    const list = (byPoint.get(point.id) ?? []).slice().sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt)
    );
    const latest = list[0];
    const state: PointState = latest ? latest.status : "clear";
    const locked = list.some((r) => r.status === "异常" || r.status === "复测中");
    return { point, records: list, latest, state, locked };
  });
}

export interface ConsoleMetrics {
  points: number;
  openFaults: number;
  pendingRetests: number;
  released: number;
  normal: number;
  lockedAreas: number;
}

export function consoleMetrics(records: InspectionRecord[]): ConsoleMetrics {
  const summaries = pointSummaries(records);
  const lockedAreaIds = new Set(
    summaries.filter((s) => s.locked).map((s) => s.point.areaId)
  );
  return {
    points: GROUND_POINTS.length,
    openFaults: records.filter((r) => r.status === "异常").length,
    pendingRetests: records.filter((r) => r.status === "复测中").length,
    released: records.filter((r) => r.status === "已放行").length,
    normal: records.filter((r) => r.status === "正常").length,
    lockedAreas: lockedAreaIds.size
  };
}
