import { z } from "zod";
import { ArchetypeSchema } from "./battle";
import { DefIdSchema, defHeader } from "./common";
import { TierSchema } from "./skill-table";

/**
 * 투기장 (기획서 「훈련장·투기장」: 결투·계절 순위표). 점수 숫자는 limits.json `arena`(보안 규칙이 읽음).
 * 상대는 등록한 빌드를 「그림자 적」으로 바꿔 싸운다. 숫자는 모두 임시.
 */
export const ArenaDefsSchema = z.strictObject({
  ...defHeader,
  arenas: z
    .array(
      z.strictObject({
        id: DefIdSchema,
        name: z.string().min(1),
        region: z.string().min(1),
      }),
    )
    .min(1),
  shadow: z.strictObject({
    archetype: ArchetypeSchema,
    /** 그림자 체력 = 그 빌드의 최대 체력 × 이 값 */
    hpMultiplier: z.number().positive(),
    /** 행동을 고를 때의 무게: 기본 공격 / 장착 기술 */
    basicWeight: z.number().positive(),
    skillWeight: z.number().positive(),
    withUltimate: z.boolean(),
    /** 이 단계부터의 기술은 「큰 공격」(피하기로 넘길 수 있다) */
    bigFrom: TierSchema,
  }),
  /** 계절이 끝날 때 순위 보상 (지급은 매일 계산 단계에서) */
  seasonRewards: z.array(
    z.strictObject({
      rank: z.number().int().min(1),
      title: z.string().min(1),
      money: z.number().int().min(0),
    }),
  ),
});
export type ArenaDefs = z.infer<typeof ArenaDefsSchema>;
