import { describe, expect, it } from "vitest";
import { buildSkill, buildUltimate, BuildSkillError, resolveAmount } from "../src/rules/battle/build-skill";
import {
  createBattle,
  playTurn,
  resolveAllies,
  resolveEnemies,
  chainBonus,
  skillCooldown,
  skillEnergyCost,
  skillGoodWidth,
  skillHitCount,
  skillHitPowers,
  skillTargets,
  type AllyAction,
  type BattleSkill,
  type BattleState,
} from "../src/rules/battle/engine";
import { judgementWidths } from "../src/rules/battle/numbers";
import type { Judgement } from "../src/schema/defs/skill-table";
import { autoAllyActions } from "../src/rules/battle/auto";
import { ultimate, built, ctx, enemyDef, hero, rules, setup, skill, swordTree, table } from "./helpers/fake-battle";

const wolf = (id = "w1", slot = 0, over = {}) => ({ id, def: enemyDef("wolf", over), slot });
const dummy = (id = "w1", slot = 0, over = {}) => wolf(id, slot, { overrides: { hp: 999, power: 0, stagger: 9999 }, ...over });
const good = (n: number) => Array.from({ length: n }, () => "좋음" as const);
const rest: AllyAction = { unitId: "hero", type: "쉬기" };
/** 이 기술 하나를 든 플레이어로 전투를 연다 */
const startWith = (s: BattleSkill, enemies = [dummy()]) => createBattle(setup(enemies, [hero({ skills: [s] })]), ctx);
const use = (s: BattleSkill, targetId = "w1", over: Partial<Extract<AllyAction, { type: "기술" }>> = {}): AllyAction => ({
  unitId: "hero",
  type: "기술",
  skillId: s.id,
  targetId,
  judgements: s.stance ? [] : good(s.hitCount),
  ...over,
});
const ally = (s: BattleState) => s.allies[0]!;
const foe = (s: BattleState, id = "w1") => s.enemies.find((e) => e.id === id)!;

describe("말의 기준값", () => {
  it("숫자는 그대로, 말은 기준값에서 읽는다", () => {
    expect(resolveAmount(rules.words, 0.05)).toBe(0.05);
    expect(resolveAmount(rules.words, "판정 칸 조금 넓게")).toBe(3);
    expect(() => resolveAmount(rules.words, "없는 말")).toThrow(BuildSkillError);
  });
});

describe("찍은 칸으로 기술 만들기", () => {
  it("아무것도 찍지 않으면 기본 모양 그대로", () => {
    expect(built("sword.gale")).toEqual(skill("sword.gale"));
    expect(() => buildSkill(table, [], rules.words, swordTree, "sword.gale.a", { picked: new Set(), choices: {} }, "근접")).toThrow(BuildSkillError);
  });
  it("연속 베기", () => {
    expect(built("sword.combo", ["s1", "s2"])).toMatchObject({ goodWidth: 3, holdEffects: ["bleed"] });
    const a = built("sword.combo", ["s1", "s2", "a", "a.s1", "a.s2"], { "a.s2": 0 });
    expect(a.effects).toEqual([{ id: "bleed", amount: 1 }]);
    expect(a.perfectEffects).toEqual([{ id: "bleed", amount: 1 }]);
    expect(a.baseHitPower).toBeCloseTo((6.48 / 3) * 1.05, 10);
    expect(a).toMatchObject({ effectCapBonus: { bleed: 2 }, energy: 1, role: "잇는" });
    expect(built("sword.combo", ["a", "a.s2"], { "a.s2": 1 })).toMatchObject({ energy: 0 });
    expect(built("sword.combo", ["b", "b.s1", "b.s2"], { "b.s2": 0 })).toMatchObject({ role: "끝내는", burst: { effect: "bleed", perStackPct: 0.05, keepShare: 0.5, toStagger: false } });
    expect(built("sword.combo", ["b", "b.s2"], { "b.s2": 1 }).burst).toMatchObject({ keepShare: 0, toStagger: true });
  });
  it("검풍", () => {
    const base = built("sword.gale", ["s1", "s2"]);
    expect(base.baseHitPower).toBeCloseTo(13.5 * 1.05, 10);
    expect(base.energy).toBe(2);
    expect(built("sword.gale", ["a", "a.s1", "a.s2"], { "a.s2": 0 })).toMatchObject({ othersShare: 0.8, othersStaggerShare: 1, alsoBehind: true, cooldown: 4, range: "휩쓸기" });
    expect(built("sword.gale", ["a", "a.s2"], { "a.s2": 1 })).toMatchObject({ cooldown: 3 });
    const b = built("sword.gale", ["s1", "b", "b.s1", "b.s2"], { "b.s2": 1 });
    expect(b).toMatchObject({ range: "단일", role: "잇는" });
    // 위력 +는 서로 더하고(+5% +5%), ×는 곱한다
    expect(b.baseHitPower).toBeCloseTo(13.5 * 1.1 * 1.4, 10);
    expect(b.staggerMultiplier).toBeCloseTo(1.5 * 1.1, 10);
    expect(built("sword.gale", ["b", "b.s2"], { "b.s2": 0 }).goodWidth).toBe(3);
  });
  it("되받아치기", () => {
    const a = built("sword.riposte", ["s1", "s2", "a", "a.s1", "a.s2"], { "a.s2": 1 });
    expect(a.baseHitPower).toBeCloseTo(11 * 1.05, 10);
    expect(a.stanceOpts).toEqual({ damageTaken: 0.9, parryWidth: 6, parryEnergy: 1, counterHits: 2 });
    expect(built("sword.riposte", ["a", "a.s2"], { "a.s2": 0 }).stanceOpts).toMatchObject({ holdTurns: 1 });
    const b = built("sword.riposte", ["b", "b.s1", "b.s2"], { "b.s2": 0 });
    expect(b.role).toBe("잇는");
    expect(b.stanceOpts?.thrust).toEqual({ share: 0.75, powerPct: 0.1, staggerMultiplier: 1, damageType: "관통" });
    expect(built("sword.riposte", ["b", "b.s2"], { "b.s2": 1 }).stanceOpts?.thrust).toMatchObject({ staggerMultiplier: 1.5 });
  });
  it("돌진 베기", () => {
    const a = built("sword.charge", ["s1", "s2", "a", "a.s1", "a.s2"], { "a.s2": 0 });
    expect(a.baseHitPower).toBeCloseTo(14.3 * 1.05, 10);
    expect(a).toMatchObject({ energy: 1, staggerMultiplier: 1.2, push: { pushedEffects: [{ id: "bind", amount: 1 }], pulledEffects: [] } });
    expect(built("sword.charge", ["a", "a.s2"], { "a.s2": 1 }).push).toEqual({ pushedEffects: [], pulledEffects: [{ id: "fragile", amount: 1 }] });
    const b = built("sword.charge", ["b", "b.s1", "b.s2"], { "b.s2": 1 });
    expect(b).toMatchObject({ role: "끝내는", damageType: "관통", reachBack: { multiplier: 0.85 }, intoEnemy: { powerPct: 0.2 } });
    expect(built("sword.charge", ["b", "b.s2"], { "b.s2": 0 }).intoEnemy).toBeUndefined();
  });
  it("기력과 쿨다운은 0 아래로 내려가지 않는다", () => {
    const combo = built("sword.combo", ["a", "a.s2"], { "a.s2": 1 });
    expect(combo.energy).toBe(0);
  });
});

