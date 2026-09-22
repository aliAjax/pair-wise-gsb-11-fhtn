// 资料层：区域、设备、接地点、班次、仪器与判定阈值等基础资料。
// 只提供静态资料与查询函数，不含判定逻辑、存储逻辑与界面代码。

export const RESISTANCE_LIMIT = 4; // Ω，接地电阻判定阈值（超过即异常）

export interface Area {
  id: string;
  name: string;
}

export interface Equipment {
  id: string;
  areaId: string;
  name: string;
}

export interface GroundingPoint {
  id: string;
  equipmentId: string;
  code: string;
  name: string;
}

export interface Instrument {
  id: string;
  name: string;
  validUntil: string; // 检定有效期（检定日），YYYY-MM-DD
}

export const SHIFTS: string[] = ["早班", "中班", "晚班"];

export const AREAS: Area[] = [
  { id: "area-fuel", name: "加油区" },
  { id: "area-tank", name: "油罐区" },
  { id: "area-unload", name: "卸油区" },
  { id: "area-shop", name: "营业厅" },
];

export const EQUIPMENT: Equipment[] = [
  { id: "eq-pump1", areaId: "area-fuel", name: "1号加油机" },
  { id: "eq-pump2", areaId: "area-fuel", name: "2号加油机" },
  { id: "eq-tank1", areaId: "area-tank", name: "1号油罐" },
  { id: "eq-tank2", areaId: "area-tank", name: "2号油罐" },
  { id: "eq-unload", areaId: "area-unload", name: "卸油口" },
  { id: "eq-pos", areaId: "area-shop", name: "收银台" },
];

export const POINTS: GroundingPoint[] = [
  { id: "pt-pump1-body", equipmentId: "eq-pump1", code: "JD-01", name: "机体接地" },
  { id: "pt-pump1-gun", equipmentId: "eq-pump1", code: "JD-02", name: "加油枪接地" },
  { id: "pt-pump2-body", equipmentId: "eq-pump2", code: "JD-03", name: "机体接地" },
  { id: "pt-pump2-gun", equipmentId: "eq-pump2", code: "JD-04", name: "加油枪接地" },
  { id: "pt-tank1-body", equipmentId: "eq-tank1", code: "JD-05", name: "罐体接地" },
  { id: "pt-tank1-vent", equipmentId: "eq-tank1", code: "JD-06", name: "呼吸阀接地" },
  { id: "pt-tank2-body", equipmentId: "eq-tank2", code: "JD-07", name: "罐体接地" },
  { id: "pt-unload-clip", equipmentId: "eq-unload", code: "JD-08", name: "静电接地夹" },
  { id: "pt-unload-post", equipmentId: "eq-unload", code: "JD-09", name: "静电释放柱" },
  { id: "pt-pos-body", equipmentId: "eq-pos", code: "JD-10", name: "设备接地" },
];

export const INSTRUMENTS: Instrument[] = [
  { id: "ins-etcr01", name: "接地电阻测试仪 ETCR2000-01", validUntil: "2027-03-31" },
  { id: "ins-etcr02", name: "接地电阻测试仪 ETCR2000-02", validUntil: "2026-08-31" },
];

export function pointById(pointId: string): GroundingPoint | undefined {
  return POINTS.find((point) => point.id === pointId);
}

export function equipmentById(equipmentId: string): Equipment | undefined {
  return EQUIPMENT.find((equipment) => equipment.id === equipmentId);
}

export function areaById(areaId: string): Area | undefined {
  return AREAS.find((area) => area.id === areaId);
}

export function instrumentById(instrumentId: string): Instrument {
  return INSTRUMENTS.find((instrument) => instrument.id === instrumentId) ?? INSTRUMENTS[0];
}

export function equipmentOfPoint(pointId: string): Equipment | undefined {
  const point = pointById(pointId);
  return point ? equipmentById(point.equipmentId) : undefined;
}

export function areaOfPoint(pointId: string): Area {
  const equipment = equipmentOfPoint(pointId);
  return (equipment ? areaById(equipment.areaId) : undefined) ?? AREAS[0];
}

export function pointPath(pointId: string): string {
  const point = pointById(pointId);
  const equipment = equipmentOfPoint(pointId);
  const area = areaOfPoint(pointId);
  if (!point || !equipment) return area.name;
  return `${area.name} / ${equipment.name} / ${point.name}`;
}
