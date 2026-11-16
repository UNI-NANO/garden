import type { BattleRules, Enemy, EnemyAction, Reach, Targeting } from "../../schema/defs/battle";
import type { DamageType } from "../../schema/defs/skill";
import type { Judgement, Range, SkillTable, Tier } from "../../schema/defs/skill-table";
import { createRng } from "../rng";
import { isValidSlot, reachable, rowOf, targetsInRange } from "./formation";
import { damageOf, enemyNumbers, hitPower, masteryMultiplier, playerMaxHp, staggerDamageOf } from "./numbers";

/**
 * 전투 계산의 뼈대 (명세서 「전투」).
 * 한 턴: 턴 시작(적의 의도 공개) → 아군 차례 → 적 차례 → 턴 끝.
 * 순수 함수다. 같은 씨앗과 같은 입력이면 언제나 같은 결과가 나온다(`replayBattle`).
 * 아직 없는 것: 효과·연계, 갈래·보완 칸·궁극기, 동료의 성향, 생포.
 */

export interface BattleContext {
  rules: BattleRules;
  table: SkillTable;
}

/** 전투에서 쓰는 기술. 숫자는 기술 기준표에서 미리 계산해 둔 것 */
export interface BattleSkill {
  id: string;
  name: string;
  tier: Tier;
  /** 판정 "좋음" 기준 한 타의 위력 */
  baseHitPower: number;
  hitCount: number;
  cooldown: number;
  energy: number;
  range: Range;
  damageType: DamageType;
  reach: Reach;
  /** 자세 기술: 치지 않고 자세를 잡는다 */
  stance: boolean;
}

export type Injury = "경상" | "중상";

export interface AllyUnit {
  id: string;
  name: string;
  kind: "플레이어" | "동료";
  slot: number;
  hp: number;
  maxHp: number;
  defense: number;
  energy: number;
  mastery: number;
  basicAttack: BattleSkill;
  skills: BattleSkill[];
  /** 기술 ID → 남은 쿨다운 */
  cooldowns: Record<string, number>;
  down: boolean;
  injury?: Injury;
  fleeing: boolean;
  fled: boolean;
  /** 이번 턴에 잡은 자세 */
  stance?: { skillId: string; power: number; damageType: DamageType };
}

export interface EnemyUnit {
  id: string;
  defId: string;
  name: string;
  rank: Enemy["rank"];
  slot: number;
  hp: number;
  maxHp: number;
  defense: number;
  resist: Enemy["resist"];
  power: number;
  stagger: number;
  maxStagger: number;
  /** 흐트러진 턴. 흐트러지지 않았으면 null */
  brokenOnTurn: number | null;
  targeting: Targeting;
  /** 이번 바퀴에 이미 노린 대상들. 닿는 상대를 한 번씩 다 노린 뒤에야 같은 사람을 다시 노린다 */
  recentTargets: string[];
  actions: EnemyAction[];
  down: boolean;
}

/** 적이 이번 턴에 할 행동. 턴 시작에 정해져 공개된다 */
export interface Intent {
  enemyId: string;
  actionName: string;
  damageType: DamageType;
  reach: Reach;
  range: Range;
  big: boolean;
  /** 하나의 값. 합에서 지면 줄어든다 */
  power: number;
  targetId: string;
  cancelled: boolean;
}

export type BattleKind = "일반" | "정예" | "보스" | "레이드" | "결투";
export type Outcome = "승리" | "패배" | "도망";

export type BattleEvent =
  | { turn: number; type: "피해"; from: string; to: string; amount: number; judgement?: Judgement }
  | { turn: number; type: "합"; ally: string; enemy: string; allyPower: number; enemyPower: number; result: "이김" | "짐" | "비김" }
  | { turn: number; type: "취소"; unit: string; reason: string }
  | { turn: number; type: "흐트러짐"; enemy: string }
  | { turn: number; type: "쓰러짐"; unit: string; injury?: Injury }
  | { turn: number; type: "반응"; ally: string; enemy: string; result: DefenseInput }
  | { turn: number; type: "자리 옮김"; unit: string; slot: number }
  | { turn: number; type: "도망"; unit: string }
  | { turn: number; type: "끝"; outcome: Outcome };

export interface BattleState {
  id: string;
  kind: BattleKind;
  seed: string;
  turn: number;
  phase: "아군 차례" | "적 차례" | "끝";
  allies: AllyUnit[];
  enemies: EnemyUnit[];
  intents: Intent[];
  outcome?: Outcome;
  events: BattleEvent[];
}

