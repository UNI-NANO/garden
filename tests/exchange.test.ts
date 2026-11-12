import { describe, expect, it } from "vitest";
import { applyExchange, bagWeight, claimMail, stackKeyOf, type ExchangeChange } from "../src/rules/exchange";
import { ctx, DAY, emptyState, limits, NOW } from "./helpers/fake-character";

const change = (over: Partial<ExchangeChange> = {}): ExchangeChange => ({
  requestId: "req-1",
  reason: "시험",
  walletDelta: 0,
  gains: [],
  losses: [],
  overflow: "거절",
  ...over,
});
const herb = (quantity: number, freshness = 100) =>
  ({ kind: "묶음", itemId: "herb", quantity, freshness, quality: "중" }) as const;
const ironSword = (uniqueId: string) =>
  ({ kind: "낱개", uniqueId, item: { itemId: "sword.iron", enhance: 0, durability: 100, quality: "중" } }) as const;
const HERB = stackKeyOf("herb", 100, "중");

describe("지갑", () => {
  it("돈이 늘고 줄며 장부에 남는다", () => {
    const r = applyExchange(emptyState({ wallet: 100 }), change({ walletDelta: -30, reason: "빵 구매" }), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next.wallet).toBe(70);
    expect(r.ledger).toEqual({ at: NOW, requestId: "req-1", reason: "빵 구매", walletDelta: -30, walletAfter: 70, items: [] });
  });
  it("0 아래로는 내려가지 않는다 (딱 0은 됨)", () => {
    expect(applyExchange(emptyState({ wallet: 30 }), change({ walletDelta: -30 }), ctx())).toMatchObject({ ok: true });
    expect(applyExchange(emptyState({ wallet: 30 }), change({ walletDelta: -31 }), ctx())).toMatchObject({
      ok: false,
      reason: "돈 부족",
    });
  });
  it("지갑 최대와 한 번에 늘 수 있는 양을 넘지 못한다", () => {
    const cap = limits.exchange;
    expect(
      applyExchange(emptyState(), change({ walletDelta: cap.maxWalletGainPerChange + 1 }), ctx()),
    ).toMatchObject({ ok: false, reason: "한 번에 늘 수 있는 양 초과" });
    expect(applyExchange(emptyState({ wallet: cap.walletMax }), change({ walletDelta: 1 }), ctx())).toMatchObject({
      ok: false,
      reason: "지갑 한도 초과",
    });
    expect(applyExchange(emptyState(), change({ walletDelta: cap.maxWalletGainPerChange }), ctx()).ok).toBe(true);
  });
  it("정수가 아닌 돈, 빈 변경, 틀린 요청 ID를 거부한다", () => {
    expect(applyExchange(emptyState(), change({ walletDelta: 0.5 }), ctx())).toMatchObject({ reason: "잘못된 요청" });
    expect(applyExchange(emptyState(), change(), ctx())).toMatchObject({ reason: "잘못된 요청" });
    expect(applyExchange(emptyState(), change({ walletDelta: 1, requestId: "a/b" }), ctx())).toMatchObject({
      reason: "잘못된 요청",
    });
  });
});

