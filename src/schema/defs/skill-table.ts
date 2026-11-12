import { z } from "zod";
import { defHeader } from "./common";

export const TierSchema = z.enum(["기본 공격", "1단계", "2단계", "3단계", "궁극기"]);
export type Tier = z.infer<typeof TierSchema>;

export const PotencySchema = z.enum(["약함", "보통", "강함"]);
export type Potency = z.infer<typeof PotencySchema>;

export const RangeSchema = z.enum(["단일", "휩쓸기", "전체"]);
export type Range = z.infer<typeof RangeSchema>;

export const EffectWeightSchema = z.enum(["가벼운", "무거운"]);
export type EffectWeight = z.infer<typeof EffectWeightSchema>;

export const JudgementSchema = z.enum(["빗나감", "보통", "좋음", "완벽"]);
export type Judgement = z.infer<typeof JudgementSchema>;

export const NodeKindSchema = z.enum(["기본기", "보완", "갈림길", "끝갈래", "궁극기"]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

const multiplier = z.number().min(0).max(10);
const turns = z.number().int().min(0).max(99);
const modifier = z.strictObject({ multiplier, cooldownAdd: turns });

/** 기술 기준표. 기술의 숫자는 모두 여기서 계산된다. 숫자는 임시라 이 파일만 고치면 전체가 바뀐다. */
export const SkillTableSchema = z.strictObject({
  ...defHeader,
  tiers: z.record(
    TierSchema,
    z.strictObject({ power: z.number().min(0), cooldown: turns, energy: z.number().int().min(0) }),
  ),
  potency: z.record(PotencySchema, modifier),
  /** 타수 → 총 위력 배율. 여기 없는 타수는 기준이 없는 것이다. */
  hits: z.record(z.string().regex(/^[1-9][0-9]*$/), multiplier).refine((hits) => "1" in hits, {
    message: "1타의 배율은 꼭 있어야 한다",
  }),
  range: z.record(RangeSchema, modifier),
  /** 효과 하나가 깎는 위력의 비율. 여러 개면 더한다. */
  effectBudget: z.record(EffectWeightSchema, z.number().min(0).max(1)),
  judgement: z.record(JudgementSchema, multiplier),
  energy: z.strictObject({
    max: z.number().int().min(1),
    perTurn: z.number().int().min(0),
    onGuardOrDodge: z.number().int().min(0),
  }),
  tree: z.strictObject({
    stemThresholds: z.array(z.number().int().min(0).max(100)).min(1),
    basicsPerTree: z.number().int().min(1),
    rootsPerTree: z.number().int().min(0),
    slotsPerRoot: z.number().int().min(1),
    /** 기본기에서 궁극기까지 한 루트의 칸 종류 순서 */
    routePattern: z.array(NodeKindSchema).min(2),
    axes: z.array(z.string().min(1)).min(1),
  }),
});
export type SkillTable = z.infer<typeof SkillTableSchema>;
