import { describe, expect, it } from "vitest";
import { autoAllyActions, autoDefenses } from "../src/rules/battle/auto";
import {
  BattleError,
  canUseSkill,
  createBattle,
  defenseKey,
  playTurn,
  replayBattle,
  resolveAllies,
  resolveEnemies,
  type AllyAction,
  type BattleState,
  type TurnInput,
} from "../src/rules/battle/engine";
import { hitPower, masteryMultiplier } from "../src/rules/battle/numbers";
import { ctx, enemyDef, hero, rules, setup, skill, table } from "./helpers/fake-battle";

const wolf = (id = "w1", slot = 0, over = {}) => ({ id, def: enemyDef("wolf", over), slot });
const good = (n = 1) => Array.from({ length: n }, () => "좋음" as const);
type SkillAction = Extract<AllyAction, { type: "기술" }>;
const use = (skillId: string, targetId: string, over: Partial<SkillAction> = {}): SkillAction => ({
  unitId: "hero",
  type: "기술",
  skillId,
  targetId,
  judgements: good(skill(skillId).hitCount),
  ...over,
});
const rest: AllyAction = { unitId: "hero", type: "쉬기" };
const ally = (s: BattleState, id = "hero") => s.allies.find((a) => a.id === id)!;
const foe = (s: BattleState, id = "w1") => s.enemies.find((e) => e.id === id)!;
const start = (...args: Parameters<typeof setup>) => createBattle(setup(...args), ctx);
/** 쉬면서 n턴을 보낸다 */
const wait = (s: BattleState, n: number, defenses = {}) => {
  for (let i = 0; i < n && s.outcome === undefined; i++) s = playTurn(s, { actions: [rest], defenses }, ctx);
  return s;
};
const CUT = hitPower(table, skill("sword.cut").baseHitPower, "좋음", masteryMultiplier(rules, 30));

describe("전투 시작", () => {
  it("체력과 기력이 가득 차고, 적의 의도가 공개된다", () => {
    const s = start([wolf()]);
    expect(ally(s)).toMatchObject({ hp: 55, maxHp: 55, energy: 10, down: false });
    expect(foe(s)).toMatchObject({ hp: 28, stagger: 13, power: 7 });
    expect(s).toMatchObject({ turn: 1, phase: "아군 차례" });
    expect(s.intents).toHaveLength(1);
    expect(s.intents[0]).toMatchObject({ enemyId: "w1", targetId: "hero", power: 7, cancelled: false });
  });
  it("잘못된 편성은 거부한다", () => {
    expect(() => start([wolf("w1", 0), wolf("w2", 0)])).toThrow(BattleError);
    expect(() => start([wolf("w1", 9)])).toThrow(BattleError);
    expect(() => start([])).toThrow(BattleError);
    expect(() => start([wolf()], [hero({ kind: "동료" })])).toThrow(BattleError);
    expect(() => start([wolf("hero")])).toThrow(BattleError);
  });
});

describe("한 턴", () => {
  it("아군 차례 → 적 차례 → 턴 끝", () => {
    let s = start([wolf()]);
    s = resolveAllies(s, [use("sword.cut", "w1")], ctx);
    // 베기 6.54 × 자상에 약함 1.5 = 9.81 → 10
    expect(foe(s).hp).toBe(18);
    expect(s.phase).toBe("적 차례");
    s = resolveEnemies(s, {}, ctx);
    expect(ally(s).hp).toBe(48);
    expect(s).toMatchObject({ turn: 2, phase: "아군 차례" });
    expect(s.intents).toHaveLength(1);
  });
  it("원래 상태를 고치지 않는다", () => {
    const s = start([wolf()]);
    const copy = structuredClone(s);
    playTurn(s, { actions: [use("sword.cut", "w1")], defenses: {} }, ctx);
    expect(s).toEqual(copy);
  });
  it("차례가 아니면 거부한다", () => {
    const s = start([wolf()]);
    expect(() => resolveEnemies(s, {}, ctx)).toThrow(BattleError);
    expect(() => resolveAllies(resolveAllies(s, [rest], ctx), [rest], ctx)).toThrow(BattleError);
  });
  it("판정에 따라 피해가 달라지고, 빗나가면 0", () => {
    const hit = (judgement: "빗나감" | "보통" | "좋음" | "완벽") => 28 - foe(resolveAllies(start([wolf()]), [use("sword.cut", "w1", { judgements: [judgement] })], ctx)).hp;
    expect([hit("빗나감"), hit("보통"), hit("좋음"), hit("완벽")]).toEqual([0, 7, 10, 13]);
  });
  it("타수가 틀리거나, 한 턴에 두 번 움직이거나, 없는 기술·대상이면 거부한다", () => {
    const s = start([wolf()]);
    expect(() => resolveAllies(s, [use("sword.combo", "w1", { judgements: good(2) })], ctx)).toThrow(/3타/);
    expect(() => resolveAllies(s, [rest, rest], ctx)).toThrow(/한 번만/);
    expect(() => resolveAllies(s, [use("sword.cut", "nope")], ctx)).toThrow(BattleError);
    expect(() => resolveAllies(s, [{ ...use("sword.cut", "w1"), skillId: "nope" }], ctx)).toThrow(BattleError);
  });
});

