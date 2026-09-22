import { useEffect, useMemo, useState } from "react";
import { consoleMetrics, useInspectionStore } from "./state/store";
import { RegisterForm } from "./ui/RegisterForm";
import { PointOverview, RulesCard } from "./ui/PointOverview";
import { AnomalyBoard } from "./ui/AnomalyBoard";
import { ReleasedLedger } from "./ui/ReleasedLedger";

type Tab = "overview" | "anomaly" | "released";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "点位总览" },
  { key: "anomaly", label: "异常与复测" },
  { key: "released", label: "已放行台账" }
];

export default function App() {
  const records = useInspectionStore((s) => s.records);
  const ensureLoaded = useInspectionStore((s) => s.ensureLoaded);
  const resetDemo = useInspectionStore((s) => s.resetDemo);
  const [tab, setTab] = useState<Tab>("overview");
  const [prefillPointId, setPrefillPointId] = useState<string | null>(null);

  useEffect(() => { ensureLoaded(); }, [ensureLoaded]);

  const metrics = useMemo(() => consoleMetrics(records), [records]);

  function handleReset() {
    if (window.confirm("将清空当前全部登记并恢复演示数据，确定继续？")) {
      resetDemo();
    }
  }

  return (
    <main className="app">
      <div className="shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">石油储运 · 防静电安全闭环</p>
            <h1>油站防静电接地巡检与复测放行台</h1>
            <p className="subtitle">
              按区域、设备、接地点、班次记录接地电阻与仪器检定日；电阻超 4Ω 或仪器失效即停异常，
              换班复测连续两次合格方可放行；放行后冻结读数与班组，改动另建原因版本并留旧值。
            </p>
          </div>
          <div className="head-actions">
            <div className="stack">
              <span className="tag">React</span>
              <span className="tag">TypeScript</span>
              <span className="tag">Zustand</span>
              <span className="tag">localStorage</span>
            </div>
            <button type="button" className="secondary" onClick={handleReset}>恢复演示数据</button>
          </div>
        </header>

        <section className="metrics">
          <article className="metric"><span>接地点位</span><strong>{metrics.points}</strong></article>
          <article className="metric alert"><span>停在异常</span><strong>{metrics.openFaults}</strong></article>
          <article className="metric warn"><span>复测中</span><strong>{metrics.pendingRetests}</strong></article>
          <article className="metric ok"><span>已放行</span><strong>{metrics.released}</strong></article>
          <article className="metric lock"><span>闭锁区域</span><strong>{metrics.lockedAreas}</strong></article>
        </section>

        <section className="workspace">
          <div className="left-col">
            <RegisterForm
              prefillPointId={prefillPointId}
              onConsumed={() => setPrefillPointId(null)}
            />
            <RulesCard />
          </div>

          <section className="list-panel">
            <div className="tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  className={`tab ${tab === t.key ? "active" : ""}`}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {t.key === "anomaly" && metrics.openFaults + metrics.pendingRetests > 0 && (
                    <span className="tab-badge">{metrics.openFaults + metrics.pendingRetests}</span>
                  )}
                </button>
              ))}
            </div>

            {tab === "overview" && (
              <PointOverview onRegister={(id) => { setPrefillPointId(id); setTab("overview"); }} />
            )}
            {tab === "anomaly" && <AnomalyBoard />}
            {tab === "released" && <ReleasedLedger />}
          </section>
        </section>

        <footer className="foot">
          数据仅保存在本机浏览器 localStorage；刷新 / 重载后点位、异常、复测与版本对应关系保持一致。
        </footer>
      </div>
    </main>
  );
}
