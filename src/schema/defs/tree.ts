import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";
import { DamageTypeSchema, RoleSchema, SkillSpecSchema } from "./skill";
import { NodeKindSchema, RangeSchema } from "./skill-table";

const text = z.string().min(1);

/** 숫자로 딱 떨어지는, 조건 없는 강화. 조건이 붙은 강화는 description에만 적는다. */
export const BonusSchema = z
  .strictObject({
    /** 위력 +5%면 0.05 */
    powerPct: z.number().optional(),
    energy: z.number().int().optional(),
    cooldown: z.number().int().optional(),
  })
  .refine((bonus) => Object.keys(bonus).length > 0, { message: "bonus가 비어 있다" });

const ChoiceOptionSchema = z.strictObject({
  description: text,
  bonus: BonusSchema.optional(),
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
  /** 보완 칸 */
  bonus: BonusSchema.optional(),
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
