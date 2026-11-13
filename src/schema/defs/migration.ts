import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";

const mastery = z.number().min(0).max(100);

/** 옛 데이터를 새 기준으로 옮기는 규칙. 한 번만 쓰지만 숫자는 여기 한곳에 둔다. */
export const MigrationSchema = z.strictObject({
  ...defHeader,
  /** 옛 숙련도 구간 → 새 숙련도 구간. 구간 안에서는 비례로 옮긴다 */
  masteryCurve: z
    .array(z.strictObject({ oldFrom: mastery, oldTo: mastery, newFrom: mastery, newTo: mastery }))
    .min(1),
  /** 능력치 누르기: keepUpTo까지는 그대로, 넘는 몫에는 factorAbove를 곱한다 */
  abilities: z.strictObject({ keepUpTo: z.number().int().min(0).max(100), factorAbove: z.number().min(0).max(1) }),
  /** 옛 돈 1이 잎전 몇인지 */
  moneyRate: z.number().positive(),
  /** 친밀도가 적혀 있지 않은 인물의 값 (옛 사이트의 기본값) */
  defaultIntimacy: z.number().int(),
  /** 옛 물건에 없던 값의 처음 값 */
  itemDefaults: z.strictObject({
    freshness: z.number().int().min(0).max(100),
    quality: z.enum(["하", "중", "상", "최상"]),
    durability: z.number().int().min(0).max(100),
  }),
  /** 새 기술(나무·생활 기술)과, 그리로 모이는 옛 기술 이름. 여러 옛 기술은 환산한 뒤 더한다 */
  skills: z.array(
    z.strictObject({
      id: DefIdSchema,
      name: z.string().min(1),
      group: z.enum(["무기", "가문", "보조", "생활"]),
      from: z.array(z.string().min(1)),
    }),
  ),
  /** 기술이 아니라 얻은 재능으로 옮기는 옛 기술 (진화) */
  skillsToTalents: z.array(z.strictObject({ from: z.string().min(1), talent: DefIdSchema })),
  /** 얻은 재능으로 옮기는 옛 진화 이력 */
  evolutionsToTalents: z.array(z.strictObject({ from: z.string().min(1), talent: DefIdSchema })),
  /** 옛 물건 이름 → 새 물건 */
  items: z.array(z.strictObject({ from: z.string().min(1), item: DefIdSchema })),
  /** 캐릭터별로 정해 둔 예외. 키는 옛 플레이어 이름 */
  characters: z.record(
    z.string().min(1),
    z.strictObject({
      /** 청한 재능. 옛 데이터에 없고 시트에만 있던 캐릭터 (기획서의 재능 표) */
      chosen: z.array(DefIdSchema).optional(),
      /** 타고난 재능 (옛 GM 데이터보다 앞선다) */
      innate: z.strictObject({ talent: DefIdSchema, revealed: z.boolean() }).optional(),
      /** 인물의 친밀도를 정해 둔 값으로 */
      people: z.array(z.strictObject({ name: z.string().min(1), intimacy: z.number().int() })).default([]),
      needsCheck: z.array(z.string().min(1)).default([]),
    }),
  ),
});
export type Migration = z.infer<typeof MigrationSchema>;
