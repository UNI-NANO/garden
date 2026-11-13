import type { Migration } from "../../schema/defs/migration";

export interface ConvertedMastery {
  value: number;
  passed60: boolean;
  passed80: boolean;
  /** 옛 값이 범위 밖이라 끝값으로 맞췄으면 그 옛 값 (이전 기록에 남긴다) */
  oddOldValue?: number;
}

/**
 * 옛 숙련도를 새 곡선으로 환산한다 (기획서 「캐릭터별 나무 점수」).
 * 구간 안에서는 비례로 옮기고 정수로 반올림한다. 새 값이 60 이상이면 60 벽은 넘은 것으로 인정한다.
 */
export function convertOldMastery(migration: Migration, old: number): ConvertedMastery {
  const curve = migration.masteryCurve;
  const first = curve[0];
  const last = curve[curve.length - 1];
  if (first === undefined || last === undefined) throw new RangeError("환산 구간이 비어 있다");

  const usable = Number.isFinite(old);
  const clamped = usable ? Math.min(Math.max(old, first.oldFrom), last.oldTo) : first.oldFrom;
  const part = curve.find((p) => clamped >= p.oldFrom && clamped <= p.oldTo) ?? last;
  const ratio = part.oldTo === part.oldFrom ? 0 : (clamped - part.oldFrom) / (part.oldTo - part.oldFrom);
  const value = Math.round(part.newFrom + ratio * (part.newTo - part.newFrom));

  return {
    value,
    passed60: value >= 60,
    passed80: value >= 80,
    ...(clamped !== old ? { oddOldValue: old } : {}),
  };
}