export type AllyAction =
  | { unitId: string; type: "기술"; skillId: string; targetId: string; judgements: Judgement[]; clash?: boolean }
  | { unitId: string; type: "자리 옮기기"; slot: number }
  | { unitId: string; type: "도망" }
  | { unitId: string; type: "쉬기" };

/** 적 차례의 반응. 화면이 판정한 결과만 넘어온다 */
export type DefenseInput = "없음" | "막기 성공" | "받아치기 성공" | "피하기 성공";
/** `${적 ID}>${아군 ID}` → 반응. 없으면 "없음"(그냥 맞는다) */
export type Defenses = Record<string, DefenseInput>;
export const defenseKey = (enemyId: string, allyId: string) => `${enemyId}>${allyId}`;

export interface AllySetup {
  id: string;
  name: string;
  kind: AllyUnit["kind"];
  slot: number;
  /** 능력치 건강 */
  health: number;
  mastery: number;
  basicAttack: BattleSkill;
  skills: BattleSkill[];
}

export interface BattleSetup {
  id: string;
  kind: BattleKind;
  seed: string;
  allies: AllySetup[];
  enemies: { id: string; def: Enemy; slot: number }[];
}

export class BattleError extends Error {
  override name = "BattleError";
}

const standingAllies = (state: BattleState) => state.allies.filter((a) => !a.down && !a.fled);
const standingEnemies = (state: BattleState) => state.enemies.filter((e) => !e.down);
const isStaggered = (enemy: EnemyUnit) => enemy.brokenOnTurn !== null;

export function createBattle(setup: BattleSetup, ctx: BattleContext): BattleState {
  const used = { 아군: new Set<number>(), 적: new Set<number>() };
  const claim = (side: "아군" | "적", slot: number, who: string) => {
    if (!isValidSlot(slot)) throw new BattleError(`${who}: 없는 칸 ${slot}`);
    if (used[side].has(slot)) throw new BattleError(`${who}: 칸 ${slot}에 이미 누가 있다`);
    used[side].add(slot);
  };
  const ids = new Set<string>();
  const claimId = (id: string) => {
    if (ids.has(id)) throw new BattleError(`ID가 겹친다: ${id}`);
    ids.add(id);
  };

  const allies = setup.allies.map((a): AllyUnit => {
    claim("아군", a.slot, a.name);
    claimId(a.id);
    const maxHp = playerMaxHp(ctx.rules, a.health);
    return {
      id: a.id,
      name: a.name,
      kind: a.kind,
      slot: a.slot,
      hp: maxHp,
      maxHp,
      defense: ctx.rules.player.defense,
      energy: ctx.table.energy.max,
      mastery: a.mastery,
      basicAttack: a.basicAttack,
      skills: a.skills,
      cooldowns: {},
      down: false,
      fleeing: false,
      fled: false,
    };
  });
  const enemies = setup.enemies.map((e): EnemyUnit => {
    claim("적", e.slot, e.def.name);
    claimId(e.id);
    const numbers = enemyNumbers(ctx.rules, e.def);
    return {
      id: e.id,
      defId: e.def.id,
      name: e.def.name,
      rank: e.def.rank,
      slot: e.slot,
      hp: numbers.maxHp,
      maxHp: numbers.maxHp,
      defense: e.def.defense,
      resist: e.def.resist,
      power: numbers.power,
      stagger: numbers.maxStagger,
      maxStagger: numbers.maxStagger,
      brokenOnTurn: null,
      targeting: e.def.targeting,
      recentTargets: [],
      actions: e.def.actions,
      down: false,
    };
  });
  if (!allies.some((a) => a.kind === "플레이어")) throw new BattleError("플레이어가 없다");
  if (enemies.length === 0) throw new BattleError("적이 없다");

  const state: BattleState = { id: setup.id, kind: setup.kind, seed: setup.seed, turn: 1, phase: "아군 차례", allies, enemies, intents: [], events: [] };
  state.intents = rollIntents(state);
  return state;
}

