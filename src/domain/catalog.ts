import type { Shift } from "./types";

// 资料层：区域、设备、接地点、班次、班组与仪器目录，独立于判定与存储。

export interface Area {
  id: string;
  name: string;
}

export interface Equipment {
  id: string;
  areaId: string;
  name: string;
}

export interface GroundPoint {
  id: string;
  equipmentId: string;
  areaId: string;
  name: string;
  code: string;
}

export interface Meter {
  id: string;
  name: string;
}

export const RESISTANCE_LIMIT_OHM = 4;
export const CALIBRATION_VALID_MONTHS = 12;

export const SHIFTS: Shift[] = ["白班", "夜班"];

/** 与原班次互斥的换班班次 */
export function otherShift(shift: Shift): Shift {
  return shift === "白班" ? "夜班" : "白班";
}

export const DEFAULT_CREWS = ["甲班", "乙班", "丙班"];

export const METERS: Meter[] = [
  { id: "ZC-3001", name: "ZC-3001 接地电阻测试仪" },
  { id: "ZC-3002", name: "ZC-3002 接地电阻测试仪" },
  { id: "BY-2581", name: "BY-2581 接地电阻测试仪" }
];

export const AREAS: Area[] = [
  { id: "A1", name: "加油区" },
  { id: "A2", name: "油罐区" },
  { id: "A3", name: "配电区" }
];

export const EQUIPMENT: Equipment[] = [
  { id: "E1", areaId: "A1", name: "1号加油机" },
  { id: "E2", areaId: "A1", name: "2号加油机" },
  { id: "E3", areaId: "A2", name: "1号储油罐" },
  { id: "E4", areaId: "A2", name: "卸油口" },
  { id: "E5", areaId: "A3", name: "配电柜" }
];

export const GROUND_POINTS: GroundPoint[] = [
  { id: "P1", areaId: "A1", equipmentId: "E1", code: "JD-A1-01", name: "1号加油机静电接地卡" },
  { id: "P2", areaId: "A1", equipmentId: "E2", code: "JD-A1-02", name: "2号加油机静电接地卡" },
  { id: "P3", areaId: "A2", equipmentId: "E3", code: "JD-A2-01", name: "1号储油罐接地极" },
  { id: "P4", areaId: "A2", equipmentId: "E3", code: "JD-A2-02", name: "1号储油罐浮盘跨接点" },
  { id: "P5", areaId: "A2", equipmentId: "E4", code: "JD-A2-03", name: "卸油口静电接地夹" },
  { id: "P6", areaId: "A3", equipmentId: "E5", code: "JD-A3-01", name: "配电柜保护接地排" }
];

export const areaName = (id: string) => AREAS.find((a) => a.id === id)?.name ?? id;
export const equipmentName = (id: string) => EQUIPMENT.find((e) => e.id === id)?.name ?? id;
export const pointName = (id: string) => GROUND_POINTS.find((p) => p.id === id)?.name ?? id;
export const pointCode = (id: string) => GROUND_POINTS.find((p) => p.id === id)?.code ?? id;

export function pointContext(pointId: string) {
  const point = GROUND_POINTS.find((p) => p.id === pointId);
  if (!point) return { areaName: "", equipmentName: "", pointName: pointId, pointCode: "" };
  return {
    areaName: areaName(point.areaId),
    equipmentName: equipmentName(point.equipmentId),
    pointName: point.name,
    pointCode: point.code
  };
}

export const RULES_TEXT = [
  `同一接地点同一班次仅允许一条登记。`,
  `仪器勾为失效、检定日缺失/超过 ${CALIBRATION_VALID_MONTHS} 个月，或接地电阻超过 ${RESISTANCE_LIMIT_OHM}Ω，即判为异常，停在异常并保留本次输入。`,
  `区域内存在未放行的异常时，复测放行前该区域不得再登记"正常"，可登记异常。`,
  `复测必须换班（与上一次有效尝试或原登记班次互斥）。`,
  `复测须连续两次合格，第二次合格时放行。`,
  `放行后冻结读数与班组；任何改动必须填写原因、另建版本并保留旧值。`
];