describe("찍은 칸이 전투에서 하는 일", () => {
  it("출혈 유지: 붙은 턴의 턴 끝에는 줄지 않는다", () => {
    const s = built("sword.combo", ["s2"]);
    let b = playTurn(startWith(s), { actions: [use(s)], defenses: {} }, ctx);
    expect(foe(b).effects).toEqual({ bleed: 2 });
    b = playTurn(b, { actions: [rest], defenses: {} }, ctx);
    expect(foe(b).effects).toEqual({ bleed: 1 });
  });
  it("쌓기: 세 타 모두 출혈 1, 완벽이면 2. 출혈은 10에서 멈추고 상한 칸을 찍으면 12", () => {
    const s = built("sword.combo", ["a"]);
    expect(foe(resolveAllies(startWith(s), [use(s)], ctx)).effects).toEqual({ bleed: 3 });
    expect(foe(resolveAllies(startWith(s), [use(s, "w1", { judgements: ["완벽", "완벽", "좋음"] })], ctx)).effects).toEqual({ bleed: 5 });
    const perfect = { judgements: ["완벽", "완벽", "완벽"] as ("완벽")[] };
    const full = startWith(s);
    foe(full).effects = { bleed: 9 };
    expect(foe(resolveAllies(full, [use(s, "w1", perfect)], ctx)).effects).toEqual({ bleed: 10 });
    const raised = built("sword.combo", ["a", "a.s2"], { "a.s2": 0 });
    const more = startWith(raised);
    foe(more).effects = { bleed: 9 };
    expect(foe(resolveAllies(more, [use(raised, "w1", perfect)], ctx)).effects).toEqual({ bleed: 12 });
  });
  it("터뜨리기: 마지막 타에 출혈을 모두 없애고 그만큼 방어를 무시하는 피해", () => {
    const s = built("sword.combo", ["b"]);
    const b = startWith(s);
    foe(b).effects = { bleed: 4 };
    const hpBefore = foe(b).hp;
    const after = resolveAllies(b, [use(s)], ctx);
    // 세 타 4 + 4 + 4, 터뜨린 출혈 4 + 2(앞 두 타가 붙인 것) = 6
    expect(hpBefore - foe(after).hp).toBe(12 + 6);
    expect(foe(after).effects).toEqual({});
    expect(after.events.find((e) => e.type === "터뜨림")).toMatchObject({ stacks: 6, amount: 6 });
  });
  it("터뜨리기 강화·절반 남김·흐트러짐", () => {
    const run = (s: BattleSkill) => {
      const b = startWith(s, [dummy("w1", 0, { overrides: { hp: 999, power: 0, stagger: 100 } })]);
      foe(b).effects = { bleed: 4 };
      return resolveAllies(b, [use(s)], ctx);
    };
    // 6 × (1 + 0.05 × 6) = 7.8 → 8
    expect(run(built("sword.combo", ["b", "b.s1"])).events.find((e) => e.type === "터뜨림")).toMatchObject({ amount: 8 });
    expect(foe(run(built("sword.combo", ["b", "b.s2"], { "b.s2": 0 }))).effects).toEqual({ bleed: 3 });
    const plain = 100 - foe(run(built("sword.combo", ["b"]))).stagger;
    const toStagger = 100 - foe(run(built("sword.combo", ["b", "b.s2"], { "b.s2": 1 }))).stagger;
    expect(toStagger - plain).toBeCloseTo(6, 10);
  });
  it("검풍 넓게: 나머지 대상에게 80%, 뒤 칸도 맞는다", () => {
    const three = [dummy("w1", 0), dummy("w2", 1), dummy("w3", 4)];
    const wide = built("sword.gale", ["a"]);
    let b = resolveAllies(startWith(wide, three), [use(wide, "w2")], ctx);
    // 고른 적 22, 옆 14.715 × 0.8 × 1.5 = 17.66 → 18, 뒤 칸은 안 맞음
    expect([999 - foe(b, "w1").hp, 999 - foe(b, "w2").hp, 999 - foe(b, "w3").hp]).toEqual([18, 22, 0]);
    const behind = built("sword.gale", ["a", "a.s2"], { "a.s2": 0 });
    b = resolveAllies(startWith(behind, three), [use(behind, "w2")], ctx);
    expect(999 - foe(b, "w3").hp).toBe(18);
  });
  it("검풍 깊게: 한 명만, 위력 ×1.4, 흐트러짐 ×1.5", () => {
    const deep = built("sword.gale", ["b"]);
    const b = resolveAllies(startWith(deep, [dummy("w1", 0, { overrides: { hp: 999, power: 0, stagger: 100 } }), dummy("w2", 1)]), [use(deep)], ctx);
    // 13.5 × 1.4 × 1.09 × 1.5 = 30.9 → 31
    expect([999 - foe(b, "w1").hp, 999 - foe(b, "w2").hp]).toEqual([31, 0]);
    expect(100 - foe(b, "w1").stagger).toBeCloseTo(13.5 * 1.4 * 1.09 * 0.8 * 1.5, 6);
  });
  it("되받아치기: 자세 중 받는 피해 −10%, 받아치면 기력 +1, 반격 2타", () => {
    const guard = built("sword.riposte", ["s1"]);
    let b = playTurn(startWith(guard, [wolf()]), { actions: [use(guard)], defenses: {} }, ctx);
    // 7 × 0.9 = 6.3 → 6
    expect(ally(b).hp).toBe(55 - 6);
    const twice = built("sword.riposte", ["a", "a.s1", "a.s2"], { "a.s2": 1 });
    b = startWith(twice, [wolf("w1", 0, { overrides: { hp: 999 } })]);
    ally(b).energy = 5;
    b = playTurn(b, { actions: [use(twice)], defenses: { "w1>hero": "받아치기 성공" } }, ctx);
    // 반격 18이 두 번, 기력 5 − 2 + 1(받아치기) + 2(턴 끝)
    expect(999 - foe(b).hp).toBe(36);
    expect(ally(b)).toMatchObject({ hp: 55, energy: 6 });
  });
  it("되받아치기: 자세가 한 턴 더 이어진다", () => {
    const held = built("sword.riposte", ["a", "a.s2"], { "a.s2": 0 });
    let b = playTurn(startWith(held, [wolf("w1", 0, { overrides: { hp: 999 } })]), { actions: [use(held)], defenses: {} }, ctx);
    expect(ally(b).stance).toBeDefined();
    b = playTurn(b, { actions: [rest], defenses: { "w1>hero": "받아치기 성공" } }, ctx);
    // 다음 턴에도 자세의 위력(18)으로 반격하고, 그 턴 끝에 풀린다
    expect(999 - foe(b).hp).toBe(18);
    expect(ally(b).stance).toBeUndefined();
  });
  it("밀어붙이기: 자세를 잡으면서 고른 적을 약하게 찌른다", () => {
    const thrust = built("sword.riposte", ["b"]);
    const b = resolveAllies(startWith(thrust), [use(thrust)], ctx);
    // 6 × 0.75 × 1.09 × 1.5 = 7.36 → 7
    expect(999 - foe(b).hp).toBe(7);
    expect(ally(b).stance).toBeDefined();
    // 관통으로 바꾸면 자상 약점이 사라진다: 4.905 → 5
    const pierce = built("sword.riposte", ["b", "b.s2"], { "b.s2": 0 });
    expect(999 - foe(resolveAllies(startWith(pierce), [use(pierce)], ctx)).hp).toBe(5);
  });
  it("뚫기: 맞은 적을 뒷줄로 밀어내고 그 뒤의 적을 앞으로 끌어낸다", () => {
    const push = built("sword.charge", ["a", "a.s2"], { "a.s2": 0 });
    const two = [dummy("w1", 0), dummy("w2", 3)];
    let b = resolveAllies(startWith(push, two), [use(push)], ctx);
    expect([foe(b, "w1").slot, foe(b, "w2").slot]).toEqual([3, 0]);
    expect(foe(b, "w1").effects).toEqual({ bind: 1 });
    const pull = built("sword.charge", ["a", "a.s2"], { "a.s2": 1 });
    b = resolveAllies(startWith(pull, two), [use(pull)], ctx);
    expect(foe(b, "w2").effects).toEqual({ fragile: 1 });
    // 뒤가 비어 있으면 밀려나기만 한다
    b = resolveAllies(startWith(push), [use(push)], ctx);
    expect(foe(b).slot).toBe(3);
    // 빗나가면 밀어내지 못한다
    b = resolveAllies(startWith(push, two), [use(push, "w1", { judgements: ["빗나감"] })], ctx);
    expect(foe(b, "w1").slot).toBe(0);
  });
  it("뚫기: 밀려난 적을 고른 동료는 오류 없이 닿는 다음 적을 친다", () => {
    const push = built("sword.charge", ["a", "a.s2"], { "a.s2": 0 });
    const mate = hero({ id: "mate", name: "시험 동료", kind: "동료", slot: 1, skills: [] });
    const b0 = createBattle(setup([dummy("w1", 0), dummy("w2", 1)], [hero({ skills: [push] }), mate]), ctx);
    const cut = mate.basicAttack;
    const b = resolveAllies(b0, [use(push), { unitId: "mate", type: "기술", skillId: cut.id, targetId: "w1", judgements: good(cut.hitCount) }], ctx);
    expect(foe(b, "w1").slot).toBe(3);
    expect(foe(b, "w2").hp).toBeLessThan(999);
    // 처음부터 닿지 않는 대상을 고른 것은 여전히 오류다
    const far = createBattle(setup([dummy("w1", 0), dummy("w2", 3)], [hero()]), ctx);
    expect(() => resolveAllies(far, [{ unitId: "hero", type: "기술", skillId: cut.id, targetId: "w2", judgements: good(cut.hitCount) }], ctx)).toThrow("닿지 않는다");
  });
  it("찌르기: 앞줄이 서 있어도 뒷줄을 고를 수 있고, 그때는 위력 ×0.85", () => {
    const stab = built("sword.charge", ["b"]);
    const lines = [{ id: "s1", def: enemyDef("deserter.shield", { overrides: { hp: 999, power: 0 } }), slot: 0 }, { id: "c1", def: enemyDef("deserter.crossbow", { overrides: { hp: 999, power: 0 } }), slot: 3 }];
    const b = resolveAllies(startWith(stab, lines), [use(stab, "c1")], ctx);
    // 관통(보통) 14.3 × 1.09 × 0.85 − 2 = 11.25 → 11
    expect(999 - foe(b, "c1").hp).toBe(11);
    // 앞줄을 치면 감소가 없다: 15.587 − 2 = 13.59 → 14
    expect(999 - foe(resolveAllies(startWith(stab, lines), [use(stab, "s1")], ctx), "s1").hp).toBe(14);
    // 기본 모양의 돌진 베기는 뒷줄에 닿지 않는다
    const base = built("sword.charge");
    expect(() => resolveAllies(startWith(base, lines), [use(base, "c1")], ctx)).toThrow(/닿지 않는다/);
  });
  it("자리 바꿈: 그 턴에는 모든 적이 나를 먼저 노리고, 다음 턴 주는 위력 +20%", () => {
    const swap = built("sword.charge", ["b", "b.s2"], { "b.s2": 1 });
    const mate = hero({ id: "mate", name: "동료", kind: "동료", slot: 1, health: 0, skills: [] });
    const enemies = [wolf("w1", 0, { overrides: { hp: 999 } }), wolf("w2", 1, { overrides: { hp: 999 } })];
    let b = createBattle(setup(enemies, [hero({ skills: [swap] }), mate]), ctx);
    // 늑대는 체력이 낮은 동료를 노리려 했다
    expect(b.intents.map((i) => i.targetId)).toEqual(["mate", "mate"]);
    b = resolveAllies(b, [use(swap), { unitId: "mate", type: "쉬기" }], ctx);
    b = resolveEnemies(b, {}, ctx);
    expect(b.allies.find((a) => a.id === "mate")?.hp).toBe(30);
    expect(ally(b).hp).toBeLessThan(55 - 13);
    // 다음 턴: 베기 6.54 × 1.2 × 1.5 = 11.77 → 12 (보통은 10)
    const before = foe(b).hp;
    b = resolveAllies(b, [{ unitId: "hero", type: "기술", skillId: "sword.cut", targetId: "w1", judgements: ["좋음"] }, { unitId: "mate", type: "쉬기" }], ctx);
    expect(before - foe(b).hp).toBe(12);
    // 그다음 턴에는 사라진다
    b = resolveEnemies(b, {}, ctx);
    expect(ally(b).exposed).toBeUndefined();
  });
});

