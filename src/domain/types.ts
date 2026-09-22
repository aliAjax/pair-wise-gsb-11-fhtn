// 领域类型：巡检记录、异常单、复测条目、版本留痕。
// 只描述数据结构，不含判定、存储与界面逻辑。

export type RecordStatus = "正常" | "异常";
export type RecordKind = "巡检" | "复测";
export type ExceptionStatus = "待复测" | "复测中" | "待放行" | "已放行";

/** 冻结后每次变更留下的旧值版本 */
export interface RecordVersion {
  versionNo: number;
  changedAt: string;
  changedBy: string;
  reason: string;
  previous: {
    resistance: number;
    shift: string;
    inspector: string;
    instrumentId: string;
    instrumentValidUntil: string;
    measuredAt: string;
  };
}

/** 巡检/复测记录：按区域、设备、接地点、班次记录电阻与检定日 */
export interface InspectionRecord {
  id: string;
  pointId: string;
  kind: RecordKind;
  shift: string;
  inspector: string;
  resistance: number;
  instrumentId: string;
  instrumentValidUntil: string; // 检定日快照，不随仪器资料后续变化
  measuredAt: string;
  status: RecordStatus;
  problems: string[]; // 判定出的异常原因，正常时为空
  exceptionId?: string; // 关联异常单
  note: string;
  frozen: boolean; // 放行后冻结读数与班组
  versions: RecordVersion[];
  createdAt: string;
}

/** 异常单上的一次复测 */
export interface RetestEntry {
  id: string;
  recordId: string; // 对应的复测记录
  shift: string;
  inspector: string;
  resistance: number;
  instrumentId: string;
  instrumentValidUntil: string;
  measuredAt: string;
  qualified: boolean; // 电阻达标且仪器有效才计入放行条件
  problems: string[];
  createdAt: string;
}

/** 异常单：仪器失效或电阻超限即生成，复测两次合格才放行 */
export interface ExceptionOrder {
  id: string;
  pointId: string;
  areaId: string; // 冗余区域，便于区域封锁判定
  sourceRecordId: string; // 触发异常的原始记录（保留的输入）
  reason: string;
  shift: string; // 异常登记班次，复测须换班
  status: ExceptionStatus;
  retests: RetestEntry[];
  createdAt: string;
  releasedAt?: string;
}

export interface AppState {
  records: InspectionRecord[];
  exceptions: ExceptionOrder[];
}
