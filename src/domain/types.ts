// 领域模型：区域 / 设备 / 接地点 / 班次 / 巡检记录 / 复测 / 版本 / 阻断原因

export type Shift = "白班" | "夜班";

export type FaultCode =
  | "INSTRUMENT_INVALID" // 仪器失效
  | "CALIBRATION_EXPIRED" // 检定日缺失或超出有效期
  | "RESISTANCE_OVER" // 电阻超过 4Ω
  | "READING_INVALID"; // 电阻读数无法识别

export interface Fault {
  code: FaultCode;
  message: string;
}

/** 正常 / 异常（停在异常）/ 复测中 / 已放行 */
export type CheckStatus = "正常" | "异常" | "复测中" | "已放行";

/** 登记输入（也是一次读数的完整资料） */
export interface ReadingDraft {
  pointId: string;
  shift: Shift;
  crew: string;
  resistance: string; // 以字符串保存，异常时原样保留输入
  meterId: string;
  meterFault: boolean; // 仪器失效
  calibratedAt: string; // 仪器检定日 YYYY-MM-DD
  checkedAt: string; // 巡检日 YYYY-MM-DD
  note: string;
}

/** 复测输入 */
export interface RetestDraft {
  shift: Shift;
  crew: string;
  resistance: string;
  meterId: string;
  meterFault: boolean;
  calibratedAt: string;
  testedAt: string;
  note: string;
}

/** 一次复测尝试：无论合格与否都保留读数与判定 */
export interface RetestAttempt extends RetestDraft {
  id: string;
  seq: number;
  passed: boolean;
  faults: Fault[];
}

export interface FieldChange {
  field: string;
  label: string;
  oldValue: string;
  newValue: string;
}

/** 放行后的原因版本：留旧值与改动原因 */
export interface VersionRecord {
  id: string;
  versionNo: number;
  reason: string;
  changedBy: string;
  changedAt: string;
  changes: FieldChange[];
  snapshot: Record<string, string | number | boolean>;
}

/** 放行时刻冻结的读数与班组 */
export interface FrozenReading {
  shift: Shift;
  crew: string;
  resistance: string;
  meterId: string;
  meterFault: boolean;
  calibratedAt: string;
  testedAt: string;
}

export interface ReleaseInfo {
  releasedAt: string;
  /** 放行时刻冻结的读数与班组 */
  frozen: FrozenReading;
  /** 放行后经原因版本更新的现值；从未改动时与 frozen 相同 */
  current: FrozenReading;
}

export interface InspectionRecord {
  id: string;
  pointId: string;
  // 初始登记读数
  shift: Shift;
  crew: string;
  resistance: string;
  meterId: string;
  meterFault: boolean;
  calibratedAt: string;
  checkedAt: string;
  note: string;
  // 判定与流转
  status: CheckStatus;
  faults: Fault[];
  retests: RetestAttempt[];
  release?: ReleaseInfo;
  versions: VersionRecord[];
  createdAt: string;
  updatedAt: string;
}

/** 受阻时的一条说明：规则 + 原值 / 现值逐行对照 */
export interface BlockRow {
  label: string;
  old: string;
  current: string;
}

export type RuleId =
  | "DUPLICATE_POINT_SHIFT" // 同点位同班仅一条
  | "AREA_LOCKED" // 复测前该区域不得登记正常
  | "RETEST_SHIFT" // 复测须换班
  | "AMEND_REASON" // 改动放行记录必须填原因
  | "AMEND_NO_CHANGE"; // 无实际改动不生成版本

export interface BlockDetail {
  ruleId: RuleId;
  rule: string;
  rows: BlockRow[];
  refRecordId?: string;
}

export interface ActionResult {
  ok: boolean;
  blocked: BlockDetail[];
  recordId?: string;
  /** 本次提交是否被判定为异常（停在异常、保留输入） */
  stoppedAtFault?: boolean;
  /** 本次复测是否触发放行 */
  released?: boolean;
}
