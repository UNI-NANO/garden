/**
 * 씨앗 난수. 같은 씨앗이면 언제 어디서 돌려도 같은 순서의 값이 나온다.
 * 화면과 하루 계산이 같은 결과를 내려면 Math.random 대신 이것만 쓴다.
 */
export interface Rng {
  /** 0 이상 1 미만의 수 */
  next(): number;
  /** min 이상 max 이하의 정수 */
  int(min: number, max: number): number;
}

/** 문자열 씨앗(요청 ID, 날짜 등)을 32비트 정수로 바꾼다. (FNV-1a) */
export function seedFromString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32 */
export function createRng(seed: number | string): Rng {
  let state = (typeof seed === "string" ? seedFromString(seed) : seed) >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number => {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new RangeError(`int(${min}, ${max}): 정수이고 min ≤ max 여야 한다`);
    }
    return min + Math.floor(next() * (max - min + 1));
  };

  return { next, int };
}
