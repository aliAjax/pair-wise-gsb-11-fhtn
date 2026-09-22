import { useMemo, useState } from "react";
import { METERS, pointContext } from "../domain/catalog";
import type { ActionResult, InspectionRecord } from "../domain/types";
import { useInspectionStore } from "../state/store";
import { BlockList } from "./BlockList";
import { StatusTag, fmtResistance } from "./common";

/** 已放行台账：冻结读数与班组，改动另建原因版本 */
export function ReleasedLedger() {
  const records = useInspectionStore((s) => s.records);
  const released = useMemo(
    () =>
      records
        .filter((r) => r.status === "已放行")
        .sort((a, b) => (b.release?.releasedAt ?? "").localeCompare(a.release?.releasedAt ?? "")),
    [records]
  );
  const [amendId, setAmendId] = useState<string | null>(null);

  return (
    <section className="board">
      <header className="board-head">
        <h2>已放行台账（冻结）</h2>
        <span className="count-pill">{released.length} 条已放行</span>
      </header>

      {released.length === 0 ? (
        <div className="empty">暂无已放行记录。</div>
      ) : (
        <div className="record-stack">
          {released.map((record) => {
            const ctx = pointContext(record.pointId);
            const frozen = record.release!.frozen;
            const current = record.release!.current;
            return (
              <article className="record-card released-card" key={record.id}>
                <div className="record-head">
                  <div>
                    <p className="crumb">
                      {ctx.areaName} <span>/</span> {ctx.equipmentName} <span>/</span> {ctx.pointCode}
                    </p>
                    <h3>{ctx.pointName}</h3>
                  </div>
                  <StatusTag status="已放行" />
                </div>

                <div className="kv-grid">
                  <div><span>放行班次（冻结）</span><strong>{frozen.shift}</strong></div>
                  <div><span>放行班组（冻结）</span><strong>{frozen.crew}</strong></div>
                  <div>
                    <span>放行读数（冻结）</span>
                    <strong>{fmtResistance(frozen.resistance)}</strong>
                  </div>
                  <div><span>放行仪器</span><strong>{frozen.meterId}</strong></div>
                  <div>
                    <span>当前电阻</span>
                    <strong className={current.resistance !== frozen.resistance ? "amended" : ""}>
                      {fmtResistance(current.resistance)}
                      {current.resistance !== frozen.resistance && " · 经版本更正"}
                    </strong>
                  </div>
                  <div>
                    <span>当前班组</span>
                    <strong className={current.crew !== frozen.crew ? "amended" : ""}>
                      {current.crew}
                    </strong>
                  </div>
                  <div><span>放行时间</span><strong>{record.release!.releasedAt.slice(0, 16).replace("T", " ")}</strong></div>
                  <div><span>版本数</span><strong>v{record.versions.length}</strong></div>
                </div>

                <details className="release-path">
                  <summary>查看原始异常与复测链路（{record.retests.length} 次复测）</summary>
                  <div className="path-rows">
                    <div className="path-row origin">
                      <span>原登记 · {record.checkedAt} · {record.shift} · {record.crew}</span>
                      <strong>{fmtResistance(record.resistance)}</strong>
                    </div>
                    {record.retests.map((attempt) => (
                      <div className={`path-row ${attempt.passed ? "pass" : "fail"}`} key={attempt.id}>
                        <span>第 {attempt.seq} 次复测 · {attempt.testedAt} · {attempt.shift} · {attempt.crew}</span>
                        <strong>{fmtResistance(attempt.resistance)} · {attempt.passed ? "合格" : "不合格"}</strong>
                      </div>
                    ))}
                  </div>
                </details>

                <VersionHistory record={record} />

                <div className="form-actions">
                  <button type="button" onClick={() => setAmendId(record.id)}>
                    改动并新建原因版本
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {amendId && (
        <AmendModal
          record={released.find((r) => r.id === amendId)!}
          onClose={() => setAmendId(null)}
        />
      )}
    </section>
  );
}

function VersionHistory({ record }: { record: InspectionRecord }) {
  if (record.versions.length === 0) return null;
  return (
    <div className="version-box">
      <p className="timeline-title">原因版本（留旧值）</p>
      {record.versions.map((v) => (
        <div className="version-item" key={v.id}>
          <header>
            <strong>v{v.versionNo}</strong>
            <span>{v.changedAt.slice(0, 16).replace("T", " ")} · {v.changedBy}</span>
          </header>
          <table className="block-table">
            <tbody>
              {v.changes.map((c, i) => (
                <tr key={i}>
                  <td className="row-label">{c.label}</td>
                  <td className="row-old">{c.oldValue}</td>
                  <td className="row-current">{c.newValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="version-reason">原因：{v.reason}</p>
        </div>
      ))}
    </div>
  );
}

function AmendModal({ record, onClose }: { record: InspectionRecord; onClose: () => void }) {
  const amendReleased = useInspectionStore((s) => s.amendReleased);
  const current = record.release!.current;
  const frozen = record.release!.frozen;

  const [crew, setCrew] = useState(current.crew);
  const [resistance, setResistance] = useState(current.resistance);
  const [meterId, setMeterId] = useState(current.meterId);
  const [calibratedAt, setCalibratedAt] = useState(current.calibratedAt);
  const [reason, setReason] = useState("");
  const [changedBy, setChangedBy] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const res = amendReleased(
      record.id,
      { crew, resistance, meterId, calibratedAt },
      reason,
      changedBy
    );
    setResult(res);
    if (res.ok) onClose();
  }

  const rows = [
    { label: "班组", frozen: frozen.crew, value: crew },
    { label: "接地电阻", frozen: fmtResistance(frozen.resistance), value: fmtResistance(resistance) },
    { label: "仪器", frozen: frozen.meterId, value: meterId },
    { label: "检定日", frozen: frozen.calibratedAt, value: calibratedAt }
  ];

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h3>改动已放行记录 · 新建原因版本</h3>
          <button type="button" className="icon-btn" onClick={onClose}>×</button>
        </header>

        <p className="modal-tip">
          放行读数与班组已冻结，冻结值永不覆盖；本次改动将另存为 v{record.versions.length + 1}，并保留全部旧值。
        </p>

        <table className="block-table">
          <thead>
            <tr>
              <th>项目</th><th>放行冻结值</th><th>改动后现值</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="row-label">{r.label}</td>
                <td className="row-old">{r.frozen}</td>
                <td className="row-current">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <form className="form-grid" onSubmit={submit}>
          <label>
            班组（现值）
            <input value={crew} onChange={(e) => setCrew(e.target.value)} required />
          </label>
          <label>
            接地电阻 Ω（现值）
            <input
              type="number"
              step="0.1"
              min="0"
              value={resistance}
              onChange={(e) => setResistance(e.target.value)}
              required
            />
          </label>
          <label>
            仪器（现值）
            <select value={meterId} onChange={(e) => setMeterId(e.target.value)}>
              {METERS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label>
            检定日（现值）
            <input
              type="date"
              value={calibratedAt}
              onChange={(e) => setCalibratedAt(e.target.value)}
            />
          </label>
          <label className="span-2">
            改动原因（必填，将随版本永久留存）
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="如：经核实仪器原始记录为 XΩ，台账误录；附复测单据编号…"
            />
          </label>
          <label className="span-2">
            改动确认人
            <input
              value={changedBy}
              onChange={(e) => setChangedBy(e.target.value)}
              placeholder="如：安全员 周敏"
            />
          </label>

          {result && !result.ok && <div className="span-2"><BlockList blocked={result.blocked} /></div>}

          <div className="form-actions span-2">
            <button type="submit">保存为新版本</button>
            <button type="button" className="secondary" onClick={onClose}>取消</button>
          </div>
        </form>
      </div>
    </div>
  );
}
