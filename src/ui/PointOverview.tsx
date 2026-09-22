import { useMemo, useState } from "react";
import { AREAS, EQUIPMENT, RULES_TEXT } from "../domain/catalog";
import { pointSummaries } from "../state/store";
import { useInspectionStore } from "../state/store";
import { StatusTag, fmtResistance } from "./common";

/** 重载后点位 ↔ 异常 ↔ 复测 ↔ 版本 的对应关系总览 */
export function PointOverview({
  onRegister
}: {
  onRegister: (pointId: string) => void;
}) {
  const records = useInspectionStore((s) => s.records);
  const summaries = useMemo(() => pointSummaries(records), [records]);

  return (
    <section className="board">
      <header className="board-head">
        <h2>接地点位总览</h2>
        <span className="count-pill">{summaries.length} 个点位</span>
      </header>

      <div className="area-grid">
        {AREAS.map((area) => {
          const items = summaries.filter((s) => s.point.areaId === area.id);
          const locked = items.some((s) => s.locked);
          return (
            <section className={`area-card ${locked ? "locked" : ""}`} key={area.id}>
              <header className="area-head">
                <h3>{area.name}</h3>
                {locked ? (
                  <span className="area-lock">区域闭锁 · 禁止登记正常</span>
                ) : (
                  <span className="area-open">可登记</span>
                )}
              </header>

              <div className="point-list">
                {items.map(({ point, latest, records: pointRecords, state }) => {
                  const equipment = EQUIPMENT.find((e) => e.id === point.equipmentId);
                  const openCount = pointRecords.filter(
                    (r) => r.status === "异常" || r.status === "复测中"
                  ).length;
                  return (
                    <article className="point-row" key={point.id}>
                      <div className="point-main">
                        <div className="point-id-line">
                          <span className="point-code">{point.code}</span>
                          <StatusTag status={state} />
                        </div>
                        <p className="point-name">{point.name}</p>
                        <p className="point-equipment">{equipment?.name}</p>
                        <p className="point-meta">
                          {latest ? (
                            <>
                              最新：{latest.shift} · {latest.crew} · {fmtResistance(
                                latest.status === "已放行" && latest.release
                                  ? latest.release.current.resistance
                                  : latest.resistance
                              )}
                              {openCount > 0 && <em className="open-flag"> · 未放行 {openCount} 条</em>}
                              {latest.versions.length > 0 && <em className="ver-flag"> · v{latest.versions.length}</em>}
                            </>
                          ) : (
                            "本班尚未登记"
                          )}
                        </p>
                      </div>
                      <button type="button" className="secondary small" onClick={() => onRegister(point.id)}>
                        去登记
                      </button>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function RulesCard() {
  const [open, setOpen] = useState(true);
  return (
    <section className="panel rules-card">
      <button type="button" className="collapse-head" onClick={() => setOpen((v) => !v)}>
        <h2>判定规则</h2>
        <span>{open ? "收起 ▲" : "展开 ▼"}</span>
      </button>
      {open && (
        <ol className="rules-list">
          {RULES_TEXT.map((text, i) => (
            <li key={i}>{text}</li>
          ))}
        </ol>
      )}
      <p className="rules-foot">
        资料、判定、存储、界面四层相互独立：规则改动只在判定层，数据读写只在存储层。
      </p>
    </section>
  );
}