describe("쿨다운과 기력", () => {
  it("기술을 쓰면 기력이 줄고 턴 끝에 2씩 찬다 (최대 10)", () => {
    let s = start([wolf("w1", 0, { overrides: { hp: 999 } })]);
    s = resolveAllies(s, [use("sword.gale", "w1")], ctx);
    expect(ally(s).energy).toBe(7);
    s = resolveEnemies(s, {}, ctx);
    expect(ally(s).energy).toBe(9);
    expect(ally(wait(s, 1)).energy).toBe(10);
  });
  it("쿨다운 3이면 쓴 뒤 세 턴을 쉰다", () => {
    let s = start([wolf("w1", 0, { overrides: { hp: 999, power: 0 } })]);
    const charge = skill("sword.charge");
    expect(charge.cooldown).toBe(3);
    s = playTurn(s, { actions: [use("sword.charge", "w1")], defenses: {} }, ctx);
    const usable: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      usable.push(canUseSkill(ally(s), charge));
      s = wait(s, 1);
    }
    // 2·3·4턴은 쉬고 5턴에 다시
    expect(usable).toEqual([false, false, false, true]);
  });
  it("쿨다운 중이거나 기력이 모자란 기술은 고를 수 없다", () => {
    let s = start([wolf("w1", 0, { overrides: { hp: 999, power: 0 } })]);
    s = playTurn(s, { actions: [use("sword.charge", "w1")], defenses: {} }, ctx);
    expect(() => resolveAllies(s, [use("sword.charge", "w1")], ctx)).toThrow(/쿨다운/);
    ally(s).energy = 2;
    expect(() => resolveAllies(s, [use("sword.gale", "w1")], ctx)).toThrow(/기력/);
  });
  it("기본 공격은 쿨다운도 기력도 없다", () => {
    let s = start([wolf("w1", 0, { overrides: { hp: 999, power: 0 } })]);
    ally(s).energy = 0;
    for (let i = 0; i < 3; i++) s = playTurn(s, { actions: [use("sword.cut", "w1")], defenses: {} }, ctx);
    expect(foe(s).hp).toBe(999 - 30);
  });
});

describe("합", () => {
  it("내 위력이 크면 적 기술이 취소되고, 내 기술은 그대로 들어가며 흐트러짐이 더 깎인다", () => {
    let s = start([wolf()]);
    s = resolveAllies(s, [use("sword.charge", "w1", { clash: true })], ctx);
    expect(s.intents[0]?.cancelled).toBe(true);
    expect(foe(s).hp).toBe(28 - 23);
    // 흐트러짐 13: 돌진 베기 15.587 × 0.8 = 12.47 에 합의 차이 8.587이 더해져 무너진다
    expect(foe(s).brokenOnTurn).toBe(1);
    s = resolveEnemies(s, {}, ctx);
    expect(ally(s).hp).toBe(55);
  });
  it("적 위력이 크면 내 기술이 취소되고, 적 기술은 내 위력만큼 줄어서 들어온다", () => {
    let s = start([wolf()]);
    s = resolveAllies(s, [use("sword.cut", "w1", { clash: true })], ctx);
    expect(foe(s).hp).toBe(28);
    expect(s.intents[0]?.cancelled).toBe(false);
    expect(s.intents[0]?.power).toBeCloseTo(7 - CUT, 10);
    s = resolveEnemies(s, {}, ctx);
    // 남은 위력 0.46 → 맞으면 최소 1
    expect(ally(s).hp).toBe(54);
  });
  it("같으면 둘 다 취소", () => {
    let s = start([wolf("w1", 0, { overrides: { power: CUT } })]);
    s = resolveAllies(s, [use("sword.cut", "w1", { clash: true })], ctx);
    expect(foe(s).hp).toBe(28);
    expect(s.intents[0]?.cancelled).toBe(true);
    expect(ally(resolveEnemies(s, {}, ctx)).hp).toBe(55);
    expect(s.events.filter((e) => e.type === "합")).toMatchObject([{ result: "비김" }]);
  });
  it("합을 걸지 않으면 그냥 공격이다", () => {
    let s = start([wolf()]);
    s = resolveAllies(s, [use("sword.cut", "w1")], ctx);
    expect(foe(s).hp).toBe(18);
    expect(ally(resolveEnemies(s, {}, ctx)).hp).toBe(48);
  });
});

describe("흐트러짐", () => {
  it("게이지가 0이 되면 그 턴의 공격이 끊기고, 다음 턴에도 움직이지 못하며, 피해를 1.5배 받는다", () => {
    let s = start([wolf("w1", 0, { overrides: { hp: 999, stagger: 13 } })]);
    // 1턴: 돌진 베기(12.47) → 남은 게이지 0.53
    s = playTurn(s, { actions: [use("sword.charge", "w1")], defenses: {} }, ctx);
    expect(foe(s).brokenOnTurn).toBeNull();
    expect(foe(s).stagger).toBeCloseTo(13 - 14.3 * 1.09 * 0.8, 6);
    // 2턴: 베기로 무너뜨린다. 무너지는 순간 이번 턴에 하려던 공격도 끊긴다
    expect(s.intents[0]?.cancelled).toBe(false);
    s = resolveAllies(s, [use("sword.cut", "w1")], ctx);
    expect(foe(s)).toMatchObject({ brokenOnTurn: 2, stagger: 0 });
    expect(s.intents[0]?.cancelled).toBe(true);
    const hpBefore = ally(s).hp;
    s = resolveEnemies(s, {}, ctx);
    expect(ally(s).hp).toBe(hpBefore);
    // 3턴: 의도가 없고, 받는 피해 1.5배 (9.81 × 1.5 = 14.7 → 15)
    expect(s.turn).toBe(3);
    expect(s.intents).toEqual([]);
    const before = foe(s).hp;
    s = resolveAllies(s, [use("sword.cut", "w1")], ctx);
    expect(before - foe(s).hp).toBe(15);
    s = resolveEnemies(s, {}, ctx);
    // 4턴: 게이지가 다시 차고 의도가 돌아온다
    expect(foe(s)).toMatchObject({ brokenOnTurn: null, stagger: foe(s).maxStagger });
    expect(s.intents).toHaveLength(1);
  });
  it("파열은 흐트러짐을 더 깎고 자상은 덜 깎는다", () => {
    const s = start([wolf("w1", 0, { overrides: { hp: 999, stagger: 100 } })]);
    const after = resolveAllies(s, [use("sword.cut", "w1")], ctx);
    expect(100 - foe(after).stagger).toBeCloseTo(CUT * 0.8, 10);
  });
});

