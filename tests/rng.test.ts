import { describe, expect, it } from "vitest";
import { createRng, seedFromString } from "../src/rules/rng";

const take = (seed: number | string, n: number) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe("씨앗 난수", () => {
  it("같은 씨앗이면 같은 순서가 나온다", () => {
    expect(take(42, 100)).toEqual(take(42, 100));
    expect(take("요청-abc", 100)).toEqual(take("요청-abc", 100));
  });

  it("씨앗이 다르면 순서가 다르다", () => {
    expect(take(1, 10)).not.toEqual(take(2, 10));
    expect(seedFromString("a")).not.toBe(seedFromString("b"));
  });

  it("값은 0 이상 1 미만이다", () => {
    for (const v of take(7, 10_000)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("결과가 고정되어 있다 (구현이 바뀌면 이 테스트가 알려준다)", () => {
    const rng = createRng(12345);
    expect([rng.int(1, 100), rng.int(1, 100), rng.int(1, 100)]).toMatchInlineSnapshot(`
      [
        98,
        31,
        49,
      ]
    `);
  });

  it("int는 양 끝을 포함하고 범위를 벗어나지 않는다", () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(rng.int(1, 6));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(createRng(1).int(5, 5)).toBe(5);
  });

  it("잘못된 범위는 거부한다", () => {
    const rng = createRng(1);
    expect(() => rng.int(3, 2)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
  });
});
