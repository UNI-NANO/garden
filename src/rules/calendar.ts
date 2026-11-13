/**
 * 세계 달력의 표시. 달 순번 0~10은 열한 달, 11은 이름 없는 다섯 날 (명세서 「세계 시계와 달 행동」).
 */
const ORDINALS = ["첫째", "둘째", "셋째", "넷째", "다섯째", "여섯째", "일곱째", "여덟째", "아홉째", "열째", "열한째"];

export interface MonthKey {
  year: number;
  /** 0~11 */
  index: number;
}

export function parseMonthKey(key: string): MonthKey | undefined {
  const match = /^([0-9]+)-([0-9]|1[01])$/.exec(key);
  return match ? { year: Number(match[1]), index: Number(match[2]) } : undefined;
}

/** "514-2" → "성력 514년 · 셋째 달" */
export function monthLabel(key: string): string {
  const month = parseMonthKey(key);
  if (!month) return "알 수 없는 달";
  const name = ORDINALS[month.index];
  return `성력 ${month.year}년 · ${name !== undefined ? `${name} 달` : "이름 없는 다섯 날"}`;
}
