import { describe, expect, it } from "vitest";
import { DefIdSchema } from "../src/schema/defs/common";

describe("정의 데이터 ID", () => {
  it.each(["sword", "sword.gale", "sword.gale.a1", "skill-table", "a1.b-2.c3"])("%s 통과", (id) => {
    expect(DefIdSchema.safeParse(id).success).toBe(true);
  });
  it.each(["", "검술", "Sword", "sword..gale", ".sword", "sword.", "sword gale", "sword/gale", "sword_gale"])(
    "%s 거부",
    (id) => {
      expect(DefIdSchema.safeParse(id).success).toBe(false);
    },
  );
});
