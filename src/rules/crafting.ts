import type { Bag, Quality } from "../schema/character";
import type { CraftingRules, Recipe, Station } from "../schema/defs/crafting";
import type { Judgement } from "../schema/defs/skill-table";
import { idToKey } from "../schema/keys";

/**
 * 제작 (명세서 「가방·신선도·제작·강화」 → 제작). 모두 순수 함수.
 * 아는 레시피 + 재료 + 작업장 → 타이밍 미니게임 → 품질(실패 없음). 조합 시도로 레시피를 발견한다.
 */

const QUALITIES: readonly Quality[] = ["하", "중", "상", "최상"];

export class CraftingError extends Error {
  override name = "CraftingError";
}

/** 레시피를 아는가: 처음부터 아는 것이거나 배운 것 */
export const knowsRecipe = (
  recipe: Recipe,
  learned: Readonly<Record<string, true>>,
) => recipe.known || learned[idToKey(recipe.id)] === true;

export interface Taken {
  stackKey: string;
  quantity: number;
  quality: Quality;
}

/**
 * 재료를 고른다: 신선도가 낮은 묶음부터, 같으면 품질이 낮은 것부터 (명세서 경계 상황).
 * 모자라면 undefined.
 */
export function pickStacks(
  bag: Bag,
  itemId: string,
  quantity: number,
): Taken[] | undefined {
  const stacks = Object.entries(bag.stacks)
    .filter(([, s]) => s.itemId === itemId)
    .sort(
      ([ka, a], [kb, b]) =>
        a.freshness - b.freshness ||
        QUALITIES.indexOf(a.quality) - QUALITIES.indexOf(b.quality) ||
        ka.localeCompare(kb),
    );
  const taken: Taken[] = [];
  let left = quantity;
  for (const [key, stack] of stacks) {
    if (left <= 0) break;
    const take = Math.min(left, stack.quantity);
    taken.push({ stackKey: key, quantity: take, quality: stack.quality });
    left -= take;
  }
  return left > 0 ? undefined : taken;
}

/** 가방에 있는 그 물건의 수량 */
export const countInBag = (bag: Bag, itemId: string) =>
  Object.values(bag.stacks).reduce(
    (sum, s) => sum + (s.itemId === itemId ? s.quantity : 0),
    0,
  );

/** 재료 등급 (0~1): 쓴 재료 품질의 수량 가중 평균 */
export function materialGrade(taken: readonly Taken[]): number {
  const total = taken.reduce((sum, t) => sum + t.quantity, 0);
  if (total === 0) return 0;
  return (
    taken.reduce(
      (sum, t) => sum + QUALITIES.indexOf(t.quality) * t.quantity,
      0,
    ) /
    (total * (QUALITIES.length - 1))
  );
}

/** 미니게임 점수 (0~1): 판정마다 점수의 평균. 칠 횟수만큼 판정이 있어야 한다 */
export function gameScore(
  judgements: readonly Judgement[],
  station: Station,
  rules: CraftingRules,
): number {
  if (judgements.length !== station.game.hits)
    throw new CraftingError(
      `${station.game.name}은 ${station.game.hits}번 친다`,
    );
  return (
    judgements.reduce((sum, j) => sum + rules.score[j], 0) / judgements.length
  );
}

/**
 * 품질 = 미니게임 + 재료 등급 + 숙련도(작업장에 숙련 기술이 있을 때만)의 무게 합 → 하~최상. 실패는 없다.
 * mastery: 0~100.
 */
export function craftQuality(
  input: { game: number; material: number; mastery?: number },
  station: Station,
  rules: CraftingRules,
): Quality {
  const w = rules.weights;
  const useMastery = station.mastery !== undefined;
  const total = w.game + w.material + (useMastery ? w.mastery : 0);
  const score =
    total === 0
      ? 0
      : (w.game * input.game +
          w.material * input.material +
          (useMastery
            ? (w.mastery * Math.min(100, Math.max(0, input.mastery ?? 0))) / 100
            : 0)) /
        total;
  return score >= rules.quality.최상
    ? "최상"
    : score >= rules.quality.상
      ? "상"
      : score >= rules.quality.중
        ? "중"
        : "하";
}

export type CombineResult =
  | { kind: "배움"; recipe: Recipe }
  | { kind: "실패"; losses: { item: string; quantity: number }[] };

/**
 * 조합 시도: 그 작업장에서, 넣은 재료 종류가 어떤 레시피의 재료 종류와 똑같으면 그 레시피를 배운다(재료는 그대로).
 * 아니면 넣은 재료 종류마다 그 수량의 일부(비율, 내림, 최소 1)를 잃는다.
 */
export function tryCombine(
  stationId: string,
  inputs: readonly { item: string; quantity: number }[],
  recipes: readonly Recipe[],
  rules: CraftingRules,
): CombineResult {
  if (inputs.length === 0) throw new CraftingError("재료를 넣지 않았다");
  if (new Set(inputs.map((i) => i.item)).size !== inputs.length)
    throw new CraftingError("같은 재료를 두 번 넣었다");
  if (inputs.some((i) => !Number.isSafeInteger(i.quantity) || i.quantity < 1))
    throw new CraftingError("수량은 1 이상");
  const key = inputs
    .map((i) => i.item)
    .sort()
    .join(",");
  const recipe = recipes.find(
    (r) =>
      r.station === stationId &&
      r.inputs
        .map((i) => i.item)
        .sort()
        .join(",") === key,
  );
  if (recipe) return { kind: "배움", recipe };
  return {
    kind: "실패",
    losses: inputs.map((i) => ({
      item: i.item,
      quantity: Math.max(1, Math.floor(i.quantity * rules.combineLoss)),
    })),
  };
}

/** 장면 결과 [레시피 이름]의 이름으로 레시피를 찾는다 (대본의 밑줄은 띄어쓰기) */
export const recipeByName = (name: string, recipes: readonly Recipe[]) =>
  recipes.find((r) => r.name === name.replaceAll("_", " "));
