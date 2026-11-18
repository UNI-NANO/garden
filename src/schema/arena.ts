import { z } from "zod";
import { DefIdSchema } from "./defs/common";
import { KeySchema } from "./keys";

/** 투기장 저장 모양 (/arena/{계절}/…). 계절 키는 "514-summer"처럼 연도와 계절 */

const count = z.number().int().min(0);

/** 등록한 빌드 스냅숏: 다시 등록하기 전까지 다른 사람은 이 모습(그림자)과 싸운다 */
export const ArenaBuildSchema = z.strictObject({
  name: z.string().min(1).max(40),
  health: count,
  treeId: DefIdSchema,
  treeVersion: z.number().int().min(1),
  picked: z.record(KeySchema, z.literal(true)).default({}),
  choices: z
    .record(KeySchema, z.union([z.literal(0), z.literal(1)]))
    .default({}),
  basics: z.array(DefIdSchema).default([]),
  ultimate: DefIdSchema.optional(),
  mastery: z.number().min(0).max(100),
});
export type ArenaBuild = z.infer<typeof ArenaBuildSchema>;

export const ArenaEntrySchema = z.strictObject({
  build: ArenaBuildSchema,
  registeredAt: count,
  score: count,
  wins: count,
  losses: count,
});
export type ArenaEntry = z.infer<typeof ArenaEntrySchema>;

/** 나에게 온 도전 한 줄 (도전한 사람이 같은 쓰기로 남긴다) */
export const ArenaLogLineSchema = z.strictObject({
  at: count,
  from: KeySchema,
  fromName: z.string().min(1).max(40),
  /** 도전한 사람이 이겼나 */
  challengerWon: z.boolean(),
});
export type ArenaLogLine = z.infer<typeof ArenaLogLineSchema>;