describe("조건이 붙은 규칙", () => {
  const cut = skill("sword.cut");
  const withRule = (rule: NonNullable<BattleSkill["conditional"]>[number]): BattleSkill => ({ ...cut, id: "test.cut", conditional: [rule] });
  const damage = (s: BattleSkill, prepare: (b: BattleState) => void = () => undefined, judgement: "좋음" | "완벽" = "좋음") => {
    const b = startWith(s, [dummy("w1", 0), dummy("w2", 3)]);
    prepare(b);
    return (targetId: string) => 999 - foe(resolveAllies(b, [use(s, targetId, { judgements: [judgement] })], ctx), targetId).hp;
  };

  it("대상이 흐트러졌을 때만", () => {
    const s = withRule({ kind: "위력 ×", amount: 2, when: "대상이 흐트러짐" });
    expect(damage(s)("w1")).toBe(10);
    // 흐트러진 적은 피해 1.5배가 이미 있다: 6.54 × 2 × 1.5 × 1.5 = 29.4 → 29
    expect(damage(s, (b) => void (foe(b).brokenOnTurn = 1))("w1")).toBe(29);
  });
  it("완벽으로 친 타에만", () => {
    const s = withRule({ kind: "위력 +", amount: 1, when: "완벽" });
    expect(damage(s)("w1")).toBe(10);
    // 6.54 × 1.3 × 2 × 1.5 = 25.5 → 26
    expect(damage(s, undefined, "완벽")("w1")).toBe(26);
  });
  it("연계 중일 때와 아닐 때", () => {
    const linked = withRule({ kind: "위력 +", amount: 0.5, when: "연계 중" });
    const alone = withRule({ kind: "위력 +", amount: 0.5, when: "연계 아님" });
    const chained = (b: BattleState) => {
      b.turn = 2;
      ally(b).chain = { last: "여는", turn: 1 };
    };
    // 6.54 × 1.5 × 1.5 = 14.7 → 15
    expect([damage(linked)("w1"), damage(linked, chained)("w1")]).toEqual([10, 15]);
    expect([damage(alone)("w1"), damage(alone, chained)("w1")]).toEqual([15, 10]);
  });
  it("좋음 칸의 폭도 조건을 따른다", () => {
    const s = withRule({ kind: "좋음 칸", amount: 6, when: "대상이 흐트러짐" });
    const b = startWith({ ...s, goodWidth: 3 });
    expect(skillGoodWidth(b, ally(b), { ...s, goodWidth: 3 }, foe(b))).toBe(3);
    foe(b).brokenOnTurn = 1;
    expect(skillGoodWidth(b, ally(b), { ...s, goodWidth: 3 }, foe(b))).toBe(9);
  });
});

