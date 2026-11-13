import { z } from "zod";
import { DefIdSchema } from "./defs/common";

/**
 * 캐릭터의 비밀. `/secrets/{캐릭터 ID}`에 두고 GM만 읽고 쓴다.
 * 캐릭터 본체는 주인이 읽을 수 있으므로, 플레이어가 아직 몰라야 하는 것은 여기에 둔다.
 */
export const SecretsSchema = z.strictObject({
  /** 아직 드러나지 않은 타고난 재능. 드러나면 캐릭터의 talents.innate로 옮기고 여기서 지운다 */
  innate: DefIdSchema.optional(),
  /** GM만 보는 인물 */
  hiddenPeople: z
    .array(z.strictObject({ name: z.string().min(1), relation: z.string(), intimacy: z.number().int(), note: z.string() }))
    .default([]),
  /** GM만 보는 메모 */
  notes: z.array(z.string().min(1)).default([]),
});
export type Secrets = z.infer<typeof SecretsSchema>;
