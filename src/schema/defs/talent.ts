import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";

/** 재능 카드. 지금은 이름과 갈래만 있다. 효과와 얻는 조건은 재능 시스템을 만들 때 더한다. */
export const TalentSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  /** 같은 재능이 타고난 재능으로도, 얻은 재능으로도 있을 수 있다 */
  kinds: z.array(z.enum(["청한", "타고난", "얻은"])).min(1),
  rarity: z.enum(["흔함", "드묾", "전설"]).optional(),
});
export type Talent = z.infer<typeof TalentSchema>;

export const TalentListSchema = z.strictObject({
  ...defHeader,
  talents: z.array(TalentSchema),
});
export type TalentList = z.infer<typeof TalentListSchema>;