/** 이 전투에서 플레이어가 바로 앞 턴에 여는 기술을 썼다고 놓는다 (연계 중) */
const chained = (b: BattleState) => {
  ally(b).chain = { last: "여는", turn: b.turn - 1 };
  return b;
};
const shield = (id = "s1", slot = 0) => ({ id, def: enemyDef("deserter.shield", { overrides: { hp: 999, power: 0, stagger: 9999 } }), slot });
const crossbow = (id = "c1", slot = 3) => ({ id, def: enemyDef("deserter.crossbow", { overrides: { hp: 999, power: 0, stagger: 9999 } }), slot });
const powersOf = (b: BattleState, s: BattleSkill, targetId = "w1", judgements: Judgement[] = good(s.hitCount)) =>
  skillHitPowers(b, ctx, ally(b), s, foe(b, targetId), judgements);

describe("끝갈래와 그 보완 칸: 연속 베기", () => {
  it("흐름: 연계 중이면 붙이는 출혈 2배, 보완 칸은 연계 보너스 +10%", () => {
    const flow = built("sword.combo", ["a", "a1"]);
    expect(foe(resolveAllies(startWith(flow), [use(flow)], ctx)).effects).toEqual({ bleed: 3 });
    expect(foe(resolveAllies(chained(startWith(flow)), [use(flow)], ctx)).effects).toEqual({ bleed: 6 });
    const more = built("sword.combo", ["a", "a1", "a1.s"]);
    const b = chained(startWith(more));
    expect(chainBonus(b, ctx, ally(b), more)).toBeCloseTo(0.2, 10);
    expect(chainBonus(startWith(more), ctx, ally(startWith(more)), more)).toBe(0);
  });
  it("홀로: 연계가 아닐 때 4타, 보완 칸은 그때 쿨다운 −1", () => {
    const alone = built("sword.combo", ["a", "a2"]);
    const b = startWith(alone);
    expect(skillHitCount(b, ally(b), alone, foe(b))).toBe(4);
    const c = chained(startWith(alone));
    expect(skillHitCount(c, ally(c), alone, foe(c))).toBe(3);
    expect(() => resolveAllies(startWith(alone), [use(alone)], ctx)).toThrow("4타");
    expect(foe(resolveAllies(startWith(alone), [use(alone, "w1", { judgements: good(4) })], ctx)).effects).toEqual({ bleed: 4 });
    const quick = built("sword.combo", ["a", "a2", "a2.s"]);
    const d = startWith(quick);
    expect([skillCooldown(d, ally(d), quick, foe(d)), quick.cooldown]).toEqual([0, 1]);
    expect(ally(resolveAllies(startWith(quick), [use(quick, "w1", { judgements: good(4) })], ctx)).cooldowns).toEqual({});
    const e = chained(startWith(quick));
    expect(ally(resolveAllies(e, [use(quick)], ctx)).cooldowns).toEqual({ "sword.combo": 2 });
  });
  it("확실: 좋음 칸 +6, 보완 칸은 마지막 타만 +3 더", () => {
    const sure = built("sword.combo", ["b", "b1", "b1.s"]);
    const b = startWith(sure);
    expect([0, 1, 2].map((i) => skillGoodWidth(b, ally(b), sure, foe(b), i))).toEqual([6, 6, 9]);
    // 타를 따지지 않으면 모든 타에 걸리는 것만
    expect(skillGoodWidth(b, ally(b), sure, foe(b))).toBe(6);
  });
  it("도박: 완벽으로 친 타는 2배, 터뜨리는 피해도 2배. 마지막 타가 빗나가면 출혈이 사라진다", () => {
    const gamble = built("sword.combo", ["b", "b2"]);
    const b = startWith(gamble);
    const [first = 0, , third = 0] = powersOf(b, gamble, "w1", ["좋음", "좋음", "완벽"]);
    expect(third / first).toBeCloseTo(1.3 * 2, 10);
    const run = (judgements: ("좋음" | "완벽" | "빗나감")[]) => {
      const s = startWith(gamble);
      foe(s).effects = { bleed: 4 };
      return resolveAllies(s, [use(gamble, "w1", { judgements })], ctx);
    };
    // 터뜨린 출혈 6(4 + 앞 두 타가 붙인 2): 보통은 6, 마지막 타가 완벽이면 12
    expect(run(["좋음", "좋음", "좋음"]).events.find((e) => e.type === "터뜨림")).toMatchObject({ amount: 6 });
    expect(run(["좋음", "좋음", "완벽"]).events.find((e) => e.type === "터뜨림")).toMatchObject({ amount: 12 });
    const missed = run(["좋음", "좋음", "빗나감"]);
    expect(foe(missed).effects).toEqual({});
    expect(missed.events.find((e) => e.type === "효과 사라짐")).toMatchObject({ effect: "bleed", stacks: 6 });
    expect(missed.events.some((e) => e.type === "터뜨림")).toBe(false);
    // 도박을 찍지 않았으면 빗나가도 출혈은 남는다
    const plain = built("sword.combo", ["b"]);
    const p = startWith(plain);
    foe(p).effects = { bleed: 4 };
    expect(foe(resolveAllies(p, [use(plain, "w1", { judgements: ["좋음", "좋음", "빗나감"] })], ctx)).effects).toEqual({ bleed: 6 });
  });
  it("도박의 보완 칸: 완벽 칸 +2, 좋음 칸을 넘지는 않는다", () => {
    const wide = built("sword.combo", ["b", "b2", "b2.s"]);
    expect(wide.perfectWidth).toBe(2);
    const plain = judgementWidths(rules, 30);
    const more = judgementWidths(rules, 30, { goodWidth: 0, shake: 0, noPerfect: false, perfectWidth: wide.perfectWidth ?? 0 });
    expect(more.perfect - plain.perfect).toBeCloseTo(2, 10);
    expect(judgementWidths(rules, 0, { goodWidth: 0, shake: 0, noPerfect: false, perfectWidth: 99 }).perfect).toBe(16);
    expect(judgementWidths(rules, 0, { goodWidth: 0, shake: 0, noPerfect: true, perfectWidth: 2 }).perfect).toBe(0);
  });
});

