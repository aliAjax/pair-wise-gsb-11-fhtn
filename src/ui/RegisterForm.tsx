import { useEffect, useMemo, useState } from "react";
import {
  AREAS,
  DEFAULT_CREWS,
  EQUIPMENT,
  GROUND_POINTS,
  METERS,
  RESISTANCE_LIMIT_OHM,
  SHIFTS,
  pointContext
} from "../domain/catalog";
import type { ActionResult, ReadingDraft, Shift } from "../domain/types";
import { useInspectionStore } from "../state/store";
import { BlockList } from "./BlockList";

function today() {
  return new Date().toISOString().slice(0, 10);
}

const blank: Omit<ReadingDraft, "pointId"> = {
  shift: "白班",
  crew: DEFAULT_CREWS[0],
  resistance: "",
  meterId: METERS[0].id,
  meterFault: false,
  calibratedAt: "",
  checkedAt: today(),
  note: ""
};

export interface RegisterFormProps {
  prefillPointId?: string | null;
  onConsumed?: () => void;
}

/** 登记台：区域 → 设备 → 接地点 → 班次，录入电阻与仪器检定日 */
export function RegisterForm({ prefillPointId, onConsumed }: RegisterFormProps) {
  const register = useInspectionStore((s) => s.register);
  const records = useInspectionStore((s) => s.records);

  const [areaId, setAreaId] = useState(GROUND_POINTS[0].areaId);
  const [equipmentId, setEquipmentId] = useState(GROUND_POINTS[0].equipmentId);
  const [pointId, setPointId] = useState<string>(prefillPointId ?? GROUND_POINTS[0].id);
  const [form, setForm] = useState<Omit<ReadingDraft, "pointId">>(blank);
  const [feedback, setFeedback] = useState<ActionResult | null>(null);

  // 从点位总览"去登记"带入点位时，同步级联的区域与设备
  useEffect(() => {
    if (!prefillPointId) return;
    const point = GROUND_POINTS.find((p) => p.id === prefillPointId);
    if (point) {
      setAreaId(point.areaId);
      setEquipmentId(point.equipmentId);
      setPointId(point.id);
    }
  }, [prefillPointId]);

  const points = useMemo(
    () => GROUND_POINTS.filter((p) => p.equipmentId === equipmentId),
    [equipmentId]
  );

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function changeArea(nextArea: string) {
    setAreaId(nextArea);
    const firstEquipment = EQUIPMENT.find((e) => e.areaId === nextArea);
    if (firstEquipment) {
      setEquipmentId(firstEquipment.id);
      const firstPoint = GROUND_POINTS.find((p) => p.equipmentId === firstEquipment.id);
      if (firstPoint) setPointId(firstPoint.id);
    }
  }

  function changeEquipment(nextEquipment: string) {
    setEquipmentId(nextEquipment);
    const firstPoint = GROUND_POINTS.find((p) => p.equipmentId === nextEquipment);
    if (firstPoint) setPointId(firstPoint.id);
  }

  // 点位总览点击"去登记"时携带点位
  const effectivePointId = prefillPointId ?? pointId;
  const lockedHint = useMemo(() => {
    const area = pointContext(effectivePointId);
    const open = records.filter(
      (r) =>
        pointContext(r.pointId).areaName === area.areaName &&
        (r.status === "异常" || r.status === "复测中")
    );
    return open;
  }, [effectivePointId, records]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const draft: ReadingDraft = { ...form, pointId: effectivePointId };
    const result = register(draft);
    setFeedback(result);
    if (result.ok && !result.stoppedAtFault) {
      // 仅正常登记成功才清空；受阻或停在异常都保留输入
      setForm(blank);
      onConsumed?.();
    }
  }

  const ctx = pointContext(effectivePointId);

  return (
    <form className="panel register-form" onSubmit={submit}>
      <div className="panel-head">
        <h2>接地巡检登记台</h2>
        <span className="hint">限值 {RESISTANCE_LIMIT_OHM}Ω · 检定 12 个月</span>
      </div>

      <div className="form-grid">
        <label>
          区域
          <select value={areaId} onChange={(e) => changeArea(e.target.value)}>
            {AREAS.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>

        <label>
          设备
          <select value={equipmentId} onChange={(e) => changeEquipment(e.target.value)}>
            {EQUIPMENT.filter((e) => e.areaId === areaId).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </label>

        <label className="span-2">
          接地点
          <select value={effectivePointId} onChange={(e) => { setPointId(e.target.value); onConsumed?.(); }}>
            {points.map((p) => (
              <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
            ))}
          </select>
        </label>

        <label>
          班次
          <select value={form.shift} onChange={(e) => update("shift", e.target.value as Shift)}>
            {SHIFTS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label>
          班组
          <input
            list="crew-options"
            value={form.crew}
            onChange={(e) => update("crew", e.target.value)}
            placeholder="如：甲班"
            required
          />
          <datalist id="crew-options">
            {DEFAULT_CREWS.map((c) => <option key={c} value={c} />)}
          </datalist>
        </label>

        <label>
          接地电阻（Ω）
          <input
            type="number"
            step="0.1"
            min="0"
            value={form.resistance}
            onChange={(e) => update("resistance", e.target.value)}
            placeholder={`≤ ${RESISTANCE_LIMIT_OHM}Ω 为合格`}
          />
        </label>

        <label>
          巡检日
          <input
            type="date"
            value={form.checkedAt}
            onChange={(e) => update("checkedAt", e.target.value)}
            required
          />
        </label>

        <label>
          测试仪器
          <select value={form.meterId} onChange={(e) => update("meterId", e.target.value)}>
            {METERS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>

        <label>
          仪器检定日
          <input
            type="date"
            value={form.calibratedAt}
            onChange={(e) => update("calibratedAt", e.target.value)}
          />
        </label>

        <label className="check-line span-2">
          <input
            type="checkbox"
            checked={form.meterFault}
            onChange={(e) => update("meterFault", e.target.checked)}
          />
          <span>仪器失效（开机异常 / 超差 / 无显示，读数不可采信）</span>
        </label>

        <label className="span-2">
          现场备注
          <textarea
            value={form.note}
            onChange={(e) => update("note", e.target.value)}
            placeholder="天气、接地体外观、处理措施等"
          />
        </label>
      </div>

      {lockedHint.length > 0 && (
        <div className="inline-warn">
          ⚠ {ctx.areaName}当前有 {lockedHint.length} 条未放行异常（
          {lockedHint.map((r) => pointContext(r.pointId).pointCode).join("、")}
          ）；复测放行前，本区域合格读数将被拦下，仍可登记异常。
        </div>
      )}

      <div className="form-actions">
        <button type="submit">提交登记</button>
        <button
          type="button"
          className="secondary"
          onClick={() => { setForm(blank); setFeedback(null); }}
        >
          清空输入
        </button>
      </div>

      {feedback && !feedback.ok && <BlockList blocked={feedback.blocked} />}
      {feedback && <RegisterFeedback result={feedback} />}
    </form>
  );
}

function RegisterFeedback({ result }: { result: ActionResult }) {
  if (result.ok && !result.stoppedAtFault) {
    return (
      <div className="feedback ok">
        <strong>登记成功</strong>
        <span>判定为「正常」。区域内无未放行异常时正常记录生效。</span>
      </div>
    );
  }
  if (result.ok && result.stoppedAtFault) {
    return (
      <div className="feedback fault">
        <strong>已停在「异常」</strong>
        <span>本次输入已原样保留为异常记录，等待换班复测（连续两次合格后放行）。</span>
      </div>
    );
  }
  return null;
}
