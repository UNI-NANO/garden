import { describe, expect, it } from "vitest";
import { buildSkill, BuildSkillError, resolveAmount } from "../src/rules/battle/build-skill";
import {
  createBattle,
  playTurn,
  resolveAllies,
  resolveEnemies,
  skillGoodWidth,
  type AllyAction,
  type BattleSkill,
  type BattleState,
} from "../src/rules/battle/engine";
import { built, ctx, enemyDef, hero, rules, setup, skill, swordTree, table } from "./helpers/fake-battle";

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
