import { z } from "zod";
import { DefIdSchema } from "./defs/common";

/** 반복 레이드 기여 기록 (/raids/{주 키}/records/{cid}): 그 주 한 판의 최고 기여 점수와 그 판의 세부 */
const amount = z.number().min(0);
export const RaidRecordSchema = z.strictObject({
  name: z.string().min(1).max(40),
  bossId: DefIdSchema,
  score: z.number().int().min(0),
  damage: amount,
  stagger: amount,
  prevented: amount,
  reactions: z.number().int().min(0),
  at: z.number().int().min(0),
});
export type RaidRecord = z.infer<typeof RaidRecordSchema>;