describe("끝갈래와 그 보완 칸: 돌진 베기", () => {
  it("연타: 끌려 나온 적도 같은 위력으로 한 번, 보완 칸은 그 타 +10%", () => {
    const two = [dummy("w1", 0), dummy("w2", 3)];
    const both = built("sword.charge", ["a", "a1"]);
    let b = resolveAllies(startWith(both, two), [use(both)], ctx);
    // 14.3 × 1.09 × 1.5 = 23.38 → 23 둘 다
    expect([999 - foe(b, "w1").hp, 999 - foe(b, "w2").hp]).toEqual([23, 23]);
    expect([foe(b, "w1").slot, foe(b, "w2").slot]).toEqual([3, 0]);
    const harder = built("sword.charge", ["a", "a1", "a1.s"]);
    b = resolveAllies(startWith(harder, two), [use(harder)], ctx);
    // 23.38 × 1.1 = 25.7 → 26
    expect(999 - foe(b, "w2").hp).toBe(26);
    // 뒤가 비어 있으면 한 번만
    b = resolveAllies(startWith(both), [use(both)], ctx);
    expect(b.events.filter((e) => e.type === "피해")).toHaveLength(1);
  });
  it("일격: 끝내는 기술, 밀어내지 않고 흐트러짐 ×1.5", () => {
    const strike = built("sword.charge", ["a", "a.s2", "a2"], { "a.s2": 0 });
    expect(strike).toMatchObject({ role: "끝내는", staggerMultiplier: 1.5 });
    expect(strike.push).toBeUndefined();
    const b = resolveAllies(startWith(strike, [dummy("w1", 0), dummy("w2", 3)]), [use(strike)], ctx);
    expect([foe(b, "w1").slot, foe(b, "w1").effects]).toEqual([0, {}]);
  });
  it("일격의 보완 칸: 방패를 든 적에게만 위력 +30%", () => {
    const strike = built("sword.charge", ["a", "a2"]);
    const shieldBreaker = built("sword.charge", ["a", "a2", "a2.s"]);
    const b = startWith(strike, [shield(), dummy("w1", 1)]);
    expect(powersOf(b, shieldBreaker, "s1")[0]! / powersOf(b, strike, "s1")[0]!).toBeCloseTo(1.3, 10);
    expect(powersOf(b, shieldBreaker, "w1")[0]! / powersOf(b, strike, "w1")[0]!).toBeCloseTo(1, 10);
  });
  it("조건: 원거리 적이면 위력 ×2, 보완 칸은 원거리 적을 맞히면 기력 +1", () => {
    const hunt = built("sword.charge", ["b", "b1"]);
    const b = startWith(hunt, [shield(), crossbow()]);
    const plain = built("sword.charge", ["b"]);
    expect(powersOf(b, hunt, "c1")[0]! / powersOf(b, plain, "c1")[0]!).toBeCloseTo(2, 10);
    expect(powersOf(b, hunt, "s1")[0]! / powersOf(b, plain, "s1")[0]!).toBeCloseTo(1, 10);
    const refund = built("sword.charge", ["b", "b1", "b1.s"]);
    const energyAfter = (targetId: string, judgements: ("좋음" | "빗나감")[] = ["좋음"]) =>
      ally(resolveAllies(startWith(refund, [shield(), crossbow()]), [use(refund, targetId, { judgements })], ctx)).energy;
    const full = ctx.table.energy.max;
    expect(energyAfter("s1")).toBe(full - refund.energy);
    expect(energyAfter("c1")).toBe(Math.min(full, full - refund.energy + 1));
    expect(energyAfter("c1", ["빗나감"])).toBe(full - refund.energy);
  });
  it("상시: 뒷줄을 쳐도 위력이 줄지 않는다, 보완 칸은 좋음 칸 +3", () => {
    const always = built("sword.charge", ["b", "b2", "b2.s"]);
    expect(always.reachBack).toEqual({ multiplier: 1 });
    expect(always.goodWidth).toBe(3);
    const b = startWith(always, [shield(), crossbow()]);
    expect(powersOf(b, always, "c1")[0]!).toBeCloseTo(powersOf(b, always, "s1")[0]!, 10);
  });
});

describe("적 카드의 특징", () => {
  it("방패 특징과 원거리 행동을 알아본다", () => {
    const b = createBattle(setup([shield(), crossbow(), wolf("w1", 1)]), ctx);
    expect(b.enemies.map((e) => [e.id, e.traits, e.ranged])).toEqual([
      ["s1", ["방패"], false],
      ["c1", [], true],
      ["w1", [], false],
    ]);
  });
  it("조건이 붙은 기력은 대상을 보고 정한다", () => {
    const s: BattleSkill = { ...skill("sword.cut"), conditionalEnergy: [{ add: -1, when: "대상이 원거리" }], energy: 1 };
    const b = startWith(s, [shield(), crossbow()]);
    expect([skillEnergyCost(b, ally(b), s, foe(b, "s1")), skillEnergyCost(b, ally(b), s, foe(b, "c1"))]).toEqual([1, 0]);
  });
});

