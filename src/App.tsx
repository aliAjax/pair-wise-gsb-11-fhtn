// 界面层：只负责渲染与交互编排，判定走 domain/rules，资料走 data/master，持久化走 storage/persist。

import { FormEvent, useMemo, useState } from "react";
import {
  AREAS,
  EQUIPMENT,
  INSTRUMENTS,
  POINTS,
  RESISTANCE_LIMIT,
  SHIFTS,
  areaOfPoint,
  instrumentById,
  pointById,
  pointPath,
} from "./data/master";
import { buildSeedState } from "./data/seed";
import {
  checkAreaLocked,
  checkDuplicate,
  checkFrozenChange,
  checkRelease,
  checkRetestShift,
  evaluateReading,
  formatTime,
  qualifiedCount,
  statusFor,
  type BlockInfo,
} from "./domain/rules";
import type {
  AppState,
  ExceptionOrder,
  ExceptionStatus,
  InspectionRecord,
  RecordVersion,
  RetestEntry,
} from "./domain/types";
import { loadState, saveState } from "./storage/persist";

function nowLocal(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const blankInspection = () => ({
  areaId: "",
  equipmentId: "",
  pointId: "",
  shift: "",
  inspector: "",
  resistance: "",
  instrumentId: "",
  measuredAt: nowLocal(),
  note: "",
});

const blankRetest = () => ({
  shift: "",
  inspector: "",
  resistance: "",
  instrumentId: "",
  measuredAt: nowLocal(),
});

const blankChange = () => ({
  resistance: "",
  shift: "",
  inspector: "",
  instrumentId: "",
  measuredAt: "",
  operator: "",
  reason: "",
});

const METRIC_LABELS = ["接地点", "未放行异常", "巡检/复测记录", "已冻结记录"];
const EXCEPTION_WEIGHT: Record<ExceptionStatus, number> = {
  待复测: 0,
  复测中: 1,
  待放行: 2,
  已放行: 3,
};

export default function App() {
  const [state, setState] = useState<AppState>(loadState);
  const [form, setForm] = useState(blankInspection);
  const [retestForms, setRetestForms] = useState<Record<string, ReturnType<typeof blankRetest>>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [changeForm, setChangeForm] = useState(blankChange);
  const [areaFilter, setAreaFilter] = useState("全部区域");
  const [statusFilter, setStatusFilter] = useState("全部状态");
  const [blocked, setBlocked] = useState<{ context: string; blocks: BlockInfo[] } | null>(null);
  const [notice, setNotice] = useState("");

  const todayStr = nowLocal().slice(0, 10);

  function commit(next: AppState) {
    setState(next);
    saveState(next);
  }

  function reject(context: string, blocks: BlockInfo[]) {
    setBlocked({ context, blocks });
    setNotice("");
  }

  function accept(message: string) {
    setNotice(message);
    setBlocked(null);
  }

  // ---------- 巡检登记 ----------
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instrument = instrumentById(form.instrumentId);
    const resistance = Number(form.resistance);
    const problems = evaluateReading(resistance, instrument.validUntil, form.measuredAt);

    const dup = checkDuplicate(state.records, form.pointId, form.shift, form.measuredAt);
    if (!dup.ok) return reject("登记被拦截（输入已保留，可修改后重新提交）", dup.blocks);

    if (problems.length === 0) {
      const area = areaOfPoint(form.pointId);
      const lock = checkAreaLocked(state.exceptions, area.id, area.name);
      if (!lock.ok) return reject("登记被拦截（输入已保留，可修改后重新提交）", lock.blocks);
    }

    const now = new Date().toISOString();
    const record: InspectionRecord = {
      id: crypto.randomUUID(),
      pointId: form.pointId,
      kind: "巡检",
      shift: form.shift,
      inspector: form.inspector.trim(),
      resistance,
      instrumentId: instrument.id,
      instrumentValidUntil: instrument.validUntil,
      measuredAt: form.measuredAt,
      status: problems.length === 0 ? "正常" : "异常",
      problems,
      note: form.note.trim() || "暂无备注",
      frozen: false,
      versions: [],
      createdAt: now,
    };

    let exceptions = state.exceptions;
    if (problems.length > 0) {
      const exception: ExceptionOrder = {
        id: crypto.randomUUID(),
        pointId: form.pointId,
        areaId: areaOfPoint(form.pointId).id,
        sourceRecordId: record.id,
        reason: problems.join("；"),
        shift: form.shift,
        status: "待复测",
        retests: [],
        createdAt: now,
      };
      record.exceptionId = exception.id;
      exceptions = [exception, ...exceptions];
    }

    commit({ records: [record, ...state.records], exceptions });
    setForm(blankInspection());
    accept(
      problems.length === 0
        ? "登记成功：判定正常。"
        : `已停在异常并保留输入：${problems.join("；")}。异常单已生成，须换班复测两次合格后方可放行。`
    );
  }

  // ---------- 复测 ----------
  function handleRetest(event: FormEvent<HTMLFormElement>, exception: ExceptionOrder) {
    event.preventDefault();
    const retestForm = retestForms[exception.id] ?? blankRetest();
    const instrument = instrumentById(retestForm.instrumentId);
    const resistance = Number(retestForm.resistance);

    const shiftCheck = checkRetestShift(exception, retestForm.shift);
    if (!shiftCheck.ok) return reject("复测被拦截（输入已保留）", shiftCheck.blocks);
    const dup = checkDuplicate(state.records, exception.pointId, retestForm.shift, retestForm.measuredAt);
    if (!dup.ok) return reject("复测被拦截（输入已保留）", dup.blocks);

    const problems = evaluateReading(resistance, instrument.validUntil, retestForm.measuredAt);
    const qualified = problems.length === 0;
    const now = new Date().toISOString();

    const record: InspectionRecord = {
      id: crypto.randomUUID(),
      pointId: exception.pointId,
      kind: "复测",
      shift: retestForm.shift,
      inspector: retestForm.inspector.trim(),
      resistance,
      instrumentId: instrument.id,
      instrumentValidUntil: instrument.validUntil,
      measuredAt: retestForm.measuredAt,
      status: qualified ? "正常" : "异常",
      problems,
      exceptionId: exception.id,
      note: qualified ? "复测合格" : "复测未合格",
      frozen: false,
      versions: [],
      createdAt: now,
    };
    const entry: RetestEntry = {
      id: crypto.randomUUID(),
      recordId: record.id,
      shift: retestForm.shift,
      inspector: retestForm.inspector.trim(),
      resistance,
      instrumentId: instrument.id,
      instrumentValidUntil: instrument.validUntil,
      measuredAt: retestForm.measuredAt,
      qualified,
      problems,
      createdAt: now,
    };
    const nextException: ExceptionOrder = { ...exception, retests: [...exception.retests, entry] };
    nextException.status = statusFor(nextException);

    commit({
      records: [record, ...state.records],
      exceptions: state.exceptions.map((item) => (item.id === exception.id ? nextException : item)),
    });
    setRetestForms({ ...retestForms, [exception.id]: blankRetest() });
    accept(
      qualified
        ? `复测合格（${qualifiedCount(nextException)}/2）${nextException.status === "待放行" ? "，已可确认放行。" : "。"}`
        : `复测已记录但未合格：${problems.join("；")}，不计入放行条件。`
    );
  }

  // ---------- 放行 ----------
  function handleRelease(exception: ExceptionOrder) {
    const check = checkRelease(exception);
    if (!check.ok) return reject("放行被拦截", check.blocks);
    const frozenIds = new Set([exception.sourceRecordId, ...exception.retests.map((item) => item.recordId)]);
    commit({
      records: state.records.map((record) =>
        frozenIds.has(record.id) ? { ...record, frozen: true } : record
      ),
      exceptions: state.exceptions.map((item) =>
        item.id === exception.id
          ? { ...item, status: "已放行", releasedAt: new Date().toISOString() }
          : item
      ),
    });
    accept("已放行：相关读数与班组已冻结，后续改动须另建原因版本并保留旧值。");
  }

  // ---------- 冻结变更（另建版本，留旧值） ----------
  function openChange(record: InspectionRecord) {
    setEditingId(record.id);
    setChangeForm({
      resistance: String(record.resistance),
      shift: record.shift,
      inspector: record.inspector,
      instrumentId: record.instrumentId,
      measuredAt: record.measuredAt,
      operator: record.inspector,
      reason: "",
    });
  }

  function handleChange(event: FormEvent<HTMLFormElement>, record: InspectionRecord) {
    event.preventDefault();
    const check = checkFrozenChange(record, changeForm.reason);
    if (!check.ok) return reject("变更被拦截", check.blocks);
    const instrument = instrumentById(changeForm.instrumentId);
    const version: RecordVersion = {
      versionNo: record.versions.length + 1,
      changedAt: new Date().toISOString(),
      changedBy: changeForm.operator.trim() || record.inspector,
      reason: changeForm.reason.trim(),
      previous: {
        resistance: record.resistance,
        shift: record.shift,
        inspector: record.inspector,
        instrumentId: record.instrumentId,
        instrumentValidUntil: record.instrumentValidUntil,
        measuredAt: record.measuredAt,
      },
    };
    const next: InspectionRecord = {
      ...record,
      resistance: Number(changeForm.resistance),
      shift: changeForm.shift,
      inspector: changeForm.inspector.trim(),
      instrumentId: instrument.id,
      instrumentValidUntil: instrument.validUntil,
      measuredAt: changeForm.measuredAt,
      versions: [...record.versions, version],
    };
    commit({ ...state, records: state.records.map((item) => (item.id === record.id ? next : item)) });
    setEditingId(null);
    accept(`已建立版本 v${version.versionNo}，旧值保留在版本记录中。`);
  }

  function resetDemo() {
    commit(buildSeedState());
    setBlocked(null);
    setEditingId(null);
    setRetestForms({});
    accept("已重置为演示数据。");
  }

  // ---------- 派生数据 ----------
  const filteredRecords = useMemo(
    () =>
      state.records
        .filter((record) => areaFilter === "全部区域" || areaOfPoint(record.pointId).name === areaFilter)
        .filter((record) => statusFilter === "全部状态" || record.status === statusFilter)
        .slice()
        .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt)),
    [state.records, areaFilter, statusFilter]
  );

  const sortedExceptions = useMemo(
    () =>
      state.exceptions
        .slice()
        .sort(
          (a, b) =>
            EXCEPTION_WEIGHT[a.status] - EXCEPTION_WEIGHT[b.status] ||
            b.createdAt.localeCompare(a.createdAt)
        ),
    [state.exceptions]
  );

  const metrics = useMemo(
    () => [
      POINTS.length,
      state.exceptions.filter((item) => item.status !== "已放行").length,
      state.records.length,
      state.records.filter((record) => record.frozen).length,
    ],
    [state]
  );

  const pointStates = useMemo(
    () =>
      POINTS.map((point) => {
        const open = state.exceptions.find(
          (item) => item.pointId === point.id && item.status !== "已放行"
        );
        const latest = state.records
          .filter((record) => record.pointId === point.id)
          .sort((a, b) => b.measuredAt.localeCompare(a.measuredAt))[0];
        return { point, open, latest };
      }),
    [state]
  );

  function instrumentLabel(instrumentId: string, validUntil: string) {
    const instrument = instrumentById(instrumentId);
    return `${instrument.name}（检定至 ${validUntil}${validUntil < todayStr ? "，已失效" : ""}）`;
  }

  function exceptionBadgeClass(status: ExceptionStatus) {
    if (status === "已放行") return "st-good";
    if (status === "待放行") return "st-info";
    if (status === "复测中") return "st-warn";
    return "st-bad";
  }

  return (
    <main className="app">
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">石油行业 · 防静电接地合规闭环</p>
            <h1>油站防静电接地巡检与复测放行台</h1>
            <p className="subtitle">
              按区域、设备、接地点和班次记录接地电阻与仪器检定日；仪器失效或电阻超 {RESISTANCE_LIMIT}Ω
              即停在异常并保留输入，复测须换班且两次合格才放行，放行后冻结读数与班组，改动另建原因版本并留旧值。
            </p>
          </div>
          <div className="stack">
            <span className="tag">阈值 ≤{RESISTANCE_LIMIT}Ω</span>
            <span className="tag">同点位同班仅一条</span>
            <span className="tag">复测须换班</span>
            <span className="tag">两次合格放行</span>
            <button type="button" className="secondary" onClick={resetDemo}>
              重置演示数据
            </button>
          </div>
        </header>

        <section className="metrics">
          {METRIC_LABELS.map((label, index) => (
            <article className="metric" key={label}>
              <span>{label}</span>
              <strong>{metrics[index]}</strong>
            </article>
          ))}
        </section>

        {notice && (
          <section className="notice">
            <span>{notice}</span>
            <button type="button" className="secondary" onClick={() => setNotice("")}>
              关闭
            </button>
          </section>
        )}

        {blocked && (
          <section className="blocked">
            <div className="blocked-head">
              <strong>⚠ {blocked.context}</strong>
              <button type="button" className="secondary" onClick={() => setBlocked(null)}>
                知道了
              </button>
            </div>
            <div className="blocked-grid blocked-grid-head">
              <span>规则</span>
              <span>原值</span>
              <span>现值</span>
            </div>
            {blocked.blocks.map((block, index) => (
              <div className="blocked-grid" key={index}>
                <span>{block.rule}</span>
                <span>{block.original}</span>
                <span>{block.current}</span>
              </div>
            ))}
          </section>
        )}

        <section className="point-strip">
          {pointStates.map(({ point, open, latest }) => (
            <span
              key={point.id}
              className={`chip ${open ? "chip-bad" : latest ? "chip-good" : "chip-muted"}`}
              title={pointPath(point.id)}
            >
              {point.code} {point.name}
              {open ? " · 异常未放行" : latest ? ` · ${latest.resistance}Ω` : " · 未检"}
            </span>
          ))}
        </section>

        <section className="workspace">
          <form className="panel" onSubmit={handleSubmit}>
            <h2>巡检登记</h2>
            <div className="form-grid">
              <label>
                区域
                <select
                  value={form.areaId}
                  onChange={(event) => setForm({ ...form, areaId: event.target.value, equipmentId: "", pointId: "" })}
                  required
                >
                  <option value="">请选择</option>
                  {AREAS.map((area) => (
                    <option key={area.id} value={area.id}>
                      {area.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                设备
                <select
                  value={form.equipmentId}
                  onChange={(event) => setForm({ ...form, equipmentId: event.target.value, pointId: "" })}
                  required
                  disabled={!form.areaId}
                >
                  <option value="">请选择</option>
                  {EQUIPMENT.filter((equipment) => equipment.areaId === form.areaId).map((equipment) => (
                    <option key={equipment.id} value={equipment.id}>
                      {equipment.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                接地点
                <select
                  value={form.pointId}
                  onChange={(event) => setForm({ ...form, pointId: event.target.value })}
                  required
                  disabled={!form.equipmentId}
                >
                  <option value="">请选择</option>
                  {POINTS.filter((point) => point.equipmentId === form.equipmentId).map((point) => (
                    <option key={point.id} value={point.id}>
                      {point.code} {point.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                班次
                <select value={form.shift} onChange={(event) => setForm({ ...form, shift: event.target.value })} required>
                  <option value="">请选择</option>
                  {SHIFTS.map((shift) => (
                    <option key={shift}>{shift}</option>
                  ))}
                </select>
              </label>
              <label>
                巡检人
                <input
                  value={form.inspector}
                  onChange={(event) => setForm({ ...form, inspector: event.target.value })}
                  placeholder="姓名"
                  required
                />
              </label>
              <label>
                接地电阻（Ω，阈值 ≤{RESISTANCE_LIMIT}）
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.resistance}
                  onChange={(event) => setForm({ ...form, resistance: event.target.value })}
                  required
                />
              </label>
              <label>
                检测仪器（含检定日）
                <select
                  value={form.instrumentId}
                  onChange={(event) => setForm({ ...form, instrumentId: event.target.value })}
                  required
                >
                  <option value="">请选择</option>
                  {INSTRUMENTS.map((instrument) => (
                    <option key={instrument.id} value={instrument.id}>
                      {instrumentLabel(instrument.id, instrument.validUntil)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                检测时间
                <input
                  type="datetime-local"
                  value={form.measuredAt}
                  onChange={(event) => setForm({ ...form, measuredAt: event.target.value })}
                  required
                />
              </label>
              <label>
                备注
                <textarea
                  value={form.note}
                  onChange={(event) => setForm({ ...form, note: event.target.value })}
                  placeholder="现场情况、处理说明"
                />
              </label>
              <button type="submit">登记并判定</button>
            </div>
          </form>

          <section className="list-panel">
            <div className="toolbar">
              <h2>巡检记录</h2>
              <div className="toolbar-filters">
                <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
                  <option>全部区域</option>
                  {AREAS.map((area) => (
                    <option key={area.id}>{area.name}</option>
                  ))}
                </select>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option>全部状态</option>
                  <option>正常</option>
                  <option>异常</option>
                </select>
              </div>
            </div>

            <div className="record-grid">
              {filteredRecords.length === 0 ? (
                <div className="empty">暂无匹配数据</div>
              ) : (
                filteredRecords.map((record) => (
                  <article className="record" key={record.id}>
                    <div className="record-head">
                      <p className="record-title">
                        {pointById(record.pointId)?.code} · {pointPath(record.pointId)}
                      </p>
                      <div className="badges">
                        <span className={`status ${record.status === "正常" ? "st-good" : "st-bad"}`}>
                          {record.status}
                        </span>
                        <span className="status st-kind">{record.kind}</span>
                        {record.frozen && <span className="status st-lock">已冻结</span>}
                      </div>
                    </div>
                    <div className="details">
                      <span>班次：{record.shift}</span>
                      <span>巡检人：{record.inspector}</span>
                      <span>电阻：{record.resistance}Ω</span>
                      <span>检测时间：{formatTime(record.measuredAt)}</span>
                      <span>仪器：{instrumentById(record.instrumentId).name}</span>
                      <span>检定至：{record.instrumentValidUntil}</span>
                    </div>
                    {record.problems.length > 0 && (
                      <p className="note note-bad">判定：{record.problems.join("；")}</p>
                    )}
                    <p className="note">{record.note}</p>
                    {record.versions.length > 0 && (
                      <div className="versions">
                        <strong>版本留痕（{record.versions.length}）</strong>
                        {record.versions.map((version) => (
                          <div className="version" key={version.versionNo}>
                            <span>
                              v{version.versionNo} · {formatTime(version.changedAt)} · {version.changedBy}
                            </span>
                            <span>原因：{version.reason}</span>
                            <span>
                              旧值：{version.previous.resistance}Ω / {version.previous.shift} /{" "}
                              {version.previous.inspector} / 检定至 {version.previous.instrumentValidUntil} /{" "}
                              {formatTime(version.previous.measuredAt)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {record.frozen && (
                      <div className="actions">
                        {editingId === record.id ? (
                          <button type="button" className="secondary" onClick={() => setEditingId(null)}>
                            取消变更
                          </button>
                        ) : (
                          <button type="button" onClick={() => openChange(record)}>
                            变更（另建版本）
                          </button>
                        )}
                      </div>
                    )}
                    {editingId === record.id && (
                      <form className="inline-form" onSubmit={(event) => handleChange(event, record)}>
                        <label>
                          电阻（Ω）
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={changeForm.resistance}
                            onChange={(event) => setChangeForm({ ...changeForm, resistance: event.target.value })}
                            required
                          />
                        </label>
                        <label>
                          班次
                          <select
                            value={changeForm.shift}
                            onChange={(event) => setChangeForm({ ...changeForm, shift: event.target.value })}
                            required
                          >
                            {SHIFTS.map((shift) => (
                              <option key={shift}>{shift}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          巡检人
                          <input
                            value={changeForm.inspector}
                            onChange={(event) => setChangeForm({ ...changeForm, inspector: event.target.value })}
                            required
                          />
                        </label>
                        <label>
                          检测仪器
                          <select
                            value={changeForm.instrumentId}
                            onChange={(event) => setChangeForm({ ...changeForm, instrumentId: event.target.value })}
                            required
                          >
                            {INSTRUMENTS.map((instrument) => (
                              <option key={instrument.id} value={instrument.id}>
                                {instrumentLabel(instrument.id, instrument.validUntil)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          检测时间
                          <input
                            type="datetime-local"
                            value={changeForm.measuredAt}
                            onChange={(event) => setChangeForm({ ...changeForm, measuredAt: event.target.value })}
                            required
                          />
                        </label>
                        <label>
                          变更人
                          <input
                            value={changeForm.operator}
                            onChange={(event) => setChangeForm({ ...changeForm, operator: event.target.value })}
                            required
                          />
                        </label>
                        <label className="span-all">
                          变更原因（必填，留旧值另建版本）
                          <input
                            value={changeForm.reason}
                            onChange={(event) => setChangeForm({ ...changeForm, reason: event.target.value })}
                            placeholder="例如：读数誊录错误，按仪器存储值更正"
                          />
                        </label>
                        <button type="submit" className="span-all">
                          提交变更并留旧值
                        </button>
                      </form>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>
        </section>

        <section className="list-panel exceptions-panel">
          <h2>异常复测与放行</h2>
          <div className="exc-grid">
            {sortedExceptions.length === 0 ? (
              <div className="empty">暂无异常</div>
            ) : (
              sortedExceptions.map((exception) => {
                const source = state.records.find((record) => record.id === exception.sourceRecordId);
                const retestForm = retestForms[exception.id] ?? blankRetest();
                const setRetestForm = (patch: Partial<ReturnType<typeof blankRetest>>) =>
                  setRetestForms({ ...retestForms, [exception.id]: { ...retestForm, ...patch } });
                return (
                  <article className="record exc" key={exception.id}>
                    <div className="record-head">
                      <p className="record-title">
                        {pointById(exception.pointId)?.code} · {pointPath(exception.pointId)}
                      </p>
                      <span className={`status ${exceptionBadgeClass(exception.status)}`}>{exception.status}</span>
                    </div>
                    <div className="details">
                      <span>异常原因：{exception.reason}</span>
                      <span>登记班次：{exception.shift}</span>
                      <span>原始读数：{source ? `${source.resistance}Ω` : "—"}</span>
                      <span>登记时间：{formatTime(exception.createdAt)}</span>
                      <span>合格复测：{qualifiedCount(exception)}/2</span>
                      {exception.releasedAt && <span>放行时间：{formatTime(exception.releasedAt)}</span>}
                    </div>
                    {exception.retests.length > 0 && (
                      <div className="versions">
                        <strong>复测记录</strong>
                        {exception.retests.map((retest) => (
                          <div className="version" key={retest.id}>
                            <span>
                              {retest.qualified ? "✓ 合格" : "✗ 未合格"} · {retest.shift} · {retest.inspector} ·{" "}
                              {retest.resistance}Ω · {formatTime(retest.measuredAt)}
                            </span>
                            {retest.problems.length > 0 && <span>原因：{retest.problems.join("；")}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                    {exception.status === "已放行" ? (
                      <p className="note">已放行：读数与班组已冻结，改动须另建原因版本并留旧值。</p>
                    ) : exception.status === "待放行" ? (
                      <div className="actions">
                        <button type="button" onClick={() => handleRelease(exception)}>
                          确认放行并冻结
                        </button>
                      </div>
                    ) : (
                      <form className="inline-form" onSubmit={(event) => handleRetest(event, exception)}>
                        <label>
                          复测班次（须换班）
                          <select
                            value={retestForm.shift}
                            onChange={(event) => setRetestForm({ shift: event.target.value })}
                            required
                          >
                            <option value="">请选择</option>
                            {SHIFTS.map((shift) => (
                              <option key={shift}>{shift}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          复测人
                          <input
                            value={retestForm.inspector}
                            onChange={(event) => setRetestForm({ inspector: event.target.value })}
                            placeholder="姓名"
                            required
                          />
                        </label>
                        <label>
                          电阻（Ω）
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={retestForm.resistance}
                            onChange={(event) => setRetestForm({ resistance: event.target.value })}
                            required
                          />
                        </label>
                        <label>
                          检测仪器
                          <select
                            value={retestForm.instrumentId}
                            onChange={(event) => setRetestForm({ instrumentId: event.target.value })}
                            required
                          >
                            <option value="">请选择</option>
                            {INSTRUMENTS.map((instrument) => (
                              <option key={instrument.id} value={instrument.id}>
                                {instrumentLabel(instrument.id, instrument.validUntil)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          检测时间
                          <input
                            type="datetime-local"
                            value={retestForm.measuredAt}
                            onChange={(event) => setRetestForm({ measuredAt: event.target.value })}
                            required
                          />
                        </label>
                        <button type="submit" className="span-all">
                          提交复测
                        </button>
                      </form>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
