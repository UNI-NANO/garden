import { z } from "zod";
import { DefIdSchema } from "./common";
import { PotencySchema, RangeSchema, TierSchema } from "./skill-table";

export const RoleSchema = z.enum(["여는", "잇는", "끝내는"]);
export type Role = z.infer<typeof RoleSchema>;

export const DamageTypeSchema = z.enum(["자상", "관통", "파열"]);
export type DamageType = z.infer<typeof DamageTypeSchema>;

export const HitsSchema = z.union([z.number().int().min(1), z.literal("자세")]);

/** 기술 하나를 정하는 항목. 위력·쿨다운·기력 숫자는 적지 않고 기준표에서 계산한다. */
export const SkillSpecSchema = z.strictObject({
  tier: TierSchema,
  potency: PotencySchema,
  hits: HitsSchema,
  range: RangeSchema,
  role: RoleSchema,
  damageType: DamageTypeSchema,
  /** 붙은 효과의 ID. 같은 효과가 예산을 두 번 차지하면 두 번 적는다 */
  effects: z.array(DefIdSchema),
  /** 개성 보정: 위력에 곱하는 배율. 기준을 일부러 깰 때만 */
  personality: z.number().positive().optional(),
});
export type SkillSpec = z.infer<typeof SkillSpecSchema>;