describe("진형과 범위", () => {
  it("휩쓸기: 고른 적은 온전히, 양옆은 60%. 타이밍 결과 한 번이 모두에게", () => {
    let s = start([wolf("w1", 0), wolf("w2", 1), wolf("w3", 2)]);
    s = resolveAllies(s, [use("sword.gale", "w2")], ctx);
    // 검풍 14.715 × 1.5 = 22.07 → 22, 나머지 8.829 × 1.5 = 13.24 → 13
    expect([foe(s, "w1").hp, foe(s, "w2").hp, foe(s, "w3").hp]).toEqual([15, 6, 15]);
    // 흐트러짐은 나머지에게 절반
    expect(13 - foe(s, "w1").stagger).toBeCloseTo(14.715 * 0.6 * 0.8 * 0.5, 6);
  });
  it("근접 기술은 앞줄만 칠 수 있고, 앞줄이 비면 뒷줄에 닿는다", () => {
    const shield = { id: "s1", def: enemyDef("deserter.shield", { overrides: { hp: 1 } }), slot: 0 };
    const crossbow = { id: "c1", def: enemyDef("deserter.crossbow"), slot: 3 };
    let s = start([shield, crossbow]);
    expect(() => resolveAllies(s, [use("sword.cut", "c1")], ctx)).toThrow(/닿지 않는다/);
    s = playTurn(s, { actions: [use("sword.cut", "s1")], defenses: {} }, ctx);
    expect(foe(s, "s1").down).toBe(true);
    s = resolveAllies(s, [use("sword.cut", "c1")], ctx);
    expect(foe(s, "c1").hp).toBeLessThan(40);
  });
  it("자상에 강하고 방어가 있는 적에게 베기는 거의 들어가지 않는다", () => {
    const s = resolveAllies(start([{ id: "s1", def: enemyDef("deserter.shield"), slot: 0 }]), [use("sword.cut", "s1")], ctx);
    // 6.54 × 0.5 − 2 = 1.27 → 1
    expect(foe(s, "s1").hp).toBe(39);
  });
  it("원거리 적은 뒷줄에서도 쏜다. 근접 적은 앞줄을 친다", () => {
    const mate = hero({ id: "mate", name: "동료", kind: "동료", slot: 3, skills: [] });
    let s = start([{ id: "c1", def: enemyDef("deserter.crossbow"), slot: 3 }], [hero(), mate]);
    expect(s.intents[0]).toMatchObject({ reach: "원거리", targetId: "hero" });
    s = playTurn(s, { actions: [rest], defenses: {} }, ctx);
    expect(ally(s).hp).toBe(45);
  });
  it("자리 옮기기: 기력 1을 쓰고, 뒷줄에서는 근접 기술을 못 쓴다", () => {
    let s = start([wolf()]);
    s = resolveAllies(s, [{ unitId: "hero", type: "자리 옮기기", slot: 4 }], ctx);
    expect(ally(s)).toMatchObject({ slot: 4, energy: 9 });
    s = resolveEnemies(s, {}, ctx);
    // 앞줄이 비었으므로 뒷줄이 맞는다
    expect(ally(s).hp).toBe(48);
    expect(() => resolveAllies(s, [use("sword.cut", "w1")], ctx)).toThrow(/뒷줄/);
    expect(() => resolveAllies(s, [{ unitId: "hero", type: "자리 옮기기", slot: 4 }], ctx)).toThrow(/이미/);
  });
  it("앞사람이 쓰러뜨린 적을 노린 기술은 닿는 다음 적에게 간다", () => {
    const mate = hero({ id: "mate", name: "동료", kind: "동료", slot: 1, skills: [] });
    let s = start([wolf("w1", 0, { overrides: { hp: 5 } }), wolf("w2", 1)], [hero(), mate]);
    s = resolveAllies(s, [use("sword.cut", "w1"), { ...use("sword.cut", "w1"), unitId: "mate" }], ctx);
    expect(foe(s, "w1").down).toBe(true);
    expect(foe(s, "w2").hp).toBe(18);
  });
});

