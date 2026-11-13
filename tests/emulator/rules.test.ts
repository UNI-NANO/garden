import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { limits, makeCharacter } from "../helpers/fake-character";
import { CID, GM, OTHER, OWNER, readAll, seed, startTestEnv } from "./helpers";

let testEnv: RulesTestEnvironment;
beforeAll(async () => void (testEnv = await startTestEnv()));
afterAll(async () => void (await testEnv.cleanup()));
beforeEach(async () => void (await seed(testEnv)));

const as = (uid: string) => testEnv.authenticatedContext(uid).database();
const anon = () => testEnv.unauthenticatedContext().database();
const char = (path = "") => `characters/${CID}${path === "" ? "" : `/${path}`}`;
let counter = 0;

/** 올바른 봉투(수정 번호 +1, 새 요청 기록)를 붙인 쓰기. extra로 실제 바꿀 값을 넣는다 */
const enveloped = (extra: Record<string, unknown>, over: { rev?: number; rid?: string; ledger?: boolean } = {}) => {
  const rid = over.rid ?? `rq-${++counter}`;
  const updates: Record<string, unknown> = {
    [char("meta/rev")]: over.rev ?? 1,
    [char("meta/lastRequestId")]: rid,
    [`requests/${CID}/${rid}`]: { at: Date.now(), kind: "주고받기" },
    ...extra,
  };
  if (over.ledger !== false) {
    const wallet = (extra[char("wallet")] as number | undefined) ?? 0;
    updates[`ledger/${CID}/${rid}`] = { at: Date.now(), requestId: rid, reason: "시험", walletDelta: wallet, walletAfter: wallet };
  }
  return updates;
};
const HERB = { itemId: "herb", quantity: 3, freshness: 100, quality: "중" };

describe("누가 무엇을 읽고 쓸 수 있나", () => {
  it("로그인하지 않으면 아무것도 못 한다", async () => {
    await assertFails(anon().ref(char()).get());
    await assertFails(anon().ref("defs").get());
    await assertFails(anon().ref(char("wallet")).set(5));
  });
  it("내 캐릭터는 나와 GM만 읽는다", async () => {
    await assertSucceeds(as(OWNER).ref(char()).get());
    await assertSucceeds(as(GM).ref(char()).get());
    await assertFails(as(OTHER).ref(char()).get());
    await assertFails(as(OTHER).ref(char("wallet")).get());
    await assertFails(as(OWNER).ref("characters").get());
    await assertSucceeds(as(GM).ref("characters").get());
  });
  it("남의 캐릭터는 올바른 봉투를 붙여도 못 쓴다", async () => {
    await assertFails(as(OTHER).ref().update(enveloped({ [char("wallet")]: 10 })));
  });
  it("정의·세계는 GM만 쓰고, 로그인한 사람은 읽는다", async () => {
    await assertFails(as(OWNER).ref("defs/x").set(1));
    await assertFails(as(OWNER).ref("world/x").set(1));
    await assertSucceeds(as(GM).ref("defs/x").set(1));
    await assertSucceeds(as(GM).ref("world/x").set(1));
    await assertSucceeds(as(OWNER).ref("defs/x").get());
  });
  it("GM 목록은 GM도 플레이어도 고칠 수 없다", async () => {
    await assertFails(as(OWNER).ref(`gm/${OWNER}`).set(true));
    await assertFails(as(GM).ref(`gm/${OTHER}`).set(true));
  });
  it("플레이어는 캐릭터를 만들거나 지우거나 통째로 덮어쓸 수 없다", async () => {
    await assertFails(as(OTHER).ref("characters/char-2").set(makeCharacter(OTHER)));
    await assertFails(as(OWNER).ref(char()).remove());
    await assertFails(as(OWNER).ref(char()).set(makeCharacter(OWNER)));
    await assertSucceeds(as(GM).ref("characters/char-2").set(makeCharacter(OTHER)));
  });
  it("플레이어는 주인·기본 정보·재능을 고칠 수 없다", async () => {
    await assertFails(as(OWNER).ref().update(enveloped({ [char("meta/owner")]: OTHER })));
    await assertFails(as(OWNER).ref().update(enveloped({ [char("profile/name")]: "다른 이름" })));
    await assertFails(as(OWNER).ref().update(enveloped({ [char("talents/chosen/0")]: "x" })));
    await assertFails(as(OWNER).ref().update(enveloped({ [char("meta/stage")]: "죽음" })));
  });
});

