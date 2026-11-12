import { z } from "zod";

/**
 * 데이터베이스의 키. Realtime Database는 키에 . $ # [ ] / 를 쓸 수 없어서,
 * 정의 데이터 ID(`sword.gale.a`)를 키로 쓸 때는 점을 밑줄로 바꾼다(`sword_gale_a`).
 * 정의 데이터 ID에는 밑줄이 없으므로 서로 되돌릴 수 있다.
 */
export const KEY_PATTERN = /^[A-Za-z0-9_-]{1,96}$/;
export const KeySchema = z.string().regex(KEY_PATTERN, "키는 영문·숫자·_·- 만 쓴다");

export function idToKey(id: string): string {
  return id.replaceAll(".", "_");
}
export function keyToId(key: string): string {
  return key.replaceAll("_", ".");
}