describe("적 차례의 반응", () => {
  const key = defenseKey("w1", "hero");
  it("막기: 피해 절반, 기력 +1", () => {
    let s = start([wolf()]);
    ally(s).energy = 5;
    s = playTurn(s, { actions: [rest], defenses: { [key]: "막기 성공" } }, ctx);
    // 7 × 0.5 = 3.5 → 4
    expect(ally(s)).toMatchObject({ hp: 51, energy: 8 });
  });
  it("받아치기: 피해 없이 기본 공격으로 반격하고 흐트러짐을 두 배로 깎는다", () => {
    const s = playTurn(start([wolf()]), { actions: [rest], defenses: { [key]: "받아치기 성공" } }, ctx);
    expect(ally(s).hp).toBe(55);
    expect(foe(s).hp).toBe(18);
    expect(13 - foe(s).stagger).toBeCloseTo(CUT * 0.8 * 2, 10);
  });
  it("되받아치기 자세를 잡으면 그 기술의 위력으로 반격한다", () => {
    let s = start([wolf()]);
    s = resolveAllies(s, [use("sword.riposte", "w1", { judgements: [] })], ctx);
    expect(ally(s)).toMatchObject({ energy: 8 });
    expect(foe(s).hp).toBe(28);
    s = resolveEnemies(s, { [key]: "받아치기 성공" }, ctx);
    // 11 × 1.09 × 1.5 = 17.99 → 18
    expect(foe(s).hp).toBe(10);
    expect(ally(s).stance).toBeUndefined();
  });
  it("피하기는 큰 공격에만 통한다", () => {
    const dodge = { actions: [rest], defenses: { [key]: "피하기 성공" as const } };
    expect(ally(playTurn(start([wolf()]), dodge, ctx)).hp).toBe(48);
    const big = enemyDef("wolf");
    big.actions = [{ name: "큰 공격", damageType: "파열", reach: "근접", range: "단일", big: true, weight: 1 }];
    expect(ally(playTurn(start([{ id: "w1", def: big, slot: 0 }]), dodge, ctx)).hp).toBe(55);
  });
});

describe("끝", () => {
  it("적이 모두 쓰러지면 승리, 그 뒤로는 움직이지 않는다", () => {
    let s = start([wolf("w1", 0, { overrides: { hp: 5 } })]);
    s = playTurn(s, { actions: [use("sword.cut", "w1")], defenses: {} }, ctx);
    expect(s).toMatchObject({ outcome: "승리", phase: "끝", turn: 1 });
    expect(foe(s).hp).toBe(0);
    expect(ally(s).hp).toBe(55);
    expect(() => resolveAllies(s, [rest], ctx)).toThrow(BattleError);
  });
  it("플레이어가 모두 쓰러지면 패배. 동료가 서 있어도 마찬가지", () => {
    const mate = hero({ id: "mate", name: "동료", kind: "동료", slot: 1, skills: [] });
    let s = start([wolf("w1", 0, { overrides: { power: 60 }, targeting: "앞줄" })], [hero(), mate]);
    s = playTurn(s, { actions: [rest], defenses: {} }, ctx);
    expect(s.outcome).toBe("패배");
    expect(ally(s)).toMatchObject({ hp: 0, down: true });
    expect(ally(s, "mate").down).toBe(false);
  });
  it("부상: 한 방에 최대 체력의 30% 이상 맞고 쓰러지면 중상, 아니면 경상", () => {
    const weak = hero({ health: 0 });
    // 체력 30. 7씩 다섯 번 → 마지막 한 방은 7 (< 9) → 경상
    const light = wait(start([wolf()], [weak]), 9);
    expect(light.outcome).toBe("패배");
    expect(ally(light).injury).toBe("경상");
    // 한 방에 9 이상 → 중상
    const heavy = wait(start([wolf("w1", 0, { overrides: { power: 9 } })], [weak]), 9);
    expect(ally(heavy).injury).toBe("중상");
    const border = wait(start([wolf("w1", 0, { overrides: { power: 8.4 } })], [weak]), 9);
    expect(ally(border).injury).toBe("경상");
  });
  it("부상: 보스의 광역기에 쓰러지면 한 방이 약해도 중상", () => {
    const boss = enemyDef("wolf", { rank: "보스", overrides: { power: 5 } });
    boss.actions = [{ name: "휩쓸기", damageType: "파열", reach: "근접", range: "전체", weight: 1 }];
    const s = wait(start([{ id: "w1", def: boss, slot: 0 }], [hero({ health: 0 })], { kind: "보스" }), 9);
    expect(ally(s).injury).toBe("중상");
    // 보스라도 단일 공격이면 경상
    const single = enemyDef("wolf", { rank: "보스", overrides: { power: 5 } });
    expect(ally(wait(start([{ id: "w1", def: single, slot: 0 }], [hero({ health: 0 })], { kind: "보스" }), 9)).injury).toBe("경상");
  });
  it("도망: 일반 전투에서 그 턴의 적 차례를 버티면 빠져나간다", () => {
    const flee: AllyAction = { unitId: "hero", type: "도망" };
    const s = playTurn(start([wolf()]), { actions: [flee], defenses: {} }, ctx);
    expect(s.outcome).toBe("도망");
    expect(ally(s)).toMatchObject({ hp: 48, fled: true });
    // 버티지 못하면 패배
    expect(playTurn(start([wolf("w1", 0, { overrides: { power: 99 } })]), { actions: [flee], defenses: {} }, ctx).outcome).toBe("패배");
    // 정예·보스·레이드에서는 도망칠 수 없다
    expect(() => resolveAllies(start([wolf()], undefined, { kind: "보스" }), [flee], ctx)).toThrow(/도망/);
  });
});