/** 턴 시작: 적마다 이번 턴의 행동과 대상을 정한다 */
function rollIntents(state: BattleState): Intent[] {
  const intents: Intent[] = [];
  for (const enemy of [...standingEnemies(state)].sort((a, b) => a.slot - b.slot)) {
    // 흐트러진 다음 턴에는 움직이지 못한다
    if (enemy.brokenOnTurn !== null && enemy.brokenOnTurn < state.turn) continue;
    const rng = createRng(`${state.seed}:${state.turn}:${enemy.id}`);
    const action = pickAction(enemy.actions, rng.next());
    const target = pickTarget(state, enemy.targeting, action.reach, rng.next(), enemy.recentTargets);
    if (target === undefined) continue;
    // 한 바퀴를 다 돌았으면 새 바퀴를 시작한다
    const fresh = enemy.recentTargets.includes(target.id);
    enemy.recentTargets = fresh ? [target.id] : [...enemy.recentTargets, target.id];
    intents.push({
      enemyId: enemy.id,
      actionName: action.name,
      damageType: action.damageType,
      reach: action.reach,
      range: action.range,
      big: action.big === true,
      power: enemy.power * (action.powerMultiplier ?? 1),
      targetId: target.id,
      cancelled: false,
    });
  }
  return intents;
}

function pickAction(actions: readonly EnemyAction[], roll: number): EnemyAction {
  const total = actions.reduce((sum, a) => sum + a.weight, 0);
  let at = roll * total;
  for (const action of actions) {
    at -= action.weight;
    if (at < 0) return action;
  }
  const last = actions[actions.length - 1];
  if (last === undefined) throw new BattleError("행동이 없는 적");
  return last;
}

/**
 * 성향대로 대상을 고른다. `avoid`(이번 바퀴에 이미 노린 대상들)는 남은 대상이 있을 때만 피한다:
 * 닿는 상대를 성향 순서대로 한 번씩 돌아가며 노리고, 다 돌면 처음부터 다시 돈다.
 * 굴림이 없어서 다음에 누가 노려질지 읽을 수 있다.
 */
function pickTarget(state: BattleState, targeting: Targeting, reach: Reach, roll: number, avoid: readonly string[] = []): AllyUnit | undefined {
  const all = reachable(standingAllies(state), reach);
  const others = all.filter((a) => !avoid.includes(a.id));
  const candidates = others.length > 0 ? others : all;
  if (candidates.length === 0) return undefined;
  switch (targeting) {
    case "앞줄":
      return candidates[0];
    case "뒷줄":
      return candidates.find((a) => rowOf(a.slot) === "뒷줄") ?? candidates[0];
    case "체력이 가장 낮은 쪽":
      return [...candidates].sort((a, b) => a.hp - b.hp || a.slot - b.slot)[0];
    case "무작위":
      return candidates[Math.min(candidates.length - 1, Math.floor(roll * candidates.length))];
  }
}

function checkOutcome(state: BattleState): void {
  if (state.outcome !== undefined) return;
  const players = state.allies.filter((a) => a.kind === "플레이어");
  let outcome: Outcome | undefined;
  if (standingEnemies(state).length === 0) outcome = "승리";
  else if (players.every((p) => p.down)) outcome = "패배";
  else if (players.every((p) => p.down || p.fled)) outcome = "도망";
  if (outcome !== undefined) {
    state.outcome = outcome;
    state.phase = "끝";
    state.events.push({ turn: state.turn, type: "끝", outcome });
  }
}

/** 적에게 한 타를 넣는다. 흐트러짐과 쓰러짐까지 처리한다 */
function strikeEnemy(
  state: BattleState,
  ctx: BattleContext,
  fromId: string,
  enemy: EnemyUnit,
  power: number,
  damageType: DamageType,
  staggerShare: number,
  judgement?: Judgement,
): void {
  if (enemy.down) return;
  const taken = isStaggered(enemy) ? ctx.rules.stagger.damageTakenMultiplier : 1;
  const amount = damageOf(power, ctx.rules.resist[enemy.resist[damageType]], enemy.defense, taken);
  enemy.hp = Math.max(0, enemy.hp - amount);
  state.events.push({ turn: state.turn, type: "피해", from: fromId, to: enemy.id, amount, ...(judgement ? { judgement } : {}) });
  if (power > 0) reduceStagger(state, enemy, staggerDamageOf(ctx.rules, power, damageType) * staggerShare);
  if (enemy.hp === 0) {
    enemy.down = true;
    state.events.push({ turn: state.turn, type: "쓰러짐", unit: enemy.id });
    for (const intent of state.intents) if (intent.enemyId === enemy.id) intent.cancelled = true;
  }
}

