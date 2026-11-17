import { describe, expect, it } from "vitest";
import { createBattle, incomingAttacks, resolveAllies, resolveEnemies, type BattleState } from "../src/rules/battle/engine";
import { reactionResult, reactionWidths } from "../src/rules/battle/judge";
import { built, ctx, enemyDef, hero, rules, setup, ultimate } from "./helpers/fake-battle";

const wolf = (id: string, slot: number, over = {}) => ({ id, def: enemyDef("wolf", { overrides: { hp: 999 }, ...over }), slot });
const rest = (unitId: string) => ({ unitId, type: "쉬기" as const });
const toEnemyPhase = (b: BattleState) => resolveAllies(b, b.allies.filter((a) => !a.down).map((a) => rest(a.id)), ctx);
const mate = (id: string, slot: number) => hero({ id, name: id, kind: "동료", slot, skills: [] });

describe("적 차례에 들어올 공격", () => {
  it("의도대로, 앞줄 적부터 차례로", () => {
    const b = toEnemyPhase(createBattle(setup([wolf("w2", 1), wolf("w1", 0)]), ctx));
    const list = incomingAttacks(b, ctx);
    expect(list.map((a) => [a.enemyId, a.allyId])).toEqual([
      ["w1", "hero"],
      ["w2", "hero"],
    ]);
    expect(list[0]).toMatchObject({ actionName: b.intents.find((i) => i.enemyId === "w1")!.actionName, power: 7, big: false });
  });
  it("아군 차례가 아니면 없다, 흐트러져 취소된 의도는 빠진다", () => {
    const b = createBattle(setup([wolf("w1", 0)]), ctx);
    expect(incomingAttacks(b, ctx)).toEqual([]);
    const after = toEnemyPhase(b);
    after.intents[0]!.cancelled = true;
    expect(incomingAttacks(after, ctx)).toEqual([]);
  });
  it("대신 받는 동료가 있으면 그 동료가 맞는다 (반응도 그 동료가)", () => {
    const cover = built("sword.riposte", ["a", "a2"]);
    let b = createBattle(setup([wolf("w1", 0)], [hero({ skills: [cover] }), mate("m", 1)]), ctx);
    b.intents[0]!.targetId = "m";
    b = resolveAllies(b, [{ unitId: "hero", type: "기술", skillId: cover.id, targetId: "w1", judgements: [] }, rest("m")], ctx);
    expect(incomingAttacks(b, ctx).map((a) => a.allyId)).toEqual(["hero"]);
    // 실제 적 차례와 같다: 받아치기를 넣으면 hero가 받아친다
    const done = resolveEnemies(b, { "w1>hero": "받아치기 성공" }, ctx);
    expect(done.events.find((e) => e.type === "반응")).toMatchObject({ ally: "hero", result: "받아치기 성공" });
  });
  it("기사의 맹세: 광역도 한 번만, 내가 받는다", () => {
    const oath = ultimate("sword.riposte.a2.u");
    let b = createBattle(setup([wolf("w1", 0)], [hero({ skills: [], ultimate: oath }), mate("m", 1)]), ctx);
    b.intents[0]!.targetId = "m";
    b.intents[0]!.range = "휩쓸기";
    b = resolveAllies(b, [{ unitId: "hero", type: "기술", skillId: oath.id, targetId: "w1", judgements: [] }, rest("m")], ctx);
    expect(incomingAttacks(b, ctx).map((a) => a.allyId)).toEqual(["hero"]);
  });
  it("광역 공격은 맞는 사람마다 하나씩, 나머지는 기준값 비율의 위력", () => {
    let b = createBattle(setup([wolf("w1", 0)], [hero(), mate("m", 1)]), ctx);
    b.intents[0]!.targetId = "hero";
    b.intents[0]!.range = "휩쓸기";
    b = toEnemyPhase(b);
    expect(incomingAttacks(b, ctx).map((a) => [a.allyId, a.power])).toEqual([
      ["hero", 7],
      ["m", 7 * rules.range.othersShare["휩쓸기"]],
    ]);
  });
});

describe("반응 판정", () => {
  const r = rules.reaction;
  it("칸 폭: 막기 30, 받아치기 10 + 자세, 피하기 20", () => {
    expect(reactionWidths(r, "막기", 6, 100).good).toBe(30);
    expect(reactionWidths(r, "받아치기", 6, 100).good).toBe(16);
    expect(reactionWidths(r, "피하기", 6, 100)).toEqual({ good: 20, perfect: 0, normalEachSide: 0 });
  });
  it("칸 안이면 성공, 밖이거나 끝까지 안 누르면 그냥 맞음", () => {
    const guard = reactionWidths(r, "막기", 0, 100);
    expect([50, 35, 65, 34.9, 66, undefined].map((p) => reactionResult(guard, 100, "막기", p))).toEqual(["막기 성공", "막기 성공", "막기 성공", "없음", "없음", "없음"]);
    const parry = reactionWidths(r, "받아치기", 0, 100);
    expect([reactionResult(parry, 100, "받아치기", 50), reactionResult(parry, 100, "받아치기", 40)]).toEqual(["받아치기 성공", "없음"]);
    expect(reactionResult(reactionWidths(r, "피하기", 0, 100), 100, "피하기", 55)).toBe("피하기 성공");
  });
  it("자세의 받아치기 칸이 넓어지면 반영된다", () => {
    const stance = built("sword.riposte", ["a"]);
    const b = resolveAllies(createBattle(setup([wolf("w1", 0)], [hero({ skills: [stance] })]), ctx), [{ unitId: "hero", type: "기술", skillId: stance.id, targetId: "w1", judgements: [] }], ctx);
    expect(b.allies[0]!.stance?.parryWidth).toBe(6);
  });
  it("제한 시간은 기준값에", () => {
    expect(rules.timers).toEqual({ allySeconds: 60, reactionSeconds: 10 });
  });
});