describe("적이 노리는 대상", () => {
  const mate = (over = {}) => hero({ id: "mate", name: "동료", kind: "동료", slot: 1, skills: [], ...over });
  it("짐승은 체력이 가장 낮은 쪽, 병사는 앞줄의 앞 칸부터", () => {
    const s = start([wolf()], [hero(), mate({ health: 0 })]);
    expect(s.intents[0]?.targetId).toBe("mate");
    const soldier = start([{ id: "s1", def: enemyDef("deserter.shield"), slot: 0 }], [hero({ slot: 2 }), mate()]);
    expect(soldier.intents[0]?.targetId).toBe("mate");
  });
  it("노리던 대상이 쓰러지면 성향대로 다시 고른다", () => {
    let s = start([wolf("w1", 0, { overrides: { power: 60 } }), wolf("w2", 1)], [hero(), mate({ health: 0 })]);
    expect(s.intents.map((i) => i.targetId)).toEqual(["mate", "mate"]);
    s = playTurn(s, { actions: [rest, { unitId: "mate", type: "쉬기" }], defenses: {} }, ctx);
    expect(ally(s, "mate").down).toBe(true);
    expect(ally(s).hp).toBe(48);
  });
  it("닿는 상대를 한 번씩 돌아가며 노리고, 다 돌면 처음부터 다시 돈다", () => {
    const tough = { overrides: { hp: 999, power: 1 } };
    const third = (over = {}) => hero({ id: "third", name: "셋째", kind: "동료", slot: 2, skills: [], ...over });
    const idle: AllyAction[] = ["hero", "mate", "third"].map((unitId) => ({ unitId, type: "쉬기" }));
    const watch = (s: BattleState, turns: number, actions = idle) => {
      const targets: string[] = [];
      for (let i = 0; i < turns; i++) {
        targets.push(s.intents[0]!.targetId);
        s = playTurn(s, { actions, defenses: {} }, ctx);
      }
      return targets;
    };
    // 병사: 앞줄 1 → 2 → 3 → 1 → 2 → 3
    const soldier = start([{ id: "s1", def: enemyDef("deserter.shield", tough), slot: 0 }], [hero(), mate(), third()]);
    expect(watch(soldier, 7)).toEqual(["hero", "mate", "third", "hero", "mate", "third", "hero"]);
    // 짐승: 약한 쪽부터 차례로 한 바퀴
    const beast = start([wolf("w1", 0, tough)], [hero(), mate({ health: 0 }), third({ health: 20 })]);
    expect(watch(beast, 6)).toEqual(["mate", "third", "hero", "mate", "third", "hero"]);
    // 둘이면 번갈아, 혼자면 계속 같은 사람
    const two = start([{ id: "s1", def: enemyDef("deserter.shield", tough), slot: 0 }], [hero(), mate()]);
    expect(watch(two, 4, idle.slice(0, 2))).toEqual(["hero", "mate", "hero", "mate"]);
    expect(watch(start([wolf("w1", 0, tough)]), 3, idle.slice(0, 1))).toEqual(["hero", "hero", "hero"]);
  });
  it("돌던 중에 누가 쓰러지면 남은 사람끼리 이어서 돈다", () => {
    const third = hero({ id: "third", name: "셋째", kind: "동료", slot: 2, skills: [] });
    // 둘째만 한 방에 쓰러진다
    let s = start([{ id: "s1", def: enemyDef("deserter.shield", { overrides: { hp: 999, power: 31 } }), slot: 0 }], [hero(), mate({ health: 0 }), third]);
    const targets: string[] = [];
    for (let i = 0; i < 4; i++) {
      targets.push(s.intents[0]!.targetId);
      const actions: AllyAction[] = s.allies.filter((a) => !a.down).map((a) => ({ unitId: a.id, type: "쉬기" }));
      s = playTurn(s, { actions, defenses: { "s1>hero": "막기 성공", "s1>third": "막기 성공" } }, ctx);
    }
    expect(targets).toEqual(["hero", "mate", "third", "hero"]);
    expect(ally(s, "mate").down).toBe(true);
  });
  it("무작위 성향도 씨앗이 같으면 같은 대상을 고른다", () => {
    const random = () => start([wolf("w1", 0, { targeting: "무작위" })], [hero(), mate(), hero({ id: "third", kind: "동료", slot: 2, skills: [] })]);
    expect(random().intents).toEqual(random().intents);
  });
});

describe("스스로 고르는 규칙", () => {
  it("쓸 수 있는 기술 가운데 위력이 가장 큰 것을, 체력이 가장 낮은 적에게", () => {
    let s = start([wolf("w1", 0), wolf("w2", 1, { overrides: { hp: 9 } })]);
    expect(autoAllyActions(s, ctx)).toEqual([
      { unitId: "hero", type: "기술", skillId: "sword.charge", targetId: "w2", judgements: ["좋음"], clash: true },
    ]);
    // 돌진 베기가 쿨다운이면 다음으로 센 검풍
    s = playTurn(s, { actions: autoAllyActions(s, ctx), defenses: {} }, ctx);
    expect(autoAllyActions(s, ctx)[0]).toMatchObject({ skillId: "sword.gale", targetId: "w1" });
  });
  it("합은 이길 수 있을 때만 건다", () => {
    const s = start([wolf("w1", 0, { overrides: { power: 50 } })]);
    expect(autoAllyActions(s, ctx)[0]).toMatchObject({ skillId: "sword.charge", clash: false });
  });
  it("자세 기술은 고르지 않고, 쓸 것이 없으면 쉰다", () => {
    const s = start([wolf()], [hero({ slot: 4 })]);
    expect(autoAllyActions(s, ctx)).toEqual([{ unitId: "hero", type: "쉬기" }]);
    expect(autoAllyActions(start([wolf()]), ctx).some((a) => a.type === "기술" && a.skillId === "sword.riposte")).toBe(false);
  });
  it("반응: 안 누름 / 체력 30% 이하일 때만 막기 / 늘 막기", () => {
    const s = start([wolf()]);
    expect(autoDefenses(s, ctx, "안 누름")).toEqual({});
    expect(autoDefenses(s, ctx, "자동")).toEqual({});
    expect(autoDefenses(s, ctx, "늘 막기")).toEqual({ "w1>hero": "막기 성공" });
    ally(s).hp = 16;
    expect(autoDefenses(s, ctx, "자동")).toEqual({ "w1>hero": "막기 성공" });
    ally(s).hp = 17;
    expect(autoDefenses(s, ctx, "자동")).toEqual({});
  });
});

