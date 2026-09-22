import { useMemo, useState } from "react";
import {
  DEFAULT_CREWS,
  METERS,
  SHIFTS,
  otherShift,
  pointContext
} from "../domain/catalog";
import { checkRetestShift } from "../domain/rules";
import type { ActionResult, InspectionRecord, RetestDraft, Shift } from "../domain/types";
import { useInspectionStore } from "../state/store";
import { BlockList } from "./BlockList";
import { FaultChips, StatusTag, fmtResistance } from "./common";

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** 异常 / 复测中看板：每条记录内嵌复测台 */
export function AnomalyBoard() {
  const records = useInspectionStore((s) => s.records);
  const open = useMemo(
    () =>
      records
        .filter((r) => r.status === "异常" || r.status === "复测中")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [records]
  );

  return (
    <section className="board">
      <header className="board-head">
        <h2>异常与复测放行</h2>
        <span className="count-pill">{open.length} 条待处理</span>
      </header>

      {open.length === 0 ? (
        <div className="empty">当前没有异常或复测中的接地点。</div>
      ) : (
        <div className="record-stack">
          {open.map((record) => (
            <OpenRecordCard key={record.id} record={record} />
          ))}
        </div>
      )}
    </section>
  );
}

function OpenRecordCard({ record }: { record: InspectionRecord }) {
  const ctx = pointContext(record.pointId);
  const requiredShift = otherShift(
    record.retests.length ? record.retests[record.retests.length - 1].shift : record.shift
  );

  return (
    <article className={`record-card open-card ${record.status === "异常" ? "is-fault" : "is-retest"}`}>
      <div className="record-head">
        <div>
          <p className="crumb">
            {ctx.areaName} <span>/</span> {ctx.equipmentName} <span>/</span> {ctx.pointCode}
          </p>
          <h3>{ctx.pointName}</h3>
        </div>
        <StatusTag status={record.status} />
      </div>

      <div className="kv-grid">
        <div><span>原登记班次</span><strong>{record.shift}</strong></div>
        <div><span>原班组</span><strong>{record.crew}</strong></div>
        <div><span>原读数</span><strong className="bad">{fmtResistance(record.resistance)}</strong></div>
        <div><span>原仪器 / 检定日</span><strong>{record.meterId} · {record.calibratedAt || "未填"}</strong></div>
      </div>

      <FaultChips faults={record.faults} />
      {record.note && <p className="record-note">📝 {record.note}</p>}

      {record.retests.length > 0 && <RetestTimeline record={record} />}

      <RetestForm
        record={record}
        requiredShift={requiredShift}
      />
    </article>
  );
}

function RetestProgress({ record }: { record: InspectionRecord }) {
  // 从最后一次复测往前数连续合格次数
  let streak = 0;
  for (let i = record.retests.length - 1; i >= 0; i--) {
    if (record.retests[i].passed) streak += 1;
    else break;
  }
  const remaining = Math.max(0, 2 - streak);
  return (
    <p className="timeline-hint">
      当前连续合格 {streak} 次，还需 {remaining} 次换班合格复测放行
      {streak === 0 && "（上一次不合格，连续性已中断，需重新累计）"}。
    </p>
  );
}

function RetestTimeline({ record }: { record: InspectionRecord }) {  return (
    <div className="timeline">
      <p className="timeline-title">复测记录（须连续两次合格）</p>
      {record.retests.map((attempt) => (
        <div className={`timeline-item ${attempt.passed ? "pass" : "fail"}`} key={attempt.id}>
          <div className="timeline-dot">{attempt.seq}</div>
          <div className="timeline-body">
            <header>
              <strong>第 {attempt.seq} 次复测 · {attempt.shift} · {attempt.crew}</strong>
              <span className={`attempt-tag ${attempt.passed ? "pass" : "fail"}`}>
                {attempt.passed ? "合格" : "不合格"}
              </span>
            </header>
            <p>
              {fmtResistance(attempt.resistance)} · {attempt.meterId} · 检定 {attempt.calibratedAt || "未填"} · {attempt.testedAt}
            </p>
            {attempt.faults.length > 0 && <FaultChips faults={attempt.faults} />}
            {attempt.note && <p className="record-note">{attempt.note}</p>}
          </div>
        </div>
      ))}
      {record.status === "复测中" && (
        <RetestProgress record={record} />
      )}
    </div>
  );
}

function RetestForm({
  record,
  requiredShift
}: {
  record: InspectionRecord;
  requiredShift: Shift;
}) {
  const submitRetest = useInspectionStore((s) => s.submitRetest);
  const [form, setForm] = useState<RetestDraft>({
    shift: requiredShift,
    crew: DEFAULT_CREWS[0],
    resistance: "",
    meterId: METERS[0].id,
    meterFault: false,
    calibratedAt: "",
    testedAt: today(),
    note: ""
  });
  const [result, setResult] = useState<ActionResult | null>(null);

  const shiftOk = checkRetestShift(record, form.shift).allowed;

  function update<K extends keyof RetestDraft>(key: K, value: RetestDraft[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const res = submitRetest(record.id, form);
    setResult(res);
    if (res.ok) {
      // 放行或复测入档后，清空读数/备注，班次更新为下一次应换的班
      setForm((prev) => ({
        ...prev,
        shift: otherShift(form.shift),
        resistance: "",
        meterFault: false,
        calibratedAt: "",
        testedAt: today(),
        note: ""
      }));
    }
  }

  return (
    <form className="retest-form" onSubmit={submit}>
      <div className="retest-title">
        <h4>复测登记</h4>
        <span className={shiftOk ? "shift-ok" : "shift-bad"}>
          {shiftOk ? `本次应为「${requiredShift}」，班次符合` : `必须换班：本次应使用「${requiredShift}」`}
        </span>
      </div>

      <div className="form-grid compact">
        <label>
          复测班次
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
            required
          />
        </label>
        <label>
          复测电阻（Ω）
          <input
            type="number"
            step="0.1"
            min="0"
            value={form.resistance}
            onChange={(e) => update("resistance", e.target.value)}
            placeholder="≤ 4Ω"
          />
        </label>
        <label>
          复测日
          <input
            type="date"
            value={form.testedAt}
            onChange={(e) => update("testedAt", e.target.value)}
            required
          />
        </label>
        <label>
          仪器
          <select value={form.meterId} onChange={(e) => update("meterId", e.target.value)}>
            {METERS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label>
          检定日
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
          <span>仪器失效</span>
        </label>
        <label className="span-2">
          复测备注
          <textarea
            value={form.note}
            onChange={(e) => update("note", e.target.value)}
            placeholder="处理措施、天气、复测人补充说明"
          />
        </label>
      </div>

      <div className="form-actions">
        <button type="submit">提交复测</button>
      </div>

      {result && !result.ok && <BlockList blocked={result.blocked} />}
      {result?.ok && result.released && (
        <div className="feedback ok">
          <strong>✅ 已放行</strong>
          <span>连续两次换班复测均合格，读数与班组已冻结；如需改动请在「已放行台账」中走原因版本。</span>
        </div>
      )}
      {result?.ok && !result.released && (
        <div className={result.stoppedAtFault ? "feedback fault" : "feedback info"}>
          <strong>{result.stoppedAtFault ? "复测不合格，已留存" : "第一次复测合格"}</strong>
          <span>
            {result.stoppedAtFault
              ? "本次读数已保留，连续性中断，需重新换班累计两次合格。"
              : "还需换班再完成一次合格复测方可放行。"}
          </span>
        </div>
      )}
    </form>
  );
}