function reduceStagger(state: BattleState, enemy: EnemyUnit, amount: number): void {
  if (enemy.down || isStaggered(enemy) || amount <= 0) return;
  enemy.stagger = Math.max(0, enemy.stagger - amount);
  if (enemy.stagger === 0) {
    enemy.brokenOnTurn = state.turn;
    state.events.push({ turn: state.turn, type: "흐트러짐", enemy: enemy.id });
  }
}

function findSkill(ally: AllyUnit, skillId: string): BattleSkill | undefined {
  return ally.basicAttack.id === skillId ? ally.basicAttack : ally.skills.find((s) => s.id === skillId);
}

/** 그 기술을 지금 고를 수 있는가 */
export function canUseSkill(ally: AllyUnit, skill: BattleSkill): boolean {
  return (ally.cooldowns[skill.id] ?? 0) === 0 && ally.energy >= skill.energy;
}

/**
 * 아군 차례. 행동은 확정한 순서(배열 순서)대로 실행한다.
 * 고를 수 없는 행동(쿨다운, 기력 부족, 닿지 않는 대상, 쓰러진 사람)은 오류다: 화면이 미리 막아야 한다.
 */
export function resolveAllies(before: BattleState, actions: readonly AllyAction[], ctx: BattleContext): BattleState {
  if (before.phase !== "아군 차례") throw new BattleError(`아군 차례가 아니다 (${before.phase})`);
  const state = structuredClone(before);
  const acted = new Set<string>();

  for (const action of actions) {
    if (state.outcome !== undefined) break;
    const ally = state.allies.find((a) => a.id === action.unitId);
    if (!ally) throw new BattleError(`없는 아군: ${action.unitId}`);
    if (ally.down || ally.fled) throw new BattleError(`${ally.name}: 움직일 수 없다`);
    if (acted.has(ally.id)) throw new BattleError(`${ally.name}: 한 턴에 한 번만 움직인다`);
    acted.add(ally.id);

    if (action.type === "쉬기") continue;
    if (action.type === "도망") {
      if (state.kind !== "일반") throw new BattleError("이 전투에서는 도망칠 수 없다");
      ally.fleeing = true;
      continue;
    }
    if (action.type === "자리 옮기기") {
      const cost = ctx.rules.move.energy;
      if (!isValidSlot(action.slot)) throw new BattleError(`없는 칸 ${action.slot}`);
      if (state.allies.some((a) => !a.fled && a.slot === action.slot)) throw new BattleError(`칸 ${action.slot}에 이미 누가 있다`);
      if (ally.energy < cost) throw new BattleError(`${ally.name}: 기력이 모자라다`);
      ally.energy -= cost;
      ally.slot = action.slot;
      state.events.push({ turn: state.turn, type: "자리 옮김", unit: ally.id, slot: action.slot });
      continue;
    }
    useSkill(state, ctx, ally, action);
    checkOutcome(state);
  }

  if (state.outcome === undefined) state.phase = "적 차례";
  return state;
}

