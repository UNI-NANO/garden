import { z } from "zod";
import { DefIdSchema, defHeader } from "./common";

export const ItemKindSchema = z.enum(["묶음", "낱개"]);
export type ItemKind = z.infer<typeof ItemKindSchema>;

/** 물건 카드. 지금은 짐을 셀 때 필요한 칸만 있다. 값·신선도 분류·효과는 그 시스템을 만들 때 더한다. */
export const ItemSchema = z.strictObject({
  id: DefIdSchema,
  name: z.string().min(1),
  /** 묶음: 수량으로 쌓임(재료 등) / 낱개: 하나하나 고유(장비·유일물) */
  kind: ItemKindSchema,
  /** 하나의 무게 */
  weight: z.number().min(0),
});
export type Item = z.infer<typeof ItemSchema>;

export const ItemListSchema = z.strictObject({
  ...defHeader,
  items: z.array(ItemSchema),
});
export type ItemList = z.infer<typeof ItemListSchema>;