describe("끝갈래와 그 보완 칸: 검풍", () => {
  it("끈질김: 턴마다 위력 +10%, 최대 +50%. 보완 칸을 찍으면 최대 +80%", () => {
    const wide = built("sword.gale", ["a"]);
    const long = built("sword.gale", ["a", "a1"]);
    const longer = built("sword.gale", ["a", "a1", "a1.s"]);
    const b = startWith(long, [dummy("w1", 0)]);
    const ratio = (s: BattleSkill, turn: number) => {
      b.turn = turn;
      return powersOf(b, s)[0]! / powersOf(b, wide)[0]!;
    };
    expect([1, 3, 5, 9].map((t) => ratio(long, t))).toEqual([1.1, 1.3, 1.5, 1.5].map((x) => expect.closeTo(x, 10)));
    expect([5, 8, 12].map((t) => ratio(longer, t))).toEqual([1.5, 1.8, 1.8].map((x) => expect.closeTo(x, 10)));
  });
  it("마무리: 하나라도 쓰러뜨리면 쿨다운 절반(내림), 보완 칸은 기력 +1", () => {
    const finish = built("sword.gale", ["a", "a2"]);
    const weak = [wolf("w1", 0, { overrides: { hp: 1, power: 0 } }), dummy("w2", 1)];
    const killed = resolveAllies(startWith(finish, weak), [use(finish, "w2")], ctx);
    // 쿨다운 4 → 2 (턴 끝에 한 번 줄어드는 몫까지 3으로 적힌다)
    expect(ally(killed).cooldowns).toEqual({ "sword.gale": 3 });
    const none = resolveAllies(startWith(finish, [dummy("w1", 0), dummy("w2", 1)]), [use(finish, "w2")], ctx);
    expect(ally(none).cooldowns).toEqual({ "sword.gale": 5 });
    const refund = built("sword.gale", ["a", "a2", "a2.s"]);
    const withKill = ally(resolveAllies(startWith(refund, weak), [use(refund, "w2")], ctx)).energy;
    const withoutKill = ally(resolveAllies(startWith(refund, [dummy("w1", 0), dummy("w2", 1)]), [use(refund, "w2")], ctx)).energy;
    expect(withKill - withoutKill).toBe(1);
  });
  it("빠르게: 쿨다운 −2, 보완 칸은 바로 앞 차례에 친 적을 또 치면 기력 −1", () => {
    const fast = built("sword.gale", ["b", "b1", "b1.s"]);
    expect(fast.cooldown).toBe(2);
    const cut = hero().basicAttack;
    let b = createBattle(setup([dummy("w1", 0), dummy("w2", 1)], [hero({ skills: [fast] })]), ctx);
    b = playTurn(b, { actions: [{ unitId: "hero", type: "기술", skillId: cut.id, targetId: "w1", judgements: good(cut.hitCount) }], defenses: {} }, ctx);
    expect([skillEnergyCost(b, ally(b), fast, foe(b, "w1")), skillEnergyCost(b, ally(b), fast, foe(b, "w2"))]).toEqual([fast.energy - 1, fast.energy]);
    const before = ally(b).energy;
    const after = resolveAllies(b, [use(fast, "w1")], ctx);
    expect(before - ally(after).energy).toBe(fast.energy - 1);
    // 한 턴을 쉬면 연속이 아니다
    const rested = playTurn(b, { actions: [rest], defenses: {} }, ctx);
    expect(skillEnergyCost(rested, ally(rested), fast, foe(rested, "w1"))).toBe(fast.energy);
  });
  it("무겁게: 흐트러진 적에게 위력 ×2, 보완 칸은 그때 좋음 칸 +6", () => {
    const deep = built("sword.gale", ["b"]);
    const heavy = built("sword.gale", ["b", "b2", "b2.s"]);
    const b = startWith(heavy);
    expect(powersOf(b, heavy)[0]! / powersOf(b, deep)[0]!).toBeCloseTo(1, 10);
    expect(skillGoodWidth(b, ally(b), heavy, foe(b))).toBe(0);
    foe(b).brokenOnTurn = b.turn;
    expect(powersOf(b, heavy)[0]! / powersOf(b, deep)[0]!).toBeCloseTo(2, 10);
    expect(skillGoodWidth(b, ally(b), heavy, foe(b))).toBe(6);
  });
  it("칼등: 피해는 ×0.3, 흐트러짐은 2배, 쓰러뜨린 적은 생포", () => {
    const deep = built("sword.gale", ["b"]);
    const back = built("sword.gale", ["b", "b.x"]);
    const tough = () => [dummy("w1", 0, { overrides: { hp: 999, power: 0, stagger: 100 } })];
    const hit = (s: BattleSkill) => resolveAllies(startWith(s, tough()), [use(s)], ctx);
    // 30.9 → 31, 30.9 × 0.3 = 9.27 → 9
    expect([999 - foe(hit(deep)).hp, 999 - foe(hit(back)).hp]).toEqual([31, 9]);
    expect((100 - foe(hit(back)).stagger) / (100 - foe(hit(deep)).stagger)).toBeCloseTo(2, 10);
    const weak = [wolf("w1", 0, { overrides: { hp: 5, power: 0 } })];
    const caught = resolveAllies(startWith(back, weak), [use(back)], ctx);
    expect(foe(caught)).toMatchObject({ down: true, captured: { by: "hero", rewardBonus: 0 } });
    expect(caught.events.find((e) => e.type === "생포")).toMatchObject({ unit: "w1", by: "hero" });
    const bounty = built("sword.gale", ["b", "b.x", "b.x.s"]);
    expect(foe(resolveAllies(startWith(bounty, weak), [use(bounty)], ctx)).captured).toEqual({ by: "hero", rewardBonus: 0.5 });
    // 칼등이 아니면 생포하지 않는다
    expect(foe(resolveAllies(startWith(deep, weak), [use(deep)], ctx)).captured).toBeUndefined();
  });
});

