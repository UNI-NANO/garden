import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";

/**
 * 반복 레이드 (명세서 「레이드와 기여도」 → 반복 레이드). 지금은 혼자 도전, 보스는 주마다 교대. 숫자는 모두 임시.
 */

const reward = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("잎전"),
    quantity: z.number().int().min(1),
  }),
  z.strictObject({
    kind: z.literal("물건"),
    item: DefIdSchema,
    quantity: z.number().int().min(1),
  }),
]);
export type RaidReward = z.infer<typeof reward>;

export const RaidBossSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  region: z.string().min(1),
  enemies: z
    .array(
      z.strictObject({
        enemy: DefIdSchema,
        slot: z.number().int().min(0).max(5),
      }),
    )
    .min(1),
  /** 그 주에 처음 이기면 */
  weekly: z.array(reward).min(1),
  /** 그다음부터 (레이드 분야 피로 배율을 수량에 곱한다, 내림·최소 1) */
  repeat: z.array(reward).min(1),
});
export type RaidBoss = z.infer<typeof RaidBossSchema>;

export const RaidDefsSchema = z.strictObject({
  ...defHeader,
  rotation: z.strictObject({
    /** 첫 주가 시작하는 날 (한국 시간 하루 경계) */
    epoch: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
    days: z.number().int().min(1),
    /** 보스 차례 (끝나면 처음부터) */
    order: z.array(DefIdSchema).min(1),
  }),
  bosses: z.array(RaidBossSchema).min(1),
  /** 기여 점수 = 준 피해 + 흐트러짐 × stagger + 막아준 피해 × prevented + 받아치기·피하기 성공 × reaction. 등급은 점수의 절대 기준 */
  contribution: z.strictObject({
    stagger: z.number().min(0),
    prevented: z.number().min(0),
    reaction: z.number().min(0),
    grades: z.strictObject({
      금: z.number().min(0),
      은: z.number().min(0),
      동: z.number().min(0),
    }),
  }),
});
export type RaidDefs = z.infer<typeof RaidDefsSchema>;
