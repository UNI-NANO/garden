/** 받침이 있으면 앞의 조사, 없으면 뒤의 조사 (초원토끼를, 영양을, 지혈 연고를) */
export function withJosa(
  word: string,
  withFinal: string,
  withoutFinal: string,
): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hasFinal = code >= 0 && code <= 11171 && code % 28 !== 0;
  return `${word}${hasFinal ? withFinal : withoutFinal}`;
}