describe("끝갈래와 그 보완 칸: 되받아치기", () => {
  const parry = { "w1>hero": "받아치기 성공" as const };
  const tough = () => [wolf("w1", 0, { overrides: { hp: 999 } })];
  it("나: 받아치면 집중 2, 보완 칸은 집중 최대 +2", () => {
    const me = built("sword.riposte", ["a", "a1"]);
    expect(ally(playTurn(startWith(me, tough()), { actions: [use(me)], defenses: parry }, ctx)).effects).toEqual({ focus: 2 });
    expect(ally(playTurn(startWith(me, tough()), { actions: [use(me)], defenses: {} }, ctx)).effects).toEqual({});
    const full = (s: BattleSkill) => {
      const b = startWith(s, tough());
      ally(b).effects = { focus: 5 };
      return ally(playTurn(b, { actions: [use(s)], defenses: parry }, ctx)).effects;
    };
    // 자세 기술을 쓸 때 집중이 1 줄고(5 → 4), 받아치면 2가 붙는다
    expect(full(me)).toEqual({ focus: 5 });
    expect(full(built("sword.riposte", ["a", "a1", "a1.s"]))).toEqual({ focus: 6 });
  });
  it("동료: 같은 줄 바로 옆 동료를 노린 공격을 대신 받는다, 보완 칸은 그 피해 ×0.9", () => {
    const run = (s: BattleSkill, mateSlot: number, defenses = {}) => {
      const mate = hero({ id: "mate", name: "시험 동료", kind: "동료", slot: mateSlot, skills: [] });
      let b = createBattle(setup([wolf("w1", 0, { overrides: { hp: 999 } })], [hero({ skills: [s] }), mate]), ctx);
      b.intents[0]!.targetId = "mate";
      b = playTurn(b, { actions: [use(s), { unitId: "mate", type: "쉬기" }], defenses }, ctx);
      return { hero: ally(b).hp, mate: b.allies[1]!.hp, state: b };
    };
    const cover = built("sword.riposte", ["a", "a2"]);
    expect(run(cover, 1)).toMatchObject({ hero: 55 - 7, mate: 55 });
    expect(run(cover, 1).state.events.find((e) => e.type === "대신 받음")).toMatchObject({ ally: "hero", for: "mate" });
    // 같은 줄이라도 바로 옆 칸이 아니면(0과 2) 대신 받지 않는다
    expect(run(cover, 2)).toMatchObject({ hero: 55, mate: 55 - 7 });
    // 대신 받은 공격도 받아칠 수 있다
    expect(run(cover, 1, parry)).toMatchObject({ hero: 55, mate: 55 });
    // 7 × 0.9 = 6.3 → 6
    expect(run(built("sword.riposte", ["a", "a2", "a2.s"]), 1)).toMatchObject({ hero: 55 - 6, mate: 55 });
  });
  it("깎기: 자세 찌르기가 맞으면 취약 1, 보완 칸은 취약 2", () => {
    const cut = built("sword.riposte", ["b", "b1"]);
    expect(foe(resolveAllies(startWith(cut), [use(cut)], ctx)).effects).toEqual({ fragile: 1 });
    const deeper = built("sword.riposte", ["b", "b1", "b1.s"]);
    expect(foe(resolveAllies(startWith(deeper), [use(deeper)], ctx)).effects).toEqual({ fragile: 2 });
  });
  it("키우기: 자세를 잡은 턴의 끝마다 자신감 1, 보완 칸은 2", () => {
    const grow = built("sword.riposte", ["b", "b2"]);
    let b = playTurn(startWith(grow), { actions: [use(grow)], defenses: {} }, ctx);
    expect(ally(b).effects).toEqual({ confidence: 1 });
    // 자세가 풀린 턴에는 쌓이지 않는다
    b = playTurn(b, { actions: [rest], defenses: {} }, ctx);
    expect(ally(b).effects).toEqual({ confidence: 1 });
    const more = built("sword.riposte", ["b", "b2", "b2.s"]);
    expect(ally(playTurn(startWith(more), { actions: [use(more)], defenses: {} }, ctx)).effects).toEqual({ confidence: 2 });
  });
});

