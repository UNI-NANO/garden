import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { commitExchange, type DbPort } from "../../src/data/commit";
import { applyExchange, claimMail, stackKeyOf, type ExchangeChange, type ExchangeState } from "../../src/rules/exchange";
import { characterSchema } from "../../src/schema/character";
import { ctx, limits, makeCharacter } from "../helpers/fake-character";
import { CID, OTHER, OWNER, portOf, readAll, seed, startTestEnv } from "./helpers";

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));
beforeEach(async () => {
  const character = makeCharacter(OWNER);
  character.wallet = 100;
  await seed(testEnv, character);
});

const port = (uid = OWNER): DbPort => portOf(testEnv.authenticatedContext(uid).database());
const now = () => Date.now();
const change = (over: Partial<ExchangeChange> = {}): ExchangeChange => ({
  requestId: "req-1",
  reason: "시험",
  walletDelta: 0,
  gains: [],
  losses: [],
  overflow: "거절",
  ...over,
});
const herb = (quantity: number) => ({ kind: "묶음", itemId: "herb", quantity, freshness: 100, quality: "중" }) as const;
const HERB = stackKeyOf("herb", 100, "중");

/** 주고받기 한 번을 저장한다 */
const commit = (c: ExchangeChange, opts: { db?: DbPort; carryLimit?: number } = {}) => {
  const at = now();
  const context = ctx({ now: at, carryLimit: opts.carryLimit ?? 100 });
  return commitExchange(opts.db ?? port(), CID, c.requestId, (state) => applyExchange(state, c, context), { limits, now: at });
};
const character = async () => characterSchema(limits).parse(await readAll(testEnv, `characters/${CID}`));

describe("저장 모양", () => {
  it("빈 칸이 사라진 채 저장된 캐릭터도 스키마를 통과한다", async () => {
    const raw = (await readAll(testEnv, `characters/${CID}`)) as Record<string, unknown>;
    expect(raw["bag"]).toBeUndefined();
    expect(raw["claimedRewards"]).toBeUndefined();
    expect((await character()).bag).toEqual({ stacks: {}, uniques: {} });
  });
});