describe("값을 바꾸려면 수정 번호와 새 요청 기록이 함께 있어야 한다", () => {
  it("올바른 봉투면 된다", async () => {
    await assertSucceeds(as(OWNER).ref().update(enveloped({ [char("wallet")]: 10 })));
    expect(await readAll(testEnv, char("wallet"))).toBe(10);
  });
  it("그냥 쓰면 안 된다", async () => {
    await assertFails(as(OWNER).ref(char("wallet")).set(10));
    await assertFails(as(OWNER).ref(char("bag/stacks/herb-f100-q1")).set(HERB));
    await assertFails(as(OWNER).ref(char("abilities/health")).set(100));
  });
  it("수정 번호가 그대로이거나 건너뛰면 안 된다", async () => {
    await assertFails(as(OWNER).ref().update(enveloped({ [char("wallet")]: 10 }, { rev: 0 })));
    await assertFails(as(OWNER).ref().update(enveloped({ [char("wallet")]: 10 }, { rev: 2 })));
  });
  it("요청 기록이 없으면 안 된다", async () => {
    const updates = enveloped({ [char("wallet")]: 10 }, { rid: "rq-x", ledger: false });
    delete updates[`requests/${CID}/rq-x`];
    await assertFails(as(OWNER).ref().update(updates));
  });
  it("같은 요청 ID는 두 번 쓸 수 없다", async () => {
    await assertSucceeds(as(OWNER).ref().update(enveloped({ [char("wallet")]: 10 }, { rid: "rq-same" })));
    await assertFails(as(OWNER).ref().update(enveloped({ [char("wallet")]: 20 }, { rid: "rq-same", rev: 2 })));
    expect(await readAll(testEnv, char("wallet"))).toBe(10);
  });
  it("요청 기록과 장부는 고치거나 지울 수 없고, 봉투 없이 남길 수도 없다", async () => {
    await assertSucceeds(as(OWNER).ref().update(enveloped({ [char("wallet")]: 10 }, { rid: "rq-keep" })));
    await assertFails(as(OWNER).ref(`requests/${CID}/rq-keep`).remove());
    await assertFails(as(OWNER).ref(`ledger/${CID}/rq-keep/walletDelta`).set(0));
    await assertFails(as(OWNER).ref(`ledger/${CID}/rq-keep`).remove());
    await assertFails(as(OWNER).ref(`ledger/${CID}/rq-fake`).set({ at: 1, requestId: "rq-fake", reason: "x", walletDelta: 0, walletAfter: 10 }));
    await assertFails(as(OWNER).ref(`requests/${CID}/rq-fake`).set({ at: 1, kind: "주고받기" }));
  });
  it("장부의 지갑 잔액은 실제 지갑과 같아야 한다", async () => {
    const updates = enveloped({ [char("wallet")]: 10 }, { rid: "rq-lie" });
    (updates[`ledger/${CID}/rq-lie`] as { walletAfter: number }).walletAfter = 999;
    await assertFails(as(OWNER).ref().update(updates));
  });
  it("남의 장부와 요청 기록은 읽을 수 없다", async () => {
    await assertFails(as(OTHER).ref(`ledger/${CID}`).get());
    await assertFails(as(OTHER).ref(`requests/${CID}`).get());
    await assertSucceeds(as(OWNER).ref(`ledger/${CID}`).get());
  });
});