function useSkill(state: BattleState, ctx: BattleContext, ally: AllyUnit, action: Extract<AllyAction, { type: "기술" }>): void {
  const skill = findSkill(ally, action.skillId);
  if (!skill) throw new BattleError(`${ally.name}: 없는 기술 ${action.skillId}`);
  if ((ally.cooldowns[skill.id] ?? 0) > 0) throw new BattleError(`${ally.name}: ${skill.name}은(는) 쿨다운 중이다`);
  if (ally.energy < skill.energy) throw new BattleError(`${ally.name}: 기력이 모자라다`);
  if (skill.reach === "근접" && rowOf(ally.slot) === "뒷줄") throw new BattleError(`${ally.name}: 뒷줄에서는 근접 기술을 쓸 수 없다`);
  const mastery = masteryMultiplier(ctx.rules, ally.mastery);
  const reachMultiplier = skill.reach === "원거리" ? ctx.rules.rangedMultiplier : 1;

  const spend = () => {
    ally.energy -= skill.energy;
    // 쓴 턴의 턴 끝에도 1 줄어들므로 하나 더해 둔다: 쿨다운 1이면 다음 한 턴을 쉰다
    if (skill.cooldown > 0) ally.cooldowns[skill.id] = skill.cooldown + 1;
  };

  if (skill.stance) {
    spend();
    ally.stance = { skillId: skill.id, power: hitPower(ctx.table, skill.baseHitPower, "좋음", mastery, reachMultiplier), damageType: skill.damageType };
    return;
  }

  if (action.judgements.length !== skill.hitCount) throw new BattleError(`${ally.name}: ${skill.name}은(는) ${skill.hitCount}타다`);

  // 대상: 고른 적이 그사이 쓰러졌으면 같은 규칙으로 닿는 다음 적에게. 없으면 기력을 돌려주고 취소
  const candidates = reachable(standingEnemies(state), skill.reach);
  let target = state.enemies.find((e) => e.id === action.targetId);
  if (!target) throw new BattleError(`없는 대상: ${action.targetId}`);
  let retargeted = false;
  if (target.down) {
    target = candidates[0];
    retargeted = true;
    if (!target) {
      state.events.push({ turn: state.turn, type: "취소", unit: ally.id, reason: "칠 대상이 없다" });
      return;
    }
  } else if (!candidates.some((e) => e.id === action.targetId)) {
    throw new BattleError(`${ally.name}: ${target.name}에게 닿지 않는다`);
  }

  spend();
  const powers = action.judgements.map((j) => hitPower(ctx.table, skill.baseHitPower, j, mastery, reachMultiplier));

  // 합: 내 타 위력의 합과 적 의도의 위력을 맞붙인다. 대상이 바뀌었거나 의도가 없으면 그냥 공격
  let extraStagger = 0;
  const targetId = target.id;
  const intent = state.intents.find((i) => i.enemyId === targetId && !i.cancelled);
  if (action.clash === true && !retargeted && intent) {
    const mine = powers.reduce((sum, p) => sum + p, 0);
    const theirs = intent.power;
    const result = mine > theirs ? "이김" : mine < theirs ? "짐" : "비김";
    state.events.push({ turn: state.turn, type: "합", ally: ally.id, enemy: target.id, allyPower: mine, enemyPower: theirs, result });
    if (result === "이김") {
      intent.cancelled = true;
      extraStagger = mine - theirs;
    } else {
      if (result === "짐") intent.power = theirs - mine;
      else intent.cancelled = true;
      state.events.push({ turn: state.turn, type: "취소", unit: ally.id, reason: "합에서 밀렸다" });
      return;
    }
  }

  const share = ctx.rules.range.othersShare[skill.range];
  const hitList = targetsInRange(standingEnemies(state), target, skill.range);
  action.judgements.forEach((judgement, index) => {
    const power = powers[index] ?? 0;
    hitList.forEach((enemy, order) => {
      const main = order === 0;
      strikeEnemy(state, ctx, ally.id, enemy, main ? power : power * share, skill.damageType, main ? 1 : ctx.rules.range.staggerOthersShare, judgement);
    });
  });
  if (extraStagger > 0) reduceStagger(state, target, extraStagger);
}

/**
 * 적 차례와 턴 끝. 깨지지 않은 의도가 앞줄부터 차례로 실행되고, 턴이 넘어가며 다음 의도가 정해진다.
 */
export function resolveEnemies(before: BattleState, defenses: Defenses, ctx: BattleContext): BattleState {
  if (before.phase !== "적 차례") throw new BattleError(`적 차례가 아니다 (${before.phase})`);
  const state = structuredClone(before);

  const order = [...state.intents].sort((a, b) => slotOfEnemy(state, a.enemyId) - slotOfEnemy(state, b.enemyId));
  for (const intent of order) {
    if (state.outcome !== undefined) break;
    const enemy = state.enemies.find((e) => e.id === intent.enemyId);
    if (!enemy || enemy.down || intent.cancelled) continue;

    // 대상이 쓰러졌거나 닿지 않게 되었으면 성향대로 다시 고른다
    const candidates = reachable(standingAllies(state), intent.reach);
    const rng = createRng(`${state.seed}:${state.turn}:${enemy.id}:다시`);
    const main = candidates.find((a) => a.id === intent.targetId) ?? pickTarget(state, enemy.targeting, intent.reach, rng.next());
    if (!main) continue;

    const share = ctx.rules.range.othersShare[intent.range];
    targetsInRange(standingAllies(state), main, intent.range).forEach((ally, index) => {
      strikeAlly(state, ctx, enemy, intent, ally, index === 0 ? intent.power : intent.power * share, defenses[defenseKey(enemy.id, ally.id)] ?? "없음");
    });
    checkOutcome(state);
  }

  if (state.outcome === undefined) endTurn(state, ctx);
  return state;
}

const slotOfEnemy = (state: BattleState, enemyId: string) => state.enemies.find((e) => e.id === enemyId)?.slot ?? 0;

