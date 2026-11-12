import { describe, expect, it } from "vitest";
import { characterSchema } from "../src/schema/character";
import { idToKey, keyToId } from "../src/schema/keys";
import { limits, makeCharacter } from "./helpers/fake-character";

const schema = characterSchema(limits);
const bad = (change: (c: ReturnType<typeof makeCharacter>) => void) => {
  const c = makeCharacter();
  change(c);
  return schema.safeParse(c).success;
};

describe("캐릭터 저장 모양", () => {
  it("새 캐릭터는 스키마를 통과하고 처음 값을 가진다", () => {
    const c = schema.parse(makeCharacter());
    expect(c.abilities.health).toBe(limits.abilities.initial);
    expect(c.month).toMatchObject({ mainActions: 4, minorActions: 2, savedActions: 0 });
    expect(c.wallet).toBe(0);
    expect(c.meta.rev).toBe(0);
  });

  it("데이터베이스를 다녀와 빈 칸이 사라져도 그대로 읽힌다", () => {
    // Realtime Database는 빈 객체·빈 배열·undefined를 저장하지 않는다
    const strip = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.length === 0 ? undefined : value.map(strip);
      if (value !== null && typeof value === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          const kept = strip(v);
          if (kept !== undefined) out[k] = kept;
        }
        return Object.keys(out).length === 0 ? undefined : out;
      }
      return value;
    };
    const stripped = strip(makeCharacter()) as Record<string, unknown>;
    expect(stripped["bag"]).toBeUndefined();
    expect(stripped["claimedRewards"]).toBeUndefined();
    expect(schema.parse(stripped)).toEqual(schema.parse(makeCharacter()));
  });

  it("범위를 벗어난 값을 거부한다", () => {
    expect(bad((c) => void (c.wallet = -1))).toBe(false);
    expect(bad((c) => void (c.wallet = 1.5))).toBe(false);
    expect(bad((c) => void (c.wallet = limits.exchange.walletMax + 1))).toBe(false);
    expect(bad((c) => void (c.abilities.health = 101))).toBe(false);
    expect(bad((c) => void (c.abilities.spirit = -1))).toBe(false);
    expect(bad((c) => void (c.month.mainActions = 5))).toBe(false);
    expect(bad((c) => void (c.month.savedActions = 5))).toBe(false);
    expect(bad((c) => void (c.month.key = "514-12"))).toBe(false);
    expect(bad((c) => void (c.mastery["sword"] = { value: 100.5, passed60: true, passed80: true }))).toBe(false);
    expect(bad((c) => void (c.mastery["sword"] = { value: 59.999, passed60: false, passed80: false }))).toBe(false);
  });

  it("빠진 칸, 모르는 칸, 틀린 수의 재능을 거부한다", () => {
    expect(bad((c) => void ((c as Record<string, unknown>)["cheat"] = 1))).toBe(false);
    expect(bad((c) => void delete (c as Partial<typeof c>).wallet)).toBe(false);
    expect(bad((c) => void c.talents.chosen.pop())).toBe(false);
    expect(bad((c) => void (c.profile.name = ""))).toBe(false);
    expect(bad((c) => void (c.loadout.basics = ["a", "b", "c", "d"]))).toBe(false);
  });

  it("가방의 물건 모양을 검사한다", () => {
    const stack = { itemId: "herb", quantity: 3, freshness: 80, quality: "중" as const };
    expect(bad((c) => void (c.bag.stacks["herb-f80-q1"] = stack))).toBe(true);
    expect(bad((c) => void (c.bag.stacks["herb-f80-q1"] = { ...stack, quantity: 0 }))).toBe(false);
    expect(bad((c) => void (c.bag.stacks["herb-f80-q1"] = { ...stack, freshness: 101 }))).toBe(false);
    expect(bad((c) => void (c.bag.stacks["herb.f80"] = stack))).toBe(false);
    expect(
      bad((c) => void (c.bag.uniques["u1"] = { itemId: "sword.iron", enhance: 21, durability: 100, quality: "상" })),
    ).toBe(false);
  });
});

describe("데이터베이스 키", () => {
  it("정의 데이터 ID의 점을 밑줄로 바꾸고 되돌린다", () => {
    expect(idToKey("sword.gale.a1")).toBe("sword_gale_a1");
    expect(keyToId(idToKey("sword.gale.a1"))).toBe("sword.gale.a1");
  });
});