describe("가방", () => {
  it("같은 물건·신선도·품질은 한 묶음으로 쌓이고, 다르면 다른 묶음", () => {
    const first = applyExchange(emptyState(), change({ gains: [herb(3), herb(2), herb(1, 50)] }), ctx());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.next.bag.stacks[HERB]?.quantity).toBe(5);
    expect(first.next.bag.stacks[stackKeyOf("herb", 50, "중")]?.quantity).toBe(1);
    expect(bagWeight(first.next.bag, ctx().items)).toBe(6);
  });
  it("물건을 빼면 수량이 줄고, 다 빼면 묶음이 사라진다", () => {
    const start = emptyState({ bag: { stacks: { [HERB]: { itemId: "herb", quantity: 5, freshness: 100, quality: "중" } }, uniques: {} } });
    const some = applyExchange(start, change({ losses: [{ kind: "묶음", stackKey: HERB, quantity: 2 }] }), ctx());
    expect(some.ok && some.next.bag.stacks[HERB]?.quantity).toBe(3);
    const all = applyExchange(start, change({ losses: [{ kind: "묶음", stackKey: HERB, quantity: 5 }] }), ctx());
    expect(all.ok && HERB in all.next.bag.stacks).toBe(false);
    expect(all.ok && all.ledger.items).toEqual([{ itemId: "herb", delta: -5, where: "가방" }]);
  });
  it("없는 물건이나 모자란 수량은 거부한다", () => {
    const start = emptyState({ bag: { stacks: { [HERB]: { itemId: "herb", quantity: 5, freshness: 100, quality: "중" } }, uniques: {} } });
    expect(applyExchange(start, change({ losses: [{ kind: "묶음", stackKey: HERB, quantity: 6 }] }), ctx())).toMatchObject({ reason: "없는 물건" });
    expect(applyExchange(start, change({ losses: [{ kind: "낱개", uniqueId: "u9" }] }), ctx())).toMatchObject({ reason: "없는 물건" });
  });
  it("낱개 물건은 하나씩, 같은 고유 ID는 두 번 못 가진다", () => {
    const got = applyExchange(emptyState(), change({ gains: [ironSword("u1")] }), ctx());
    expect(got.ok && got.next.bag.uniques["u1"]?.itemId).toBe("sword.iron");
    if (!got.ok) return;
    expect(applyExchange(got.next, change({ requestId: "req-2", gains: [ironSword("u1")] }), ctx())).toMatchObject({
      reason: "이미 가진 낱개 물건",
    });
    const lost = applyExchange(got.next, change({ requestId: "req-3", losses: [{ kind: "낱개", uniqueId: "u1" }] }), ctx());
    expect(lost.ok && Object.keys(lost.next.bag.uniques)).toEqual([]);
  });
  it("모르는 물건, 종류가 다른 물건, 틀린 수량·신선도를 거부한다", () => {
    const g = (gain: unknown) => applyExchange(emptyState(), change({ gains: [gain as never] }), ctx());
    expect(g({ kind: "묶음", itemId: "nope", quantity: 1, freshness: 100, quality: "중" })).toMatchObject({ reason: "모르는 물건" });
    expect(g({ kind: "묶음", itemId: "sword.iron", quantity: 1, freshness: 100, quality: "중" })).toMatchObject({ reason: "잘못된 요청" });
    expect(g(herb(0))).toMatchObject({ reason: "잘못된 요청" });
    expect(g(herb(1.5))).toMatchObject({ reason: "잘못된 요청" });
    expect(g(herb(1, 101))).toMatchObject({ reason: "잘못된 요청" });
    expect(g(herb(limits.exchange.maxQuantityGainPerChange + 1))).toMatchObject({ reason: "한 번에 늘 수 있는 양 초과" });
  });
  it("구매처럼 한 번에 여러 값이 바뀐다 (돈은 줄고 물건은 는다)", () => {
    const r = applyExchange(emptyState({ wallet: 50 }), change({ walletDelta: -20, gains: [herb(4)] }), ctx());
    expect(r.ok && [r.next.wallet, r.next.bag.stacks[HERB]?.quantity]).toEqual([30, 4]);
  });
});

describe("전부 되거나 하나도 안 되거나", () => {
  it("하나라도 어기면 원래 값은 그대로다", () => {
    const start = emptyState({ wallet: 10 });
    const before = structuredClone(start);
    // 물건은 받을 수 있지만 돈이 모자라다
    const r = applyExchange(start, change({ walletDelta: -11, gains: [herb(3)], rewardId: "quest.a" }), ctx());
    expect(r.ok).toBe(false);
    expect(start).toEqual(before);
  });
  it("성공해도 원래 값을 직접 고치지 않는다", () => {
    const start = emptyState({ wallet: 10 });
    const before = structuredClone(start);
    expect(applyExchange(start, change({ walletDelta: 5, gains: [herb(3)] }), ctx()).ok).toBe(true);
    expect(start).toEqual(before);
  });
  it("같은 입력이면 같은 결과", () => {
    const run = () => applyExchange(emptyState({ wallet: 10 }), change({ walletDelta: 5, gains: [herb(3), ironSword("u1")] }), ctx());
    expect(run()).toEqual(run());
  });
});

describe("보상", () => {
  it("같은 출처의 보상은 한 번만 받는다", () => {
    const reward = change({ walletDelta: 100, rewardId: "quest.deserter.done", reason: "의뢰 완료" });
    const first = applyExchange(emptyState(), reward, ctx());
    expect(first.ok && first.next.claimedRewards).toEqual({ quest_deserter_done: true });
    expect(first.ok && first.ledger.rewardId).toBe("quest.deserter.done");
    if (!first.ok) return;
    expect(applyExchange(first.next, { ...reward, requestId: "req-2" }, ctx())).toMatchObject({ reason: "이미 받은 보상" });
  });
});

