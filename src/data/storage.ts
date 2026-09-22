import type {
  CheckStatus,
  Fault,
  FaultCode,
  FrozenReading,
  InspectionRecord,
  RetestAttempt,
  Shift,
  VersionRecord
} from "../domain/types";

// 存储层：只负责 localStorage 的序列化、载入与演示数据，独立于判定规则与界面。

const STORAGE_KEY = "dfwlfront-10-grounding-console-v1";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function isoNow(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

interface SeedRetest {
  shift: Shift;
  crew: string;
  resistance: string;
  meterId: string;
  meterFault: boolean;
  calibratedAt: string;
  testedAt: string;
  note: string;
  passed: boolean;
  faults?: Array<[FaultCode, string]>;
}

interface SeedVersion {
  reason: string;
  changedBy: string;
  daysAgo: number;
  changes: Array<{ field: string; label: string; oldValue: string; newValue: string }>;
}

interface SeedSpec {
  id: string;
  pointId: string;
  shift: Shift;
  crew: string;
  resistance: string;
  meterId: string;
  meterFault: boolean;
  calibratedAt: string;
  checkedAt: string;
  note: string;
  status: CheckStatus;
  faults: Array<[FaultCode, string]>;
  retests: SeedRetest[];
  releasedCurrent?: Partial<FrozenReading>;
  versions?: SeedVersion[];
}

function faultsOf(pairs: Array<[FaultCode, string]>): Fault[] {
  return pairs.map(([code, message]) => ({ code, message }));
}

function buildSeed(): InspectionRecord[] {
  const specs: SeedSpec[] = [
    {
      id: "seed-1",
      pointId: "P1",
      shift: "白班",
      crew: "甲班",
      resistance: "1.8",
      meterId: "ZC-3001",
      meterFault: false,
      calibratedAt: isoDaysAgo(80),
      checkedAt: isoDaysAgo(0),
      note: "加油岛静电卡接触良好，卡簧有力。",
      status: "正常",
      faults: [],
      retests: []
    },
    {
      id: "seed-2",
      pointId: "P2",
      shift: "夜班",
      crew: "丙班",
      resistance: "2.6",
      meterId: "ZC-3002",
      meterFault: false,
      calibratedAt: isoDaysAgo(40),
      checkedAt: isoDaysAgo(0),
      note: "雨后检查，接地极表面干燥后读数稳定。",
      status: "正常",
      faults: [],
      retests: []
    },
    {
      id: "seed-3",
      pointId: "P3",
      shift: "白班",
      crew: "乙班",
      resistance: "5.2",
      meterId: "ZC-3001",
      meterFault: false,
      calibratedAt: isoDaysAgo(200),
      checkedAt: isoDaysAgo(2),
      note: "检定过期且初测 5.2Ω，重新打磨接地面并更换检定合格仪器。",
      status: "已放行",
      faults: [
        ["CALIBRATION_EXPIRED", `仪器检定日 ${isoDaysAgo(200)} 已超过 12 个月有效期`],
        ["RESISTANCE_OVER", "接地电阻 5.2Ω 超过限值 4Ω"]
      ],
      retests: [
        {
          shift: "夜班",
          crew: "丙班",
          resistance: "1.9",
          meterId: "BY-2581",
          meterFault: false,
          calibratedAt: isoDaysAgo(15),
          testedAt: isoDaysAgo(1),
          note: "处理后第一次复测，换夜班执行。",
          passed: true
        },
        {
          shift: "白班",
          crew: "甲班",
          resistance: "2.1",
          meterId: "BY-2581",
          meterFault: false,
          calibratedAt: isoDaysAgo(15),
          testedAt: isoDaysAgo(1),
          note: "第二次复测合格，换白班执行，予以放行。",
          passed: true
        }
      ],
      releasedCurrent: { resistance: "2.3" },
      versions: [
        {
          reason: "台账誊抄错误：仪器实际显示 2.3Ω，放行单误记为 2.1Ω，据复测原始单据更正。",
          changedBy: "安全员 周敏",
          daysAgo: 0,
          changes: [
            { field: "resistance", label: "接地电阻", oldValue: "2.1Ω", newValue: "2.3Ω" }
          ]
        }
      ]
    },
    {
      id: "seed-4",
      pointId: "P4",
      shift: "夜班",
      crew: "丙班",
      resistance: "",
      meterId: "ZC-3002",
      meterFault: true,
      calibratedAt: isoDaysAgo(20),
      checkedAt: isoDaysAgo(1),
      note: "仪器开机报警失效，读数留空，已停用送检。",
      status: "复测中",
      faults: [["INSTRUMENT_INVALID", "仪器失效，读数不可采信"]],
      retests: [
        {
          shift: "白班",
          crew: "甲班",
          resistance: "2.0",
          meterId: "BY-2581",
          meterFault: false,
          calibratedAt: isoDaysAgo(10),
          testedAt: isoDaysAgo(0),
          note: "更换合格仪器后第一次复测合格，等待第二次换班复测。",
          passed: true
        }
      ]
    },
    {
      id: "seed-5",
      pointId: "P5",
      shift: "白班",
      crew: "乙班",
      resistance: "6.5",
      meterId: "ZC-3001",
      meterFault: false,
      calibratedAt: isoDaysAgo(30),
      checkedAt: isoDaysAgo(0),
      note: "卸油静电夹连接线锈蚀断股，电阻超标，已更换连接线待复测。",
      status: "异常",
      faults: [["RESISTANCE_OVER", "接地电阻 6.5Ω 超过限值 4Ω"]],
      retests: []
    },
    {
      id: "seed-6",
      pointId: "P6",
      shift: "白班",
      crew: "甲班",
      resistance: "1.2",
      meterId: "BY-2581",
      meterFault: false,
      calibratedAt: isoDaysAgo(60),
      checkedAt: isoDaysAgo(1),
      note: "保护接地排螺栓紧固，标识清晰。",
      status: "正常",
      faults: [],
      retests: []
    }
  ];

  return specs.map((spec, index) => {
    const retests: RetestAttempt[] = spec.retests.map((r, i) => {
      const { passed, faults, ...draft } = r;
      return {
        ...draft,
        id: `${spec.id}-r${i + 1}`,
        seq: i + 1,
        passed,
        faults: faultsOf(faults ?? [])
      };
    });

    let release: InspectionRecord["release"];
    if (spec.status === "已放行" && retests.length >= 2) {
      const last = retests[retests.length - 1];
      const frozen: FrozenReading = {
        shift: last.shift,
        crew: last.crew,
        resistance: last.resistance,
        meterId: last.meterId,
        meterFault: last.meterFault,
        calibratedAt: last.calibratedAt,
        testedAt: last.testedAt
      };
      release = {
        releasedAt: isoNow(1),
        frozen,
        current: { ...frozen, ...spec.releasedCurrent }
      };
    }

    const record: InspectionRecord = {
      id: spec.id,
      pointId: spec.pointId,
      shift: spec.shift,
      crew: spec.crew,
      resistance: spec.resistance,
      meterId: spec.meterId,
      meterFault: spec.meterFault,
      calibratedAt: spec.calibratedAt,
      checkedAt: spec.checkedAt,
      note: spec.note,
      status: spec.status,
      faults: faultsOf(spec.faults),
      retests,
      release,
      versions: [],
      createdAt: isoNow(index + 1),
      updatedAt: isoNow(0)
    };

    record.versions = (spec.versions ?? []).map((v, i) => ({
      id: `${spec.id}-v${i + 1}`,
      versionNo: i + 1,
      reason: v.reason,
      changedBy: v.changedBy,
      changedAt: isoNow(v.daysAgo),
      changes: v.changes.map((c) => ({
        field: c.field,
        label: c.label,
        oldValue: c.oldValue,
        newValue: c.newValue
      })),
      // 版本快照：改动后该记录的现值（冻结值不可变，仅用于留存比对）
      snapshot: record.release
        ? { ...record.release.current }
        : {
            shift: record.shift,
            crew: record.crew,
            resistance: record.resistance,
            meterId: record.meterId,
            calibratedAt: record.calibratedAt
          }
    }));

    return record;
  });
}

function normalize(raw: unknown): InspectionRecord[] {
  if (!Array.isArray(raw)) return buildSeed();
  return raw as InspectionRecord[];
}

export function loadRecords(): InspectionRecord[] {
  try {
    // 仅在从未写入过时回落为演示数据；"[]" 是明确的空台账
    if (!localStorage.getItem(STORAGE_KEY)) return buildSeed();
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return buildSeed();
  }
}

export function saveRecords(records: InspectionRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function resetDemo(): InspectionRecord[] {
  const seed = buildSeed();
  saveRecords(seed);
  return seed;
}