describe("같은 입력이면 같은 결과", () => {
  it("씨앗과 행동 기록만으로 다시 돌리면 똑같이 나온다", () => {
    const battle = setup([wolf("w1", 0), wolf("w2", 1), wolf("w3", 2, { targeting: "무작위" })], [hero(), hero({ id: "mate", kind: "동료", slot: 1, skills: [] })]);
    let s = createBattle(battle, ctx);
    const record: TurnInput[] = [];
    while (s.outcome === undefined && s.turn < 60) {
      const input = { actions: autoAllyActions(s, ctx), defenses: autoDefenses(s, ctx, "자동") };
      record.push(input);
      s = playTurn(s, input, ctx);
    }
    expect(s.outcome).toBeDefined();
    expect(replayBattle(battle, record, ctx)).toEqual(s);
    expect(replayBattle(battle, record, ctx)).toEqual(replayBattle(battle, record, ctx));
  });
});

describe("한 판을 끝까지 돌리기", () => {
  it("스스로 고르는 규칙으로 끝까지 가고, 기록으로 다시 돌리면 같다", async () => {
    const { simulateBattle } = await import("../src/rules/battle/simulate");
    const battle = setup([wolf()]);
    const result = simulateBattle(battle, ctx, "안 누름");
    expect(result.outcome).toBe("승리");
    expect(result.turns).toBeGreaterThan(0);
    expect(replayBattle(battle, result.record, ctx)).toEqual(result.final);
  });
  it("끝나지 않는 싸움은 정해진 턴에서 멈춘다", async () => {
    const { simulateBattle } = await import("../src/rules/battle/simulate");
    const wall = wolf("w1", 0, { overrides: { hp: 99999, power: 0 } });
    expect(simulateBattle(setup([wall]), ctx, "안 누름", 5)).toMatchObject({ outcome: "끝나지 않음", turns: 5 });
  });
});