function strikeAlly(state: BattleState, ctx: BattleContext, enemy: EnemyUnit, intent: Intent, ally: AllyUnit, power: number, input: DefenseInput): void {
  if (ally.down || enemy.down) return;
  // 피하기는 큰 공격에만 통한다
  const defense: DefenseInput = input === "피하기 성공" && !intent.big ? "없음" : input;
  if (defense !== "없음") state.events.push({ turn: state.turn, type: "반응", ally: ally.id, enemy: enemy.id, result: defense });
  const maxEnergy = ctx.table.energy.max;

  if (defense === "받아치기 성공") {
    // 피해 없음 + 반격 + 흐트러짐 크게. 자세를 잡았으면 그 기술의 위력으로, 아니면 기본 공격으로
    const counter = ally.stance ?? {
      power: hitPower(ctx.table, ally.basicAttack.baseHitPower, "좋음", masteryMultiplier(ctx.rules, ally.mastery)),
      damageType: ally.basicAttack.damageType,
    };
    strikeEnemy(state, ctx, ally.id, enemy, counter.power, counter.damageType, ctx.rules.stagger.parryMultiplier);
    return;
  }
  if (defense === "피하기 성공") {
    ally.energy = Math.min(maxEnergy, ally.energy + ctx.rules.dodge.energy);
    return;
  }

  let amount = damageOf(power, 1, ally.defense);
  if (defense === "막기 성공") {
    amount = damageOf(power * ctx.rules.guard.damageMultiplier, 1, ally.defense);
    ally.energy = Math.min(maxEnergy, ally.energy + ctx.rules.guard.energy);
  }
  ally.hp = Math.max(0, ally.hp - amount);
  state.events.push({ turn: state.turn, type: "피해", from: enemy.id, to: ally.id, amount });

  if (ally.hp === 0) {
    // 중상: 보스의 광역기에 쓰러졌거나, 한 방에 최대 체력의 일정 비율 이상을 맞고 쓰러졌을 때
    const bossArea = enemy.rank === "보스" && intent.range !== "단일";
    const heavy = amount >= ally.maxHp * ctx.rules.injury.severeHitShare;
    ally.down = true;
    ally.injury = bossArea || heavy ? "중상" : "경상";
    state.events.push({ turn: state.turn, type: "쓰러짐", unit: ally.id, injury: ally.injury });
  }
}

function endTurn(state: BattleState, ctx: BattleContext): void {
  for (const ally of state.allies) {
    delete ally.stance;
    if (ally.down || ally.fled) continue;
    if (ally.fleeing) {
      ally.fled = true;
      state.events.push({ turn: state.turn, type: "도망", unit: ally.id });
      continue;
    }
    for (const id of Object.keys(ally.cooldowns)) {
      const left = (ally.cooldowns[id] ?? 0) - 1;
      if (left > 0) ally.cooldowns[id] = left;
      else delete ally.cooldowns[id];
    }
    ally.energy = Math.min(ctx.table.energy.max, ally.energy + ctx.table.energy.perTurn);
  }
  for (const enemy of state.enemies) {
    // 흐트러진 다음 턴의 끝에 게이지가 다시 찬다
    if (!enemy.down && enemy.brokenOnTurn !== null && enemy.brokenOnTurn < state.turn) {
      enemy.brokenOnTurn = null;
      enemy.stagger = enemy.maxStagger;
    }
  }
  checkOutcome(state);
  if (state.outcome !== undefined) return;
  state.turn += 1;
  state.phase = "아군 차례";
  state.intents = rollIntents(state);
}

/** 한 턴의 입력 */
export interface TurnInput {
  actions: AllyAction[];
  defenses: Defenses;
}

export function playTurn(state: BattleState, input: TurnInput, ctx: BattleContext): BattleState {
  const afterAllies = resolveAllies(state, input.actions, ctx);
  return afterAllies.phase === "적 차례" ? resolveEnemies(afterAllies, input.defenses, ctx) : afterAllies;
}

/** 처음 상태와 행동 기록만으로 전투를 다시 돌린다. 검증(파티원 화면, 하루 계산)에 쓴다 */
export function replayBattle(setup: BattleSetup, record: readonly TurnInput[], ctx: BattleContext): BattleState {
  let state = createBattle(setup, ctx);
  for (const input of record) {
    if (state.outcome !== undefined) break;
    state = playTurn(state, input, ctx);
  }
  return state;
}
