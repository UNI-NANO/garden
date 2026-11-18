import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";

/**
 * 훈련장 (기획서 「훈련장·투기장」, 명세서 숙련도 「벽 시험」). 허수아비(내 숫자 확인)와 교관 대련(벽 시험). 숫자는 모두 임시.
 */

const member = z.strictObject({
  enemy: DefIdSchema,
  slot: z.number().int().min(0).max(5),
});

export const WallTestSchema = z.strictObject({
  /** 어느 벽인가 (숙련도 60·80) */
  at: z.union([z.literal(60), z.literal(80)]),
  instructor: z.string().min(1),
  /** 일생 기록에 붙는 말 (예: 「늙은 교관과의 대련」) */
  lifeNote: z.string().min(1),
  /** 지고 나서 교관이 하는 말 */
  line: z.string().min(1),
  enemies: z.array(member).min(1),
});
export type WallTest = z.infer<typeof WallTestSchema>;

export const TrainingGroundSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  region: z.string().min(1),
  dummy: z.strictObject({ enemy: DefIdSchema }),
  walls: z.array(WallTestSchema).min(1),
});
export type TrainingGround = z.infer<typeof TrainingGroundSchema>;

export const TrainingDefsSchema = z.strictObject({
  ...defHeader,
  grounds: z.array(TrainingGroundSchema).min(1),
});
export type TrainingDefs = z.infer<typeof TrainingDefsSchema>;