describe("효과", () => {
  const dummy = (over = {}) => wolf("w1", 0, { overrides: { hp: 999, power: 0, stagger: 9999 }, ...over });
  const plain = (name: string, effects: { id: string; amount: number }[] = []) => {
    const def = enemyDef("wolf", { overrides: { hp: 999, power: 7, stagger: 9999 } });
    def.actions = [{ name, damageType: "파열", reach: "근접", range: "단일", weight: 1, effects }];
    return { id: "w1", def, slot: 0 };
  };

  it("연속 베기: 앞 두 타에 출혈 1씩. 턴 끝에 중첩만큼 깎이고 하나 줄어든다", () => {
    let s = start([dummy()]);
    s = resolveAllies(s, [use("sword.combo", "w1")], ctx);
    expect(foe(s).effects).toEqual({ bleed: 2 });
    const before = foe(s).hp;
    s = resolveEnemies(s, {}, ctx);
    expect(before - foe(s).hp).toBe(2);
    expect(foe(s).effects).toEqual({ bleed: 1 });
    s = wait(s, 1);
    expect(foe(s).effects).toEqual({});
    expect(before - foe(s).hp).toBe(3);
  });
  it("빗나간 타에는 효과가 붙지 않는다", () => {
    const s = resolveAllies(start([dummy()]), [use("sword.combo", "w1", { judgements: ["빗나감", "좋음", "좋음"] })], ctx);
    expect(foe(s).effects).toEqual({ bleed: 1 });
  });
  it("지속 피해로 적이 쓰러지면 승리한다", () => {
    let s = start([wolf("w1", 0, { overrides: { hp: 8, power: 0 } })]);
    // 연속 베기: 2.35 × 1.5 → 4, 4 … 세 타에 8이 넘으므로 체력을 넉넉히 다시 잡는다
    foe(s).hp = 20;
    s = playTurn(s, { actions: [use("sword.combo", "w1")], defenses: {} }, ctx);
    foe(s).hp = 1;
    s = wait(s, 1);
    expect(s.outcome).toBe("승리");
    expect(foe(s).down).toBe(true);
  });
  it("적의 공격이 효과를 붙인다. 막아도 붙고, 받아치면 붙지 않는다", () => {
    const bleeder = () => start([plain("물어뜯기", [{ id: "bleed", amount: 2 }])]);
    let s = resolveEnemies(resolveAllies(bleeder(), [rest], ctx), {}, ctx);
    // 7을 맞고, 턴 끝에 출혈 2
    expect(ally(s).hp).toBe(55 - 7 - 2);
    expect(ally(s).effects).toEqual({ bleed: 1 });
    s = resolveEnemies(resolveAllies(bleeder(), [rest], ctx), { "w1>hero": "막기 성공" }, ctx);
    expect(ally(s).hp).toBe(55 - 4 - 2);
    s = resolveEnemies(resolveAllies(bleeder(), [rest], ctx), { "w1>hero": "받아치기 성공" }, ctx);
    expect(ally(s)).toMatchObject({ hp: 55, effects: {} });
  });
  it("지속 피해로 쓰러진 플레이어는 경상", () => {
    let s = start([plain("할퀴기")], [hero({ health: 0 })]);
    ally(s).hp = 2;
    ally(s).effects = { poison: 5 };
    foe(s).power = 0;
    s.intents = [];
    s = playTurn(s, { actions: [rest], defenses: {} }, ctx);
    expect(s.outcome).toBe("패배");
    expect(ally(s)).toMatchObject({ hp: 0, injury: "경상" });
  });
  it("취약: 맞을 때마다 피해 +1(중첩당), 맞을 때마다 하나 줄어든다", () => {
    let s = start([dummy()]);
    foe(s).effects = { fragile: 2 };
    s = resolveAllies(s, [use("sword.combo", "w1")], ctx);
    // 한 타 2.35 × 1.5 = 3.5 → 4. 첫 타 +2, 둘째 타 +1, 셋째 타 +0
    expect(999 - foe(s).hp).toBe(4 + 2 + (4 + 1) + 4);
    expect(foe(s).effects["fragile"]).toBeUndefined();
  });
  it("수호: 받는 피해를 줄이되 맞으면 최소 1, 턴 끝에 모두 사라진다", () => {
    let s = start([plain("할퀴기")]);
    ally(s).effects = { ward: 3 };
    s = playTurn(s, { actions: [rest], defenses: {} }, ctx);
    expect(ally(s)).toMatchObject({ hp: 55 - 4, effects: {} });
    let big = start([plain("할퀴기")]);
    ally(big).effects = { ward: 50 };
    big = playTurn(big, { actions: [rest], defenses: {} }, ctx);
    expect(ally(big).hp).toBe(54);
  });
  it("속박: 자리를 옮기거나 도망치거나 피할 수 없다", () => {
    const s = start([wolf()]);
    ally(s).effects = { bind: 1 };
    expect(() => resolveAllies(s, [{ unitId: "hero", type: "자리 옮기기", slot: 4 }], ctx)).toThrow(/묶여서/);
    expect(() => resolveAllies(s, [{ unitId: "hero", type: "도망" }], ctx)).toThrow(/묶여서/);
    expect(() => resolveAllies(s, [use("sword.cut", "w1")], ctx)).not.toThrow();
    const big = enemyDef("wolf");
    big.actions = [{ name: "큰 공격", damageType: "파열", reach: "근접", range: "단일", big: true, weight: 1 }];
    let bound = start([{ id: "w1", def: big, slot: 0 }]);
    ally(bound).effects = { bind: 1 };
    bound = playTurn(bound, { actions: [rest], defenses: { "w1>hero": "피하기 성공" } }, ctx);
    expect(ally(bound).hp).toBe(48);
    // 턴 끝에 풀린다
    expect(ally(bound).effects).toEqual({});
  });
  it("사기: 주는 위력 +5%(중첩당). 공포·위압: 적의 위력이 준다", () => {
    const s = start([dummy()]);
    ally(s).effects = { morale: 2 };
    // 6.54 × 1.1 × 1.5 = 10.79 → 11
    expect(999 - foe(resolveAllies(s, [use("sword.cut", "w1")], ctx)).hp).toBe(11);
    let feared = start([plain("할퀴기")]);
    foe(feared).effects = { fear: 4 };
    feared = playTurn(feared, { actions: [rest], defenses: {} }, ctx);
    // 7 × 0.8 = 5.6 → 6
    expect(ally(feared).hp).toBe(49);
    let awed = start([plain("할퀴기")]);
    ally(awed).effects = { intimidate: 2 };
    awed = playTurn(awed, { actions: [rest], defenses: {} }, ctx);
    // 7 × 0.9 = 6.3 → 6
    expect(ally(awed).hp).toBe(49);
  });
  it("침식: 완벽으로 쳐도 좋음. 자신감: 보통의 배율이 오른다", () => {
    const hit = (effects: Record<string, number>, judgement: "보통" | "완벽") => {
      const s = start([dummy()]);
      ally(s).effects = effects;
      return 999 - foe(resolveAllies(s, [use("sword.cut", "w1", { judgements: [judgement] })], ctx)).hp;
    };
    expect([hit({}, "완벽"), hit({ erosion: 1 }, "완벽")]).toEqual([13, 10]);
    // 보통 0.7 → 6.54 × 0.7 × 1.5 = 6.87 → 7, 자신감 6이면 좋음과 같다
    expect([hit({}, "보통"), hit({ confidence: 6 }, "보통")]).toEqual([7, 10]);
  });
  it("집중은 기술을 쓸 때마다 하나 줄어든다", () => {
    let s = start([dummy()]);
    ally(s).effects = { focus: 2 };
    s = playTurn(s, { actions: [use("sword.cut", "w1")], defenses: {} }, ctx);
    expect(ally(s).effects).toEqual({ focus: 1 });
    expect(ally(wait(s, 1)).effects).toEqual({ focus: 1 });
  });
  it("신속: 턴 끝에 쿨다운이 1 더 줄어든다", () => {
    let s = start([dummy()]);
    ally(s).effects = { haste: 1 };
    s = playTurn(s, { actions: [use("sword.charge", "w1")], defenses: {} }, ctx);
    // 쿨다운 3: 보통은 턴 끝에 3이 남지만 신속으로 2
    expect(ally(s).cooldowns["sword.charge"]).toBe(2);
    expect(ally(s).effects).toEqual({});
  });
  it("결의: 쓰러질 한 방을 한 번 버텨 체력 1로 남는다", () => {
    let s = start([plain("할퀴기")], [hero({ health: 0 })]);
    foe(s).power = 99;
    s.intents[0]!.power = 99;
    ally(s).effects = { resolve: 1 };
    s = playTurn(s, { actions: [rest], defenses: {} }, ctx);
    expect(ally(s)).toMatchObject({ hp: 1, down: false, effects: {} });
    expect(s.outcome).toBeUndefined();
    s = playTurn(s, { actions: [rest], defenses: {} }, ctx);
    expect(s.outcome).toBe("패배");
  });
  it("면역인 적에게는 효과가 붙지 않는다", () => {
    const s = resolveAllies(start([dummy({ immune: ["bleed"] })]), [use("sword.combo", "w1")], ctx);
    expect(foe(s).effects).toEqual({});
  });
});

