import type { BlockDetail } from "../domain/types";

/** 受阻面板：逐条列出命中的规则，以及原值 / 现值对照 */
export function BlockList({ blocked }: { blocked: BlockDetail[] }) {
  if (blocked.length === 0) return null;
  return (
    <div className="block-list">
      {blocked.map((b, i) => (
        <section className="block-card" key={`${b.ruleId}-${i}`}>
          <header className="block-head">
            <span className="block-badge">受阻</span>
            <strong>{ruleTitle(b.ruleId)}</strong>
          </header>
          <p className="block-rule">{b.rule}</p>
          {b.rows.length > 0 && (
            <table className="block-table">
              <thead>
                <tr>
                  <th>项目</th>
                  <th>原值 / 原值记录</th>
                  <th>现值 / 本次输入</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, j) => (
                  <tr key={j}>
                    <td className="row-label">{row.label}</td>
                    <td className="row-old">{row.old || "—"}</td>
                    <td className="row-current">{row.current || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}

function ruleTitle(ruleId: BlockDetail["ruleId"]) {
  switch (ruleId) {
    case "DUPLICATE_POINT_SHIFT":
      return "同点位同班仅一条";
    case "AREA_LOCKED":
      return "区域异常未放行，禁止登记正常";
    case "RETEST_SHIFT":
      return "复测必须换班";
    case "AMEND_REASON":
      return "冻结改动须填原因并另建版本";
    case "AMEND_NO_CHANGE":
      return "没有实际改动";
  }
}
