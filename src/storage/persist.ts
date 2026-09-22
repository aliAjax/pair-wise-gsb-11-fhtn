// 存储层：localStorage 读写与模式版本管理。
// 记录、异常单、复测、版本作为整体状态持久化，重载后按 id 对应还原。

import { buildSeedState } from "../data/seed";
import type { AppState } from "../domain/types";

const STORAGE_KEY = "dfwlfront-10-grounding-console";
const SCHEMA_VERSION = 1;

interface Envelope {
  version: number;
  state: AppState;
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildSeedState();
    const parsed = JSON.parse(raw) as Envelope;
    if (parsed.version !== SCHEMA_VERSION || !parsed.state) return buildSeedState();
    return parsed.state;
  } catch {
    return buildSeedState();
  }
}

export function saveState(state: AppState): void {
  const envelope: Envelope = { version: SCHEMA_VERSION, state };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}