describe("연계", () => {
  const dummy = () => wolf("w1", 0, { overrides: { hp: 9999, power: 0, stagger: 99999 } });
  /** 그 턴에 준 피해 */
  const dealt = (s: BattleState, action: AllyAction) => {
    const before = foe(s).hp;
    const after = resolveAllies(s, [action], ctx);
    return { damage: before - foe(after).hp, next: resolveEnemies(after, {}, ctx) };
  };
  const bonusOf = (s: BattleState) => s.events.filter((e) => e.type === "연계").map((e) => (e.type === "연계" ? e.bonus : 0));

  it("여는 → 잇는 → 끝내는: 잇는 기술 +10%, 끝내는 기술 +25%", () => {
    let s = start([dummy()]);
    s = dealt(s, use("sword.charge", "w1")).next;
    expect(ally(s).chain).toEqual({ last: "여는", turn: 1 });
    const link = dealt(s, use("sword.combo", "w1"));
    expect(ally(link.next).chain).toEqual({ last: "잇는", turn: 2 });
    // 검풍 13.5 × 1.09 × 1.25 × 1.5 = 27.59 → 28 (연계가 없으면 22)
    const finish = dealt(link.next, use("sword.gale", "w1"));
    expect(finish.damage).toBe(28);
    expect(ally(finish.next).chain).toBeUndefined();
    expect(bonusOf(finish.next)).toEqual([0.1, 0.25]);
  });
  it("여는 기술 바로 다음의 끝내는 기술은 +10%", () => {
    let s = start([dummy()]);
    s = dealt(s, use("sword.charge", "w1")).next;
    // 13.5 × 1.09 × 1.1 × 1.5 = 24.28 → 24
    expect(dealt(s, use("sword.gale", "w1")).damage).toBe(24);
  });
  it("잇는 → 잇는은 연계를 유지한다", () => {
    let s = start([dummy()]);
    s = dealt(s, use("sword.cut", "w1")).next;
    s = dealt(s, use("sword.combo", "w1")).next;
    s = wait(s, 0);
    // 연속 베기는 쿨다운 1이라 한 턴 건너야 하므로, 쿨다운을 지우고 바로 이어 본다
    ally(s).cooldowns = {};
    s = dealt(s, use("sword.combo", "w1")).next;
    expect(ally(s).chain).toEqual({ last: "잇는", turn: 3 });
    expect(bonusOf(s)).toEqual([0.1, 0.1]);
  });
  it("연계 없이 쓴 잇는·끝내는 기술에는 보너스가 없다", () => {
    const s = start([dummy()]);
    expect(dealt(s, use("sword.gale", "w1")).damage).toBe(22);
    const combo = dealt(start([dummy()]), use("sword.combo", "w1"));
    expect(ally(combo.next).chain).toBeUndefined();
    expect(bonusOf(combo.next)).toEqual([]);
  });
  it("한 턴을 쉬거나 자리를 옮기면 끊긴다", () => {
    let s = start([dummy()]);
    s = dealt(s, use("sword.charge", "w1")).next;
    s = wait(s, 1);
    expect(dealt(s, use("sword.gale", "w1")).damage).toBe(22);
    let moved = start([dummy()]);
    moved = dealt(moved, use("sword.charge", "w1")).next;
    moved = playTurn(moved, { actions: [{ unitId: "hero", type: "자리 옮기기", slot: 1 }], defenses: {} }, ctx);
    expect(dealt(moved, use("sword.gale", "w1")).damage).toBe(22);
  });
  it("모든 타가 빗나가면 끊긴다", () => {
    let s = start([dummy()]);
    s = dealt(s, use("sword.charge", "w1", { judgements: ["빗나감"] })).next;
    expect(ally(s).chain).toBeUndefined();
    expect(dealt(s, use("sword.gale", "w1")).damage).toBe(22);
  });
  it("합에서 밀려 기술이 취소되면 끊긴다", () => {
    let s = start([wolf("w1", 0, { overrides: { hp: 9999, power: 50 } })]);
    s = playTurn(s, { actions: [use("sword.charge", "w1", { clash: true })], defenses: { "w1>hero": "막기 성공" } }, ctx);
    expect(ally(s).chain).toBeUndefined();
  });
  it("자세 기술도 여는 기술이라 연계를 시작한다", () => {
    let s = start([dummy()]);
    s = playTurn(s, { actions: [use("sword.riposte", "w1", { judgements: [] })], defenses: {} }, ctx);
    expect(ally(s).chain).toEqual({ last: "여는", turn: 1 });
  });
  it("스스로 고르는 규칙은 쓸 수 있는 연계를 먼저 고른다", () => {
    let s = start([dummy()]);
    expect(autoAllyActions(s, ctx)[0]).toMatchObject({ skillId: "sword.charge" });
    s = playTurn(s, { actions: autoAllyActions(s, ctx), defenses: {} }, ctx);
    // 연계를 잇는 기술(연속 베기 +10%, 검풍 +10%) 가운데 센 쪽
    expect(autoAllyActions(s, ctx)[0]).toMatchObject({ skillId: "sword.gale" });
    s = playTurn(s, { actions: autoAllyActions(s, ctx), defenses: {} }, ctx);
    // 연계가 끝났고 센 기술은 쿨다운이라, 다시 여는 기술부터
    expect(autoAllyActions(s, ctx)[0]).toMatchObject({ skillId: "sword.combo" });
  });
});
