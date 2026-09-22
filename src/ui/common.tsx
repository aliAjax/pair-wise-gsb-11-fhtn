import type { CheckStatus, Fault } from "../domain/types";

const STATUS_CLASS: Record<CheckStatus | "clear", string> = {
  clear: "st-clear",
  正常: "st-normal",
  异常: "st-fault",
  复测中: "st-retest",
  已放行: "st-released"
};

const STATUS_TEXT: Record<CheckStatus | "clear", string> = {
  clear: "未登记",
  正常: "正常",
  异常: "异常",
  复测中: "复测中",
  已放行: "已放行"
};

export function StatusTag({ status }: { status: CheckStatus | "clear" }) {
  return <span className={`status-tag ${STATUS_CLASS[status]}`}>{STATUS_TEXT[status]}</span>;
}

export function FaultChips({ faults }: { faults: Fault[] }) {
  if (faults.length === 0) return null;
  return (
    <ul className="fault-list">
      {faults.map((f, i) => (
        <li key={`${f.code}-${i}`}>
          <span className="fault-code">{faultCodeText(f.code)}</span>
          <span>{f.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function faultCodeText(code: Fault["code"]): string {
  switch (code) {
    case "INSTRUMENT_INVALID":
      return "仪器失效";
    case "CALIBRATION_EXPIRED":
      return "检定过期";
    case "RESISTANCE_OVER":
      return "电阻超限";
    case "READING_INVALID":
      return "读数无效";
    default:
      return code;
  }
}

export function fmtResistance(value: string): string {
  return value === "" || value === null || value === undefined ? "未读数" : `${value}Ω`;
}
