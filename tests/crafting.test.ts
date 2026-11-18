import { describe, expect, it } from "vitest";
import {
  countInBag,
  craftQuality,
  gameScore,
  knowsRecipe,
  materialGrade,
  pickStacks,
  recipeByName,
  tryCombine,
} from "../src/rules/crafting";
import type { Bag } from "../src/schema/character";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const { rules, stations, recipes } = defs.crafting;
const station = (id: string) => stations.find((s) => s.id === id)!;
const recipe = (id: string) => recipes.find((r) => r.id === id)!;

const bag: Bag = {
  stacks: {
    a: { itemId: "hill-mugwort", quantity: 2, freshness: 80, quality: "상" },
    b: { itemId: "hill-mugwort", quantity: 3, freshness: 40, quality: "최상" },
    c: { itemId: "hill-mugwort", quantity: 1, freshness: 40, quality: "하" },
    d: { itemId: "bloodstop-herb", quantity: 2, freshness: 100, quality: "중" },
  },
  uniques: {},
};

describe("제작", () => {
  it("아는 레시피: 처음부터 아는 것과 배운 것", () => {
    expect(knowsRecipe(recipe("hemostatic-salve"), {})).toBe(true);
    expect(knowsRecipe(recipe("detox-poultice"), {})).toBe(false);
    expect(
      knowsRecipe(recipe("detox-poultice"), { "detox-poultice": true }),
    ).toBe(true);
  });

  it("재료는 신선도 낮은 것부터, 같으면 품질 낮은 것부터. 모자라면 못 고른다", () => {
    expect(pickStacks(bag, "hill-mugwort", 3)).toEqual([
      { stackKey: "c", quantity: 1, quality: "하" },
      { stackKey: "b", quantity: 2, quality: "최상" },
    ]);
    expect(pickStacks(bag, "hill-mugwort", 7)).toBeUndefined();
    expect(countInBag(bag, "hill-mugwort")).toBe(6);
  });

  it("재료 등급은 품질의 수량 가중 평균, 미니게임은 판정 점수의 평균", () => {
    expect(
      materialGrade([{ stackKey: "x", quantity: 2, quality: "최상" }]),
    ).toBe(1);
    expect(
      materialGrade([
        { stackKey: "x", quantity: 1, quality: "하" },
        { stackKey: "y", quantity: 1, quality: "최상" },
      ]),
    ).toBe(0.5);
    expect(
      gameScore(["완벽", "좋음", "빗나감"], station("forge"), rules),
    ).toBeCloseTo((1 + 0.7 + 0) / 3);
    expect(() => gameScore(["완벽"], station("forge"), rules)).toThrow("3번");
  });

  it("품질: 실패 없이 하~최상. 숙련 기술이 있는 작업장(약방)만 숙련도를 본다", () => {
    expect(
      craftQuality({ game: 1, material: 1 }, station("forge"), rules),
    ).toBe("최상");
    expect(
      craftQuality({ game: 0, material: 0 }, station("forge"), rules),
    ).toBe("하");
    // 대장간은 숙련도를 넣어도 같다
    expect(
      craftQuality(
        { game: 0.6, material: 0.5, mastery: 100 },
        station("forge"),
        rules,
      ),
    ).toBe(craftQuality({ game: 0.6, material: 0.5 }, station("forge"), rules));
    // 약방은 숙련도가 높으면 더 좋다
    expect(
      craftQuality(
        { game: 0.6, material: 0.5, mastery: 100 },
        station("apothecary"),
        rules,
      ),
    ).toBe("상");
    expect(
      craftQuality(
        { game: 0.6, material: 0.5, mastery: 0 },
        station("apothecary"),
        rules,
      ),
    ).toBe("중");
  });

  it("조합 시도: 재료 종류가 레시피와 같으면 배우고(수량은 상관없음), 아니면 종류마다 절반(내림, 최소 1)을 잃는다", () => {
    expect(
      tryCombine(
        "apothecary",
        [
          { item: "hill-mugwort", quantity: 1 },
          { item: "silver-willow-leaf", quantity: 1 },
        ],
        recipes,
        rules,
      ),
    ).toEqual({ kind: "배움", recipe: recipe("detox-poultice") });
    // 같은 재료라도 작업장이 다르면 틀림
    expect(
      tryCombine(
        "kitchen",
        [
          { item: "hill-mugwort", quantity: 1 },
          { item: "silver-willow-leaf", quantity: 1 },
        ],
        recipes,
        rules,
      ).kind,
    ).toBe("실패");
    expect(
      tryCombine(
        "apothecary",
        [
          { item: "hill-mugwort", quantity: 5 },
          { item: "timber", quantity: 1 },
        ],
        recipes,
        rules,
      ),
    ).toEqual({
      kind: "실패",
      losses: [
        { item: "hill-mugwort", quantity: 2 },
        { item: "timber", quantity: 1 },
      ],
    });
    expect(() => tryCombine("apothecary", [], recipes, rules)).toThrow();
    expect(() =>
      tryCombine(
        "apothecary",
        [
          { item: "timber", quantity: 1 },
          { item: "timber", quantity: 2 },
        ],
        recipes,
        rules,
      ),
    ).toThrow("두 번");
  });

  it("장면 결과의 레시피 이름(밑줄은 띄어쓰기)으로 찾는다", () => {
    expect(recipeByName("고기_꼬치", recipes)?.id).toBe("meat-skewer");
    expect(recipeByName("없는_레시피", recipes)).toBeUndefined();
  });
});
