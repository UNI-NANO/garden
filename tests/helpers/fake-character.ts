import rawLimits from "../../data/defs/limits.json";
import { newCharacter } from "../../src/rules/character";
import type { ExchangeContext, ExchangeState } from "../../src/rules/exchange";
import { ItemListSchema, type Item } from "../../src/schema/defs/item";
import { LimitsSchema } from "../../src/schema/defs/limits";
import { fakeItems } from "./fake-tree";

export const limits = LimitsSchema.parse(rawLimits);
export const NOW = Date.UTC(2026, 11, 1, 15, 0, 0);
export const DAY = 86_400_000;

export const items: ReadonlyMap<string, Item> = new Map(
  ItemListSchema.parse(fakeItems()).items.map((item) => [item.id, item]),
);

export const ctx = (over: Partial<ExchangeContext> = {}): ExchangeContext => ({
  now: NOW,
  limits,
  items,
  carryLimit: 100,
  ...over,
});

export const emptyState = (over: Partial<ExchangeState> = {}): ExchangeState => ({
  wallet: 0,
  bag: { stacks: {}, uniques: {} },
  claimedRewards: {},
  mailbox: {},
  ...over,
});

export const makeCharacter = (owner = "uid-a") =>
  newCharacter(limits, {
    owner,
    name: "시험 캐릭터",
    gender: "여",
    origin: { realm: "제국", region: "황도", place: "장터 골목" },
    chosenTalents: ["agility", "sturdy", "intuition"],
    monthKey: "514-3",
    now: NOW,
    stage: "살아 있음",
  });
