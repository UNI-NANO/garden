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

/** 달 순번의 이름: 0 → "첫째", 11 → "이름 없는 다섯 날" */
export function monthName(index: number): string {
  return ORDINALS[index] ?? "이름 없는 다섯 날";
}

/** "514-2" → "성력 514년 · 셋째 달" */
export function monthLabel(key: string): string {
  const month = parseMonthKey(key);
  if (!month) return "알 수 없는 달";
  const name = ORDINALS[month.index];
  return `성력 ${month.year}년 · ${name !== undefined ? `${name} 달` : "이름 없는 다섯 날"}`;
}

/**
 * 달 순번의 계절 (총람 「달력」 표): 은방울꽃·철쭉·델피니움 봄, 붉은 양귀비~만다라화 여름,
 * 해바라기·안개꽃·자작나무 가을, 흑장미·이름 없는 다섯 날 겨울.
 */
export function seasonOf(index: number): "봄" | "여름" | "가을" | "겨울" {
  if (index <= 2) return "봄";
  if (index <= 6) return "여름";
  if (index <= 9) return "가을";
  return "겨울";
}
