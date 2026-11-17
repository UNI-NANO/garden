import type { Judgement } from "../../schema/defs/skill-table";

/** 판정 바의 칸 폭 (`judgementWidths`가 준다) */
export interface BarWidths {
  good: number;
  perfect: number;
  normalEachSide: number;
}

/**
 * 커서의 위치(0 ~ length). 왼쪽 끝에서 오른쪽 끝으로 한 번 지나간다.
 * 끝까지 가면 그 뒤로는 끝에 머문다(그때 누르면 빗나감).
 */
export function barPosition(elapsedMs: number, sweepMs: number, length: number): number {
  if (sweepMs <= 0) return length;
  return Math.min(length, Math.max(0, (elapsedMs / sweepMs) * length));
}

/** 한 번 지나가는 데 걸리는 시간: 기준값 ÷ 기술의 판정 바 속도 */
export function sweepTime(baseSweepMs: number, barSpeed: number): number {
  return baseSweepMs / Math.max(0.01, barSpeed);
}

/** 바의 칸 자리. 좋음 칸은 바 가운데, 완벽은 그 가운데, 보통은 양옆 */
export function barZones(widths: BarWidths, length: number) {
  const center = length / 2;
  const half = (w: number) => w / 2;
  return {
    perfect: [center - half(widths.perfect), center + half(widths.perfect)] as const,
    good: [center - half(widths.good), center + half(widths.good)] as const,
    normal: [center - half(widths.good) - widths.normalEachSide, center + half(widths.good) + widths.normalEachSide] as const,
  };
}

/**
 * 위치 → 판정. 칸의 가장자리는 안쪽 칸에 넣는다. 끝까지 누르지 않았으면 `position`에 undefined를 넘긴다(빗나감).
 */
export function judgeAt(widths: BarWidths, length: number, position: number | undefined): Judgement {
  if (position === undefined || position >= length) return "빗나감";
  const zones = barZones(widths, length);
  const inside = ([from, to]: readonly [number, number]) => position >= from && position <= to;
  if (widths.perfect > 0 && inside(zones.perfect)) return "완벽";
  if (widths.good > 0 && inside(zones.good)) return "좋음";
  if (inside(zones.normal)) return "보통";
  return "빗나감";
}
