import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";
import { AppliedEffectSchema } from "./effect";
import { DamageTypeSchema, RoleSchema, SkillSpecSchema } from "./skill";
import { NodeKindSchema, RangeSchema } from "./skill-table";

const text = z.string().min(1);

/** 숫자, 또는 전투 기준값의 말(`battle.json`의 words 키) */
export const AmountSchema = z.union([z.number(), z.string().min(1)]);
export type Amount = z.infer<typeof AmountSchema>;

/** 규칙이 걸리는 조건. 없으면 늘 */
export const ConditionSchema = z.enum(["연계 중", "연계 아님", "대상이 흐트러짐", "대상이 뒷줄", "완벽"]);
export type Condition = z.infer<typeof ConditionSchema>;

/**
 * 칸이 기술을 바꾸는 규칙 하나. 칸을 찍으면 그 루트의 기술에 차례로 적용된다.
 * 형식의 설명과 예는 docs/칸-규칙.md.
 */
export const ModSchema = z.discriminatedUnion("kind", [
  // 숫자
  z.strictObject({ kind: z.literal("위력 +"), amount: AmountSchema, when: ConditionSchema.optional() }),
  z.strictObject({ kind: z.literal("위력 ×"), amount: AmountSchema, when: ConditionSchema.optional() }),
  z.strictObject({ kind: z.literal("흐트러짐 ×"), amount: AmountSchema, when: ConditionSchema.optional() }),
  z.strictObject({ kind: z.literal("좋음 칸"), amount: AmountSchema, when: ConditionSchema.optional() }),
  z.strictObject({ kind: z.literal("기력"), add: z.number().int() }),
  z.strictObject({ kind: z.literal("쿨다운"), add: z.number().int() }),
  // 효과
  z.strictObject({ kind: z.literal("효과"), effect: AppliedEffectSchema, when: z.literal("완벽").optional() }),
  z.strictObject({ kind: z.literal("효과 교체"), effects: z.array(AppliedEffectSchema) }),
  z.strictObject({ kind: z.literal("효과 유지"), effect: DefIdSchema }),
  z.strictObject({ kind: z.literal("효과 상한"), effect: DefIdSchema, add: z.number().int() }),
  z.strictObject({ kind: z.literal("터뜨리기"), effect: DefIdSchema }),
  z.strictObject({ kind: z.literal("터뜨리기 강화"), perStack: AmountSchema }),
  z.strictObject({ kind: z.literal("터뜨리기 남김"), share: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal("터뜨리기 흐트러짐") }),
  // 범위와 자리
  z.strictObject({ kind: z.literal("나머지 대상"), share: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal("나머지 흐트러짐"), share: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal("뒤 칸도") }),
  z.strictObject({ kind: z.literal("밀어내기") }),
  z.strictObject({ kind: z.literal("밀려난 적 효과"), effect: AppliedEffectSchema }),
  z.strictObject({ kind: z.literal("끌려 나온 적 효과"), effect: AppliedEffectSchema }),
  z.strictObject({ kind: z.literal("뒷줄까지"), amount: AmountSchema }),
  z.strictObject({ kind: z.literal("적진으로"), amount: AmountSchema }),
  // 자세
  z.strictObject({
    kind: z.literal("자세"),
    damageTaken: AmountSchema.optional(),
    parryWidth: AmountSchema.optional(),
    parryEnergy: z.number().int().optional(),
    holdTurns: z.number().int().min(1).optional(),
    counterHits: z.number().int().min(1).optional(),
  }),
  z.strictObject({ kind: z.literal("자세 찌르기"), amount: AmountSchema }),
  z.strictObject({ kind: z.literal("찌르기"), power: AmountSchema.optional(), damageType: DamageTypeSchema.optional(), stagger: AmountSchema.optional() }),
]);
export type Mod = z.infer<typeof ModSchema>;

const ChoiceOptionSchema = z.strictObject({
  description: text,
  /** 이 쪽을 골랐을 때의 규칙. 비어 있으면 아무 일도 하지 않는 선택 */
  mods: z.array(ModSchema).optional(),
});

/** 갈래를 찍으면 기술의 항목이 바뀌는 것 (예: 끝내는 기술로 바뀜, 관통으로 바뀜) */
const OverridesSchema = z
  .strictObject({
    role: RoleSchema.optional(),
    damageType: DamageTypeSchema.optional(),
    range: RangeSchema.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "overrides가 비어 있다" });

export const TreeNodeSchema = z.strictObject({
  id: DefIdSchema,
  kind: NodeKindSchema,
  name: text,
  /** 바로 앞 칸. 기본기만 null */
  prev: DefIdSchema.nullable(),
  description: text,
  /** 기본기의 기술 항목 */
  skill: SkillSpecSchema.optional(),
  /** 갈림길·끝갈래: 어느 축의 선택인지 */
  axis: text.optional(),
  /** 숨은 칸(가문·역이용·교차 갈래). 여는 조건을 채우기 전에는 "???" */
  hidden: z.boolean().optional(),
  overrides: OverridesSchema.optional(),
  /** 이 칸이 기술을 바꾸는 규칙. 설명 글(description)과 같은 내용을 계산이 읽을 수 있게 적은 것 */
  mods: z.array(ModSchema).optional(),
  /** 보완 칸이 둘 중 하나를 고르는 작은 선택일 때 */
  choice: z.tuple([ChoiceOptionSchema, ChoiceOptionSchema]).optional(),
});
export type TreeNode = z.infer<typeof TreeNodeSchema>;

const RootSchema = z.strictObject({
  id: DefIdSchema,
  name: text,
  slots: z.array(z.strictObject({ id: DefIdSchema, description: text })),
});

const BasicAttackSchema = z.strictObject({
  id: DefIdSchema,
  name: text,
  skill: SkillSpecSchema,
  /** 줄기 끝에서 둘 중 하나를 고르는 변형 */
  variants: z.tuple([
    z.strictObject({ id: DefIdSchema, name: text, description: text }),
    z.strictObject({ id: DefIdSchema, name: text, description: text }),
  ]),
});

export const TreeSchema = z.strictObject({
  ...defHeader,
  description: text,
  basicAttack: BasicAttackSchema,
  /** 줄기: 숙련도 문턱마다 열리는 것(기본 공격, 기본기, 변형)의 ID */
  stem: z.array(z.strictObject({ mastery: z.number().int().min(0).max(100), unlocks: z.array(DefIdSchema).min(1) })),
  roots: z.array(RootSchema),
  nodes: z.array(TreeNodeSchema),
});
export type Tree = z.infer<typeof TreeSchema>;