describe("주고받기 저장", () => {
  it("지갑·가방·수정 번호·요청 기록·장부가 한 번에 쓰인다", async () => {
    const result = await commit(change({ walletDelta: -30, gains: [herb(4)], reason: "약초 구매" }));
    expect(result.status).toBe("ok");

    const c = await character();
    expect(c.wallet).toBe(70);
    expect(c.bag.stacks[HERB]).toEqual({ itemId: "herb", quantity: 4, freshness: 100, quality: "중" });
    expect(c.meta).toMatchObject({ rev: 1, lastRequestId: "req-1" });
    expect(await readAll(testEnv, `requests/${CID}/req-1`)).toMatchObject({ kind: "주고받기" });
    expect(await readAll(testEnv, `ledger/${CID}/req-1`)).toMatchObject({
      reason: "약초 구매",
      walletDelta: -30,
      walletAfter: 70,
      items: [{ itemId: "herb", delta: 4, where: "가방" }],
    });
  });

  it("같은 요청이 두 번 오면 한 번만 처리하고, 그때의 결과를 돌려준다", async () => {
    const c = change({ walletDelta: -30, gains: [herb(4)] });
    const first = await commit(c);
    const second = await commit(c);
    expect(first.status).toBe("ok");
    expect(second.status).toBe("duplicate");
    if (first.status === "ok" && second.status === "duplicate") expect(second.ledger).toEqual(first.ledger);
    const after = await character();
    expect([after.wallet, after.bag.stacks[HERB]?.quantity, after.meta.rev]).toEqual([70, 4, 1]);
  });

  it("같은 요청을 두 기기에서 동시에 보내도 한 번만 처리한다", async () => {
    const c = change({ walletDelta: -30 });
    const results = await Promise.all([commit(c, { db: port() }), commit(c, { db: port() })]);
    expect(results.map((r) => r.status).sort()).toEqual(["duplicate", "ok"]);
    expect((await character()).wallet).toBe(70);
  });

  it("두 기기에서 서로 다른 요청을 동시에: 이전 값을 보고 계산한 쪽은 충돌로 거절된다", async () => {
    // 두 번째 기기는 첫 번째가 쓰기 전의 값을 이미 읽어 둔 상태
    const real = port();
    const stale = new Map<string, unknown>();
    for (const part of ["meta/rev", "wallet", "bag", "claimedRewards", "mailbox"]) {
      stale.set(`characters/${CID}/${part}`, await real.get(`characters/${CID}/${part}`));
    }
    const staleDevice: DbPort = { get: async (path) => (stale.has(path) ? stale.get(path) : real.get(path)), update: real.update };

    expect((await commit(change({ requestId: "req-a", walletDelta: -80 }))).status).toBe("ok");
    // 낡은 값(지갑 100)으로는 -80이 가능해 보이지만, 실제로는 20뿐이다
    expect((await commit(change({ requestId: "req-b", walletDelta: -80 }), { db: staleDevice })).status).toBe("conflict");

    const after = await character();
    expect([after.wallet, after.meta.rev]).toEqual([20, 1]);
    expect(await readAll(testEnv, `requests/${CID}/req-b`)).toBeNull();
    // 새로 읽고 다시 하면 돈이 모자라 거절된다
    expect(await commit(change({ requestId: "req-b", walletDelta: -80 }))).toMatchObject({ status: "rejected", reason: "돈 부족" });
  });

  it("규칙을 어기면 아무것도 쓰이지 않는다", async () => {
    const before = await readAll(testEnv, "/");
    const result = await commit(change({ walletDelta: -101, gains: [herb(4)] }));
    expect(result).toMatchObject({ status: "rejected", reason: "돈 부족" });
    expect(await readAll(testEnv, "/")).toEqual(before);
  });

  it("계산을 속여 범위 밖 값을 쓰려 하면 보안 규칙이 통째로 막는다", async () => {
    const before = await readAll(testEnv, "/");
    const cheat = (state: ExchangeState) => {
      const honest = applyExchange(state, change({ gains: [herb(4)] }), ctx({ now: now() }));
      if (!honest.ok) return honest;
      // 화면 코드를 고쳐 한 번에 상한보다 많은 돈을 넣으려는 경우
      const wallet = state.wallet + limits.exchange.maxWalletGainPerChange + 1;
      return { ...honest, next: { ...honest.next, wallet }, ledger: { ...honest.ledger, walletAfter: wallet } };
    };
    const result = await commitExchange(port(), CID, "req-1", cheat, { limits, now: now() });
    expect(result.status).toBe("conflict");
    expect(await readAll(testEnv, "/")).toEqual(before);
  });

  it("남의 캐릭터에는 저장할 수 없다", async () => {
    const before = await readAll(testEnv, "/");
    await expect(commit(change({ walletDelta: 10 }), { db: port(OTHER) })).rejects.toThrow();
    expect(await readAll(testEnv, "/")).toEqual(before);
  });

  it("같은 보상은 요청 ID가 달라도 한 번만 받는다", async () => {
    const reward = (requestId: string) => change({ requestId, walletDelta: 50, rewardId: "quest.deserter.done", reason: "의뢰 완료" });
    expect((await commit(reward("req-1"))).status).toBe("ok");
    expect(await commit(reward("req-2"))).toMatchObject({ status: "rejected", reason: "이미 받은 보상" });
    const after = await character();
    expect([after.wallet, after.claimedRewards]).toEqual([150, { quest_deserter_done: true }]);
  });

  it("물건을 다 쓰면 묶음이 사라지고, 여러 번 이어서 저장된다", async () => {
    expect((await commit(change({ requestId: "req-1", gains: [herb(5)] }))).status).toBe("ok");
    expect((await commit(change({ requestId: "req-2", losses: [{ kind: "묶음", stackKey: HERB, quantity: 2 }] }))).status).toBe("ok");
    expect((await character()).bag.stacks[HERB]?.quantity).toBe(3);
    expect((await commit(change({ requestId: "req-3", walletDelta: 9, losses: [{ kind: "묶음", stackKey: HERB, quantity: 3 }] }))).status).toBe("ok");
    const after = await character();
    expect([after.bag.stacks, after.wallet, after.meta.rev]).toEqual([{}, 109, 3]);
  });

  it("짐이 넘친 보상은 우편함으로 가고, 자리가 생기면 꺼낼 수 있다", async () => {
    const reward = change({ gains: [herb(13)], overflow: "우편함", rewardId: "raid.1" });
    const result = await commit(reward, { carryLimit: 10 });
    expect(result).toMatchObject({ status: "ok", mailed: ["req-1-0"] });
    let c = await character();
    expect([c.bag.stacks[HERB]?.quantity, c.mailbox["req-1-0"]?.stack?.quantity]).toEqual([10, 3]);

    const claim = (requestId: string, carryLimit: number) => {
      const at = now();
      return commitExchange(port(), CID, requestId, (s) => claimMail(s, { requestId, mailId: "req-1-0" }, ctx({ now: at, carryLimit })), { limits, now: at });
    };
    expect(await claim("req-2", 10)).toMatchObject({ status: "rejected", reason: "짐 한도 초과" });
    expect((await claim("req-3", 20)).status).toBe("ok");
    c = await character();
    expect([c.bag.stacks[HERB]?.quantity, c.mailbox]).toEqual([13, {}]);
    expect(await claim("req-4", 20)).toMatchObject({ status: "rejected", reason: "없는 물건" });
  });
});