describe("짐 한도와 우편함", () => {
  it("구매(거절)는 짐 한도를 넘으면 전부 취소", () => {
    expect(applyExchange(emptyState(), change({ gains: [herb(11)] }), ctx({ carryLimit: 10 }))).toMatchObject({ reason: "짐 한도 초과" });
    expect(applyExchange(emptyState(), change({ gains: [herb(10)] }), ctx({ carryLimit: 10 })).ok).toBe(true);
  });
  it("보상(우편함)은 넘친 몫만 우편함으로 가고 7일 보관", () => {
    const r = applyExchange(emptyState(), change({ gains: [herb(13), ironSword("u1")], overflow: "우편함" }), ctx({ carryLimit: 10 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next.bag.stacks[HERB]?.quantity).toBe(10);
    expect(r.mailed).toEqual(["req-1-0", "req-1-1"]);
    expect(r.next.mailbox["req-1-0"]).toEqual({ expiresAt: NOW + 7 * DAY, stack: { itemId: "herb", quantity: 3, freshness: 100, quality: "중" } });
    expect(r.next.mailbox["req-1-1"]?.unique?.uniqueId).toBe("u1");
    expect(r.ledger.items).toEqual([
      { itemId: "herb", delta: 10, where: "가방" },
      { itemId: "herb", delta: 3, where: "우편함" },
      { itemId: "sword.iron", delta: 1, where: "우편함" },
    ]);
  });
  it("물건을 빼면서 받으면 빠진 만큼 자리가 생긴다", () => {
    const start = emptyState({ bag: { stacks: { [HERB]: { itemId: "herb", quantity: 10, freshness: 100, quality: "중" } }, uniques: {} } });
    const r = applyExchange(start, change({ losses: [{ kind: "묶음", stackKey: HERB, quantity: 10 }], gains: [ironSword("u1")] }), ctx({ carryLimit: 10 }));
    expect(r.ok).toBe(true);
  });
  it("우편함에서 꺼내면 가방으로 오고 우편함에서 사라진다", () => {
    const filled = applyExchange(emptyState(), change({ gains: [herb(13)], overflow: "우편함" }), ctx({ carryLimit: 10 }));
    if (!filled.ok) throw new Error("준비 실패");
    const full = claimMail(filled.next, { requestId: "req-2", mailId: "req-1-0" }, ctx({ carryLimit: 10 }));
    expect(full).toMatchObject({ ok: false, reason: "짐 한도 초과" });
    const r = claimMail(filled.next, { requestId: "req-2", mailId: "req-1-0" }, ctx({ carryLimit: 20 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.next.bag.stacks[HERB]?.quantity).toBe(13);
    expect(r.next.mailbox).toEqual({});
    expect(r.ledger.items).toEqual([
      { itemId: "herb", delta: 3, where: "가방" },
      { itemId: "herb", delta: -3, where: "우편함" },
    ]);
  });
  it("보관 기간이 지났거나 없는 우편은 꺼낼 수 없다", () => {
    const filled = applyExchange(emptyState(), change({ gains: [herb(13)], overflow: "우편함" }), ctx({ carryLimit: 10 }));
    if (!filled.ok) throw new Error("준비 실패");
    const late = ctx({ carryLimit: 99, now: NOW + 7 * DAY });
    expect(claimMail(filled.next, { requestId: "req-2", mailId: "req-1-0" }, late)).toMatchObject({ reason: "보관 기간이 지남" });
    const justInTime = ctx({ carryLimit: 99, now: NOW + 7 * DAY - 1 });
    expect(claimMail(filled.next, { requestId: "req-2", mailId: "req-1-0" }, justInTime).ok).toBe(true);
    expect(claimMail(filled.next, { requestId: "req-2", mailId: "nope" }, ctx())).toMatchObject({ reason: "없는 물건" });
  });
  it("우편함에 있는 낱개 물건과 같은 고유 ID는 다시 받을 수 없다", () => {
    const filled = applyExchange(emptyState(), change({ gains: [ironSword("u1")], overflow: "우편함" }), ctx({ carryLimit: 0 }));
    if (!filled.ok) throw new Error("준비 실패");
    expect(applyExchange(filled.next, change({ requestId: "req-2", gains: [ironSword("u1")] }), ctx())).toMatchObject({ reason: "이미 가진 낱개 물건" });
  });
});
