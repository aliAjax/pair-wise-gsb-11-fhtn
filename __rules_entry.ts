
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
