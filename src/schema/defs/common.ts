import { z } from "zod";

/**
 * 정의 데이터의 ID. 영문 소문자·숫자를 `-`나 `.`로 잇는다. (예: `sword.gale.a1`)
 * 캐릭터 데이터는 이름이 아니라 이 ID로 카드를 가리키므로, 한번 정하면 바꾸지 않는다.
 */
export const DefIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, "ID는 영문 소문자·숫자를 - 나 . 으로 이은 모양이어야 한다");
export type DefId = z.infer<typeof DefIdSchema>;

/** 파일 하나(카드 묶음)의 공통 칸. 내용이 바뀌면 version을 올린다. */
export const defHeader = {
  id: DefIdSchema,
  name: z.string().min(1),
  version: z.number().int().min(1),
};