describe("범위 밖 값은 올바른 봉투를 붙여도 저장되지 않는다", () => {
  const tryWrite = (extra: Record<string, unknown>) => as(OWNER).ref().update(enveloped(extra, { ledger: false }));

  it("지갑: 음수, 소수, 한 번에 너무 많이, 지우기", async () => {
    await assertFails(tryWrite({ [char("wallet")]: -1 }));
    await assertFails(tryWrite({ [char("wallet")]: 1.5 }));
    await assertFails(tryWrite({ [char("wallet")]: "많이" }));
    await assertFails(tryWrite({ [char("wallet")]: limits.exchange.maxWalletGainPerChange + 1 }));
    await assertFails(tryWrite({ [char("wallet")]: null }));
    await assertSucceeds(tryWrite({ [char("wallet")]: limits.exchange.maxWalletGainPerChange }));
  });
  it("묶음 물건: 수량 0·음수, 한 번에 너무 많이, 틀린 신선도·품질·키, 모르는 칸", async () => {
    const stack = (over: Record<string, unknown>, key = "herb-f100-q1") => tryWrite({ [char(`bag/stacks/${key}`)]: { ...HERB, ...over } });
    await assertFails(stack({ quantity: 0 }));
    await assertFails(stack({ quantity: -3 }));
    await assertFails(stack({ quantity: limits.exchange.maxQuantityGainPerChange + 1 }));
    await assertFails(stack({ freshness: 101 }));
    await assertFails(stack({ quality: "전설" }));
    await assertFails(stack({ cheat: 1 }));
    await assertFails(tryWrite({ [char("bag/gold")]: 5 }));
    await assertSucceeds(stack({}));
    // 이미 3개 있는 묶음을 한 번에 상한보다 더 늘리기
    await assertFails(
      as(OWNER).ref().update(enveloped({ [char("bag/stacks/herb-f100-q1/quantity")]: 3 + limits.exchange.maxQuantityGainPerChange + 1 }, { rev: 2, ledger: false })),
    );
  });
  it("낱개 물건: 강화·내구도 범위", async () => {
    const unique = (over: Record<string, unknown>) =>
      tryWrite({ [char("bag/uniques/u1")]: { itemId: "sword.iron", enhance: 0, durability: 100, quality: "중", ...over } });
    await assertFails(unique({ enhance: 21 }));
    await assertFails(unique({ durability: 101 }));
    await assertSucceeds(unique({}));
  });
  it("능력치·이번 달·숙련도 범위", async () => {
    await assertFails(tryWrite({ [char("abilities/health")]: 101 }));
    await assertFails(tryWrite({ [char("abilities/luck")]: 50 }));
    await assertFails(tryWrite({ [char("month/mainActions")]: 5 }));
    await assertFails(tryWrite({ [char("month/savedActions")]: -1 }));
    await assertFails(tryWrite({ [char("mastery/sword")]: { value: 101, passed60: true, passed80: true } }));
    await assertSucceeds(tryWrite({ [char("abilities/health")]: 60, [char("month/mainActions")]: 3 }));
  });
  it("받은 보상은 더할 수만 있고 지울 수 없다", async () => {
    await assertSucceeds(tryWrite({ [char("claimedRewards/quest_a")]: true }));
    await assertFails(as(OWNER).ref().update(enveloped({ [char("claimedRewards/quest_a")]: null }, { rev: 2, ledger: false })));
    await assertFails(as(OWNER).ref().update(enveloped({ [char("claimedRewards")]: null }, { rev: 2, ledger: false })));
    await assertFails(as(OWNER).ref().update(enveloped({ [char("claimedRewards/quest_b")]: "yes" }, { rev: 2, ledger: false })));
  });
});

describe("다 되거나 하나도 안 되거나", () => {
  it("여러 값 중 하나라도 규칙을 어기면 아무것도 쓰이지 않는다", async () => {
    const before = await readAll(testEnv, "/");
    await assertFails(
      as(OWNER).ref().update(enveloped({ [char("bag/stacks/herb-f100-q1")]: HERB, [char("wallet")]: -5 }, { rid: "rq-atomic" })),
    );
    expect(await readAll(testEnv, "/")).toEqual(before);
  });
});
