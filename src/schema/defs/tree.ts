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
export const ConditionSchema = z.enum([
  "연계 중",
  "연계 아님",
  "대상이 흐트러짐",
  "대상이 뒷줄",
  "완벽",
  /** 원거리 행동이 하나라도 있는 적 */
  "대상이 원거리",
  /** 적 카드의 특징에 방패가 있는 적 */
  "대상에게 방패",
  /** 바로 앞 내 차례에 친 적과 같은 적 */
  "같은 대상",
]);
export type Condition = z.infer<typeof ConditionSchema>;

/** 규칙이 걸리는 타. 없으면 모든 타 */
export const HitSchema = z.literal("마지막");

/**
 * 칸이 기술을 바꾸는 규칙 하나. 칸을 찍으면 그 루트의 기술에 차례로 적용된다.
 * 형식의 설명과 예는 docs/칸-규칙.md.
 */
export const ModSchema = z.discriminatedUnion("kind", [
  // 숫자
  z.strictObject({ kind: z.literal("위력 +"), amount: AmountSchema, when: ConditionSchema.optional(), hit: HitSchema.optional() }),
  z.strictObject({ kind: z.literal("위력 ×"), amount: AmountSchema, when: ConditionSchema.optional(), hit: HitSchema.optional() }),
  z.strictObject({ kind: z.literal("흐트러짐 ×"), amount: AmountSchema, when: ConditionSchema.optional() }),
  /** 피해에만 곱한다 (위력·흐트러짐은 그대로) */
  z.strictObject({ kind: z.literal("피해 ×"), amount: AmountSchema }),
  z.strictObject({ kind: z.literal("좋음 칸"), amount: AmountSchema, when: ConditionSchema.optional(), hit: HitSchema.optional() }),
  z.strictObject({ kind: z.literal("완벽 칸"), amount: AmountSchema }),
  /** 판정 바가 움직이는 빠르기 × (화면이 읽는다) */
  z.strictObject({ kind: z.literal("판정 바 속도"), amount: AmountSchema }),
  z.strictObject({ kind: z.literal("기력"), add: z.number().int(), when: ConditionSchema.optional() }),
  z.strictObject({ kind: z.literal("쿨다운"), add: z.number().int(), when: ConditionSchema.optional() }),
  z.strictObject({ kind: z.literal("타수"), add: z.number().int().min(1), when: ConditionSchema.optional() }),
  z.strictObject({ kind: z.literal("연계 보너스"), amount: AmountSchema }),
  z.strictObject({ kind: z.literal("끈질김"), perTurn: AmountSchema, max: AmountSchema }),
  z.strictObject({ kind: z.literal("끈질김 최대"), amount: AmountSchema }),
  // 맞히거나 쓰러뜨렸을 때
  z.strictObject({ kind: z.literal("맞히면 기력"), add: z.number().int(), when: ConditionSchema.optional() }),
  z.strictObject({ kind: z.literal("쓰러뜨리면 쿨다운"), multiply: z.number().min(0) }),
  z.strictObject({ kind: z.literal("쓰러뜨리면 기력"), add: z.number().int() }),
  z.strictObject({ kind: z.literal("생포") }),
  /** 쓰러뜨리면 그때 맞은 줄을 같은 위력으로 다시 친다. 추가로 최대 max번 */
  z.strictObject({ kind: z.literal("쓰러뜨리면 다시"), max: z.number().int().min(1) }),
  /** 쓴 턴부터 turns턴 동안 매 턴 시작에 저절로 친다. 쓴 턴과 중간은 weak배, 마지막 턴은 big배 */
  z.strictObject({ kind: z.literal("여러 턴"), turns: z.number().int().min(2), weak: AmountSchema, big: AmountSchema }),
  z.strictObject({ kind: z.literal("생포 보상"), amount: AmountSchema }),
  /** 친 뒤 체력이 최대 체력의 이 비율 이하인 맞은 적을 생포한다 */
  z.strictObject({ kind: z.literal("생포 체력"), amount: AmountSchema }),
  /** 맞히면 대상을 바로 흐트러뜨린다 */
  z.strictObject({ kind: z.literal("흐트러뜨리기"), when: ConditionSchema.optional() }),
  /** 맞히면 대상의 남은 흐트러짐 게이지를 절반으로 */
  z.strictObject({ kind: z.literal("흐트러짐 절반") }),
  z.strictObject({ kind: z.literal("방어 무시") }),
  /** 모든 타가 빗나가면 나에게 붙는 효과 */
  z.strictObject({ kind: z.literal("빗나가면 나에게 효과"), effect: AppliedEffectSchema }),
  // 효과
  z.strictObject({ kind: z.literal("효과"), effect: AppliedEffectSchema, when: z.literal("완벽").optional() }),
  z.strictObject({ kind: z.literal("효과 교체"), effects: z.array(AppliedEffectSchema) }),
  z.strictObject({ kind: z.literal("효과 유지"), effect: DefIdSchema }),
  z.strictObject({
    kind: z.literal("효과 ×"),
    effect: DefIdSchema,
    amount: AmountSchema,
    when: ConditionSchema.optional(),
    /** 마지막 몇 타에만 */
    lastHits: z.number().int().min(1).optional(),
  }),
  /** 타마다 붙이는 그 효과에 이번 전투에서 이 사람이 연계를 이은 횟수를 더한다 */
  z.strictObject({ kind: z.literal("효과 + 연계 횟수"), effect: DefIdSchema }),
  z.strictObject({ kind: z.literal("효과 상한"), effect: DefIdSchema, add: AmountSchema }),
  z.strictObject({ kind: z.literal("터뜨리기"), effect: DefIdSchema, when: z.literal("완벽").optional() }),
  z.strictObject({ kind: z.literal("터뜨리기 모두") }),
  z.strictObject({ kind: z.literal("터뜨리기 강화"), perStack: AmountSchema }),
  z.strictObject({ kind: z.literal("터뜨리기 남김"), share: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal("터뜨리기 흐트러짐") }),
  z.strictObject({ kind: z.literal("터뜨리기 완벽"), amount: AmountSchema }),
  z.strictObject({ kind: z.literal("터뜨리기 빗나감") }),
  // 범위와 자리
  z.strictObject({ kind: z.literal("나머지 대상"), share: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal("나머지 흐트러짐"), share: z.number().min(0).max(1) }),
  z.strictObject({ kind: z.literal("뒤 칸도") }),
  /** 조건이 맞는 적만 대상으로 고를 수 있다 */
  z.strictObject({ kind: z.literal("고를 수 있는 대상"), when: ConditionSchema }),
  /** 그 줄의 서 있는 적 전원을 친다 (앞줄이 서 있어도 뒷줄을 고를 수 있다) */
  z.strictObject({ kind: z.literal("줄 전체"), row: z.enum(["앞줄", "뒷줄"]) }),
  z.strictObject({ kind: z.literal("밀어내기") }),
  z.strictObject({ kind: z.literal("밀려난 적 효과"), effect: AppliedEffectSchema }),
  z.strictObject({ kind: z.literal("끌려 나온 적 효과"), effect: AppliedEffectSchema }),
  z.strictObject({ kind: z.literal("밀어내기 없음") }),
  /** 맞힌 뒤 열마다 앞줄과 뒷줄의 적을 맞바꾼다 */
  z.strictObject({ kind: z.literal("앞뒤 줄 바꾸기") }),
  z.strictObject({ kind: z.literal("끌려 나온 적 치기"), power: AmountSchema.optional() }),
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
  z.strictObject({ kind: z.literal("찌르기 효과"), effect: AppliedEffectSchema }),
  z.strictObject({ kind: z.literal("받아치면 효과"), effect: AppliedEffectSchema }),
  z.strictObject({ kind: z.literal("자세 중 효과"), effect: AppliedEffectSchema }),
  /** all이면 같은 줄 옆 칸만이 아니라 아군 누구를 노린 공격이든. 광역 공격은 한 번만 받고 다른 사람은 안 맞는다 */
  z.strictObject({ kind: z.literal("대신 받기"), damageTaken: AmountSchema.optional(), all: z.boolean().optional() }),
  z.strictObject({ kind: z.literal("받아치면 아군 효과"), effect: AppliedEffectSchema }),
  /** 받아치면 그 적의 「강함」 저항이 받아친 턴부터 turns턴 동안 「보통」이 된다 */
  z.strictObject({ kind: z.literal("받아치면 저항 무너뜨림"), turns: z.number().int().min(1) }),
  /** 자신감이 1 이상일 때만 쓸 수 있다. 자신감을 모두 없애고, 다음 uses번의 공격은 좋음 칸이 판정 바 전체 */
  z.strictObject({ kind: z.literal("자신감 쓰기"), uses: z.number().int().min(1) }),
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
  /** 기본기·궁극기의 기술 항목 */
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
