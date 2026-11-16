import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";
import { EffectWeightSchema } from "./skill-table";

/** 효과가 하는 일. 전투 계산은 효과의 이름이 아니라 이 종류를 보고 움직인다 */
export const EffectRuleSchema = z.discriminatedUnion("kind", [
  /** 턴 끝에 중첩만큼 피해 */
  z.strictObject({ kind: z.literal("지속 피해"), healMultiplier: z.number().min(0).max(1).optional() }),
  /** 맞을 때마다 받는 피해에 중첩당 더한다(음수면 줄인다) */
  z.strictObject({ kind: z.literal("받는 피해"), perStack: z.number() }),
  /** 자리 옮기기·도망·피하기 불가 */
  z.strictObject({ kind: z.literal("움직임 불가") }),
  /** 플레이어는 판정 칸이 흔들리고, 적은 주는 위력이 준다 */
  z.strictObject({ kind: z.literal("공포"), barShakePerStack: z.number().min(0), enemyPowerPerStack: z.number() }),
  /** 좋음 칸의 폭 */
  z.strictObject({ kind: z.literal("좋음 칸"), widthPerStack: z.number() }),
  /** 이 효과를 가진 쪽을 칠 때: 플레이어는 좋음 칸이 좁아지고, 적은 위력이 준다 */
  z.strictObject({ kind: z.literal("위압"), attackerWidthPerStack: z.number(), enemyPowerPerStack: z.number() }),
  /** 완벽으로 쳐도 좋음 */
  z.strictObject({ kind: z.literal("완벽 없음") }),
  /** 주는 위력에 중첩당 더하는 비율 */
  z.strictObject({ kind: z.literal("주는 위력"), perStack: z.number() }),
  /** '보통' 판정의 배율을 중첩당 올린다 */
  z.strictObject({ kind: z.literal("보통 배율"), addPerStack: z.number().min(0), max: z.number().min(0) }),
  /** 턴 끝에 쿨다운이 더 줄어든다 */
  z.strictObject({ kind: z.literal("쿨다운 더 줄임"), amount: z.number().int().min(1) }),
  /** 쓰러질 한 방을 버틴다 */
  z.strictObject({ kind: z.literal("버티기"), hpLeft: z.number().int().min(1) }),
  /** 다른 효과를 막는다 */
  z.strictObject({ kind: z.literal("면역"), effects: z.array(DefIdSchema).min(1) }),
]);
export type EffectRule = z.infer<typeof EffectRuleSchema>;

export const EffectDecaySchema = z.enum(["턴 끝 −1", "턴 끝 절반", "턴 끝 모두", "맞을 때 −1", "쓸 때 −1", "쓰일 때 −1", "줄지 않음"]);
export type EffectDecay = z.infer<typeof EffectDecaySchema>;

export const EffectSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  /** 효과 예산에서 차지하는 무게 */
  weight: EffectWeightSchema,
  polarity: z.enum(["이로운", "해로운"]),
  /** 최대 중첩 */
  max: z.number().int().min(1),
  decay: EffectDecaySchema,
  rule: EffectRuleSchema,
});
export type Effect = z.infer<typeof EffectSchema>;

export const EffectListSchema = z.strictObject({
  ...defHeader,
  effects: z.array(EffectSchema),
});
export type EffectList = z.infer<typeof EffectListSchema>;

/** 기술이나 적의 행동에 붙는 효과 한 줄 */
export const AppliedEffectSchema = z.strictObject({
  id: DefIdSchema,
  /** 한 번에 붙는 중첩 */
  amount: z.number().int().min(1),
  /** 몇 번째 타에 붙는지(1부터). 없으면 모든 타 */
  hits: z.array(z.number().int().min(1)).min(1).optional(),
  /** 누구에게. 없으면 맞은 대상 */
  to: z.enum(["대상", "나"]).optional(),
});
export type AppliedEffect = z.infer<typeof AppliedEffectSchema>;