describe("궁극기", () => {
  it("궁극기와 그 루트를 끝까지 찍어야 들 수 있고, 숫자는 기준표에서", () => {
    const gust = ultimate("sword.gale.b1.u");
    // 궁극기 24 × 약함 0.75, 쿨다운 5 − 3, 기력 5, 역할 끝내는
    expect(gust).toMatchObject({ baseHitPower: 18, cooldown: 2, energy: 5, role: "끝내는", tier: "궁극기", hitCount: 1 });
    const route = ["sword.gale", "sword.gale.s1", "sword.gale.s2", "sword.gale.b", "sword.gale.b.s1", "sword.gale.b.s2", "sword.gale.b1", "sword.gale.b1.s", "sword.gale.b1.u"];
    const build = (picked: string[], id = "sword.gale.b1.u") => buildUltimate(table, [], rules.words, swordTree, id, new Set(picked), "근접");
    expect(build(route)).toEqual(gust);
    expect(() => build(route.filter((id) => id !== "sword.gale.b.s1"))).toThrow("루트를 끝까지 찍지 않았다 (sword.gale.b.s1)");
    expect(() => build(route, "sword.gale.b1")).toThrow("궁극기가 아니다");
    // 아직 기술 항목이 없는 궁극기(다음 단위)
    expect(() => ultimate("sword.combo.a1.u")).toThrow("아직 기술 항목이 없는");
  });
  it("든 궁극기는 다른 기술처럼 쓰고, 자동 전투도 고른다", () => {
    const gust = ultimate("sword.gale.b1.u");
    let b = createBattle(setup([dummy()], [hero({ skills: [], ultimate: gust })]), ctx);
    expect(autoAllyActions(b, ctx)[0]).toMatchObject({ type: "기술", skillId: "sword.gale.b1.u" });
    b = resolveAllies(b, [use(gust)], ctx);
    expect(ally(b).cooldowns).toEqual({ "sword.gale.b1.u": 3 });
    expect(ally(b).energy).toBe(ctx.table.energy.max - 5);
  });
  it("피의 결산: 맞은 적 모두의 출혈을 터뜨린다", () => {
    const reckoning = ultimate("sword.combo.b1.u");
    const b = createBattle(setup([dummy("w1", 0), dummy("w2", 1), dummy("w3", 2)], [hero({ skills: [], ultimate: reckoning })]), ctx);
    foe(b, "w1").effects = { bleed: 4 };
    foe(b, "w2").effects = { bleed: 2 };
    const after = resolveAllies(b, [use(reckoning)], ctx);
    expect(after.events.filter((e) => e.type === "터뜨림").map((e) => e.type === "터뜨림" && [e.to, e.stacks])).toEqual([
      ["w1", 4],
      ["w2", 2],
    ]);
    expect(after.enemies.map((e) => e.effects)).toEqual([{}, {}, {}]);
  });
  it("단 한 번의 매듭: 바늘 칸, 완벽이면 출혈 ×3 피해와 바로 흐트러짐, 빗나가면 내가 출혈 3", () => {
    const knot = ultimate("sword.combo.b2.u");
    expect(knot.goodWidth).toBe(-12);
    const run = (judgement: "좋음" | "완벽" | "빗나감") => {
      const b = createBattle(setup([dummy("w1", 0, { overrides: { hp: 999, power: 0, stagger: 100 } })], [hero({ skills: [], ultimate: knot })]), ctx);
      foe(b).effects = { bleed: 4 };
      return resolveAllies(b, [use(knot, "w1", { judgements: [judgement] })], ctx);
    };
    const plain = run("좋음");
    expect(foe(plain)).toMatchObject({ effects: { bleed: 4 }, brokenOnTurn: null });
    const perfect = run("완벽");
    expect(perfect.events.find((e) => e.type === "터뜨림")).toMatchObject({ stacks: 4, amount: 12 });
    expect(foe(perfect).brokenOnTurn).toBe(1);
    const missed = run("빗나감");
    expect(ally(missed).effects).toEqual({ bleed: 3 });
    expect(foe(missed).effects).toEqual({ bleed: 4 });
  });
  it("산 가르기: 흐트러진 적만 고를 수 있고, 위력 ×1.5, 뒤 칸도 맞는다", () => {
    const split = ultimate("sword.gale.b2.u");
    const b = createBattle(setup([dummy("w1", 0), dummy("w2", 1), dummy("w3", 3)], [hero({ skills: [], ultimate: split })]), ctx);
    expect(skillTargets(b, ally(b), split)).toEqual([]);
    expect(() => resolveAllies(b, [use(split)], ctx)).toThrow("닿지 않는다");
    foe(b, "w1").brokenOnTurn = 1;
    expect(skillTargets(b, ally(b), split).map((e) => e.id)).toEqual(["w1"]);
    const after = resolveAllies(b, [use(split)], ctx);
    // 궁극기 24 × 강함 1.3 × 아주 큰 위력 1.5
    expect(split.baseHitPower).toBeCloseTo(24 * 1.3 * 1.5, 10);
    expect([999 - foe(after, "w1").hp > 0, 999 - foe(after, "w2").hp, 999 - foe(after, "w3").hp > 0]).toEqual([true, 0, true]);
    // 자동 전투도 흐트러진 적이 없으면 고르지 않는다
    const none = createBattle(setup([dummy("w1", 0)], [hero({ skills: [], ultimate: split })]), ctx);
    expect(autoAllyActions(none, ctx)[0]).toMatchObject({ skillId: "sword.cut" });
  });
  it("역날의 마음: 모두를 칼등으로 치고, 체력이 30% 이하로 남은 적을 생포한다", () => {
    const mercy = ultimate("sword.gale.b.x.u");
    const tough = (id: string, slot: number) => wolf(id, slot, { overrides: { hp: 40, power: 0, stagger: 9999 } });
    const b = createBattle(setup([tough("w1", 0), tough("w2", 1)], [hero({ skills: [], ultimate: mercy })]), ctx);
    foe(b, "w1").hp = 10;
    const after = resolveAllies(b, [use(mercy)], ctx);
    // 고른 적 24 × 0.8 × 1.09 × 1.5 × 0.3 = 9.4 → 9: w1은 1이 남아 생포.
    // 나머지는 전체 공격의 기준값대로 절반 4.7 → 5: w2는 35로 12를 넘는다
    expect(foe(after, "w1")).toMatchObject({ down: true, captured: { by: "hero", rewardBonus: 0 } });
    expect(foe(after, "w2")).toMatchObject({ down: false, hp: 35 });
    expect(foe(after, "w2").captured).toBeUndefined();
  });
  it("명경지수: 자세가 3턴, 넓은 받아치기 칸, 받아칠 때마다 집중 2", () => {
    const calm = ultimate("sword.riposte.a1.u");
    expect(calm.stanceOpts).toMatchObject({ holdTurns: 2, parryWidth: 6 });
    const parry = { "w1>hero": "받아치기 성공" as const };
    let b = createBattle(setup([wolf("w1", 0, { overrides: { hp: 999 } })], [hero({ skills: [], ultimate: calm })]), ctx);
    b = playTurn(b, { actions: [use(calm)], defenses: parry }, ctx);
    expect(ally(b).effects).toEqual({ focus: 2 });
    b = playTurn(b, { actions: [rest], defenses: parry }, ctx);
    expect(ally(b).effects).toEqual({ focus: 4 });
    b = playTurn(b, { actions: [rest], defenses: parry }, ctx);
    // 집중은 5에서 멈추고, 셋째 턴 끝에 자세가 풀린다
    expect(ally(b).effects).toEqual({ focus: 5 });
    expect(ally(b).stance).toBeUndefined();
  });
  it("성벽 부수기: 방어를 무시하고, 맞히면 남은 흐트러짐을 절반으로", () => {
    const breaker = ultimate("sword.charge.a2.u");
    const run = (s: BattleSkill) => resolveAllies(createBattle(setup([shield()], [hero({ skills: [], ultimate: s })]), ctx), [use(s, "s1")], ctx);
    const plain = { ...breaker, ignoreDefense: false, halveStagger: false };
    // 24 × 1.3 × 1.09 × 0.5(자상 강함) = 17.0: 방어 2를 빼면 15, 무시하면 17
    expect([999 - foe(run(plain), "s1").hp, 999 - foe(run(breaker), "s1").hp]).toEqual([15, 17]);
    const left = foe(run(plain), "s1").stagger;
    expect(foe(run(breaker), "s1").stagger).toBeCloseTo(left / 2, 10);
  });
  it("천적사냥: 앞줄이 서 있어도 뒷줄 전원을 같은 위력으로", () => {
    const hunt = ultimate("sword.charge.b1.u");
    const b = createBattle(setup([shield("s1", 0), crossbow("c1", 3), crossbow("c2", 4)], [hero({ skills: [], ultimate: hunt })]), ctx);
    expect(skillTargets(b, ally(b), hunt).map((e) => e.id)).toEqual(["c1", "c2"]);
    const after = resolveAllies(b, [use(hunt, "c2")], ctx);
    const damage = (id: string) => 999 - foe(after, id).hp;
    expect(damage("c1")).toBeGreaterThan(0);
    expect([damage("c1"), damage("s1")]).toEqual([damage("c2"), 0]);
  });
  it("꿰뚫는 돌격: 고른 앞줄 적과 그 뒤 칸을 같은 위력으로", () => {
    const lance = ultimate("sword.charge.b2.u");
    const after = resolveAllies(createBattle(setup([dummy("w1", 0), dummy("w2", 3), dummy("w3", 1)], [hero({ skills: [], ultimate: lance })]), ctx), [use(lance)], ctx);
    const damage = (id: string) => 999 - foe(after, id).hp;
    expect(damage("w1")).toBeGreaterThan(0);
    expect([damage("w2"), damage("w3")]).toEqual([damage("w1"), 0]);
  });
});
