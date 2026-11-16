import type { BattleRules, Enemy, EnemyAction, Reach, Targeting } from "../../schema/defs/battle";
import type { AppliedEffect } from "../../schema/defs/effect";
import type { DamageType, Role } from "../../schema/defs/skill";
import type { Condition } from "../../schema/defs/tree";
import type { Judgement, Range, SkillTable, Tier } from "../../schema/defs/skill-table";
import { createRng } from "../rng";
import {
  addEffect,
  adjustJudgement,
  canMove,
  damageTakenBonus,
  decayEffects,
  endure,
  extraCooldown,
  judgementMultiplier,
  ongoingDamage,
  powerMultiplier,
  type EffectDefs,
  type EffectStacks,
} from "./effects";
import { isValidSlot, reachable, rowOf, ROW_SIZE, targetsInRange } from "./formation";
import { damageOf, enemyNumbers, hitPower, masteryMultiplier, playerMaxHp, staggerDamageOf } from "./numbers";

/**
 * 전투 계산의 뼈대 (명세서 「전투」).
 * 한 턴: 턴 시작(적의 의도 공개) → 아군 차례 → 적 차례 → 턴 끝.
 * 순수 함수다. 같은 씨앗과 같은 입력이면 언제나 같은 결과가 나온다(`replayBattle`).
 * 효과와 연계까지 들어 있다. 아직 없는 것: 갈래·보완 칸·궁극기, 동료의 성향, 생포.
 */

export interface BattleContext {
  rules: BattleRules;
  table: SkillTable;
  effects: EffectDefs;
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
  /** 연계 역할 */
  role: Role;
  /** 맞은 타에 붙는 효과 */
  effects: AppliedEffect[];

  // ── 아래는 찍은 칸이 더하는 것 (build-skill.ts). 없으면 기본 동작 ──
  /** 판정 바의 좋음 칸에 더하는 폭 (화면이 쓴다) */
  goodWidth?: number;
  /** 흐트러짐 피해에 곱하는 값 */
  staggerMultiplier?: number;
  /** 조건이 맞을 때만 걸리는 규칙 */
  conditional?: { kind: "위력 +" | "위력 ×" | "흐트러짐 ×" | "좋음 칸"; amount: number; when: Condition }[];
  /** 고른 대상이 아닌 나머지가 받는 위력·흐트러짐의 비율 (없으면 기준값) */
  othersShare?: number;
  othersStaggerShare?: number;
  /** 고른 적의 바로 뒤 칸도 맞는다 */
  alsoBehind?: boolean;
  /** 완벽으로 친 타에 더 붙는 효과 */
  perfectEffects?: AppliedEffect[];
  /** 이 기술로 붙인 이 효과들은 붙은 턴의 턴 끝에는 줄지 않는다 */
  holdEffects?: string[];
  /** 이 기술로 붙일 때 효과의 최대 중첩에 더하는 값 */
  effectCapBonus?: Record<string, number>;
  /** 마지막 타에 대상의 효과를 터뜨려 피해로 바꾼다 */
  burst?: { effect: string; perStackPct: number; keepShare: number; toStagger: boolean };
  /** 맞은 적을 뒷줄로 밀어내고 그 뒤의 적을 앞으로 끌어낸다 */
  push?: { pushedEffects: AppliedEffect[]; pulledEffects: AppliedEffect[] };
  /** 근접이지만 뒷줄의 적도 고를 수 있다. 뒷줄을 치면 위력에 곱하는 값 */
  reachBack?: { multiplier: number };
  /** 쓰고 나면 한 턴 동안 적진에 나가 있다: 이번 턴 모든 적이 먼저 노리고, 다음 턴 주는 위력이 오른다 */
  intoEnemy?: { powerPct: number };
  /** 자세 기술의 덤 */
  stanceOpts?: {
    /** 자세 중 받는 피해에 곱하는 값 */
    damageTaken?: number;
    /** 받아치기 칸에 더하는 폭 (화면이 쓴다) */
    parryWidth?: number;
    /** 받아치기에 성공하면 얻는 기력 */
    parryEnergy?: number;
    /** 자세가 더 이어지는 턴 수 */
    holdTurns?: number;
    /** 반격의 타수 */
    counterHits?: number;
    /** 자세를 잡으면서 찌른다: 기본 공격 위력의 share만큼 */
    thrust?: { share: number; powerPct: number; staggerMultiplier: number; damageType?: DamageType };
  };
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
  /** 잡고 있는 자세. untilTurn의 턴 끝에 풀린다 */
  stance?: { skillId: string; power: number; damageType: DamageType; untilTurn: number; damageTaken: number; parryEnergy: number; counterHits: number };
  /** 이번 턴에는 줄지 않는 효과 */
  held?: string[];
  /** 적진에 나가 있음: 그 턴에는 모든 적이 먼저 노리고, 다음 턴 주는 위력이 오른다 */
  exposed?: { turn: number; powerPct: number };
  /** 걸려 있는 효과: 효과 ID → 중첩 */
  effects: EffectStacks;
  /** 연계: 마지막으로 이은 기술의 역할과 그 턴. 바로 다음 턴에만 이어진다 */
  chain?: { last: Role; turn: number };
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
  effects: EffectStacks;
  /** 걸리지 않는 효과 */
  immune: string[];
  /** 이번 턴에는 줄지 않는 효과 */
  held?: string[];
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
  /** 맞은 쪽에 붙는 효과 */
  effects: AppliedEffect[];
}

export type BattleKind = "일반" | "정예" | "보스" | "레이드" | "결투";
export type Outcome = "승리" | "패배" | "도망";

export type BattleEvent =
  | { turn: number; type: "피해"; from: string; to: string; amount: number; judgement?: Judgement }
  | { turn: number; type: "합"; ally: string; enemy: string; allyPower: number; enemyPower: number; result: "이김" | "짐" | "비김" }
  | { turn: number; type: "취소"; unit: string; reason: string }
  | { turn: number; type: "흐트러짐"; enemy: string }
  | { turn: number; type: "효과"; unit: string; effect: string; amount: number }
  | { turn: number; type: "지속 피해"; unit: string; amount: number }
  | { turn: number; type: "버팀"; unit: string }
  | { turn: number; type: "연계"; unit: string; bonus: number }
  | { turn: number; type: "터뜨림"; from: string; to: string; effect: string; stacks: number; amount: number }
  | { turn: number; type: "밀어냄"; pushed: string; pulled?: string }
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
      effects: {},
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
      effects: {},
      immune: [...(e.def.immune ?? [])],
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
      effects: [...(action.effects ?? [])],
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
  let amount = damageOf(power, ctx.rules.resist[enemy.resist[damageType]], enemy.defense, taken);
  if (power > 0) {
    // 취약·수호는 저항과 방어를 거친 뒤에 더하고 뺀다. 맞으면 최소 1
    amount = Math.max(1, amount + damageTakenBonus(ctx.effects, enemy.effects));
    decayEffects(ctx.effects, enemy.effects, "맞을 때 −1");
  }
  enemy.hp = Math.max(0, enemy.hp - amount);
  state.events.push({ turn: state.turn, type: "피해", from: fromId, to: enemy.id, amount, ...(judgement ? { judgement } : {}) });
  if (power > 0) reduceStagger(state, enemy, staggerDamageOf(ctx.rules, power, damageType) * staggerShare);
  if (enemy.hp === 0) downEnemy(state, enemy);
}

function downEnemy(state: BattleState, enemy: EnemyUnit): void {
  enemy.down = true;
  state.events.push({ turn: state.turn, type: "쓰러짐", unit: enemy.id });
  cancelIntents(state, enemy.id);
}

function cancelIntents(state: BattleState, enemyId: string): void {
  for (const intent of state.intents) if (intent.enemyId === enemyId) intent.cancelled = true;
}

/** 효과를 붙이고 기록한다 */
function giveEffect(
  state: BattleState,
  ctx: BattleContext,
  unit: { id: string; effects: EffectStacks; immune?: string[]; held?: string[] },
  id: string,
  amount: number,
  from?: BattleSkill,
): void {
  const added = addEffect(ctx.effects, unit.effects, id, amount, unit.immune ?? [], from?.effectCapBonus?.[id] ?? 0);
  if (added > 0) state.events.push({ turn: state.turn, type: "효과", unit: unit.id, effect: id, amount: added });
  if (added > 0 && from?.holdEffects?.includes(id) && !unit.held?.includes(id)) unit.held = [...(unit.held ?? []), id];
}

function reduceStagger(state: BattleState, enemy: EnemyUnit, amount: number): void {
  if (enemy.down || isStaggered(enemy) || amount <= 0) return;
  enemy.stagger = Math.max(0, enemy.stagger - amount);
  if (enemy.stagger === 0) {
    enemy.brokenOnTurn = state.turn;
    state.events.push({ turn: state.turn, type: "흐트러짐", enemy: enemy.id });
    // 무너지는 순간 이번 턴에 하려던 공격도 끊긴다
    cancelIntents(state, enemy.id);
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
    if (action.type !== "기술" && !canMove(ctx.effects, ally.effects)) {
      throw new BattleError(`${ally.name}: 묶여서 움직일 수 없다`);
    }
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

/**
 * 연계로 붙는 위력 보너스. 여는 → 잇는 → 끝내는 순서로, 바로 앞 턴에 이은 사람만 받는다.
 */
export function chainBonus(state: BattleState, ctx: BattleContext, ally: AllyUnit, skill: BattleSkill): number {
  const chain = ally.chain;
  if (chain === undefined || chain.turn !== state.turn - 1) return 0;
  if (skill.role === "잇는") return ctx.rules.chain.linkBonus;
  if (skill.role === "끝내는") return chain.last === "잇는" ? ctx.rules.chain.finishBonus : ctx.rules.chain.linkBonus;
  return 0;
}

/** 조건이 지금 맞는가. "완벽"은 타마다 다르므로 그 타의 (고친) 판정을 넘긴다 */
function holds(when: Condition, state: BattleState, ally: AllyUnit, target: EnemyUnit | undefined, judgement: Judgement | undefined): boolean {
  switch (when) {
    case "연계 중":
      return ally.chain !== undefined && ally.chain.turn === state.turn - 1;
    case "연계 아님":
      return !(ally.chain !== undefined && ally.chain.turn === state.turn - 1);
    case "대상이 흐트러짐":
      return target !== undefined && isStaggered(target);
    case "대상이 뒷줄":
      return target !== undefined && rowOf(target.slot) === "뒷줄";
    case "완벽":
      return judgement === "완벽";
  }
}

/** 조건부 규칙을 더한 배율: 위력 또는 흐트러짐 */
function conditionalMultiplier(
  skill: BattleSkill,
  kinds: { plus?: "위력 +"; times: "위력 ×" | "흐트러짐 ×" },
  state: BattleState,
  ally: AllyUnit,
  target: EnemyUnit | undefined,
  judgement: Judgement | undefined,
): number {
  let pct = 0;
  let mul = 1;
  for (const rule of skill.conditional ?? []) {
    if (!holds(rule.when, state, ally, target, judgement)) continue;
    if (rule.kind === kinds.plus) pct += rule.amount;
    else if (rule.kind === kinds.times) mul *= rule.amount;
  }
  return (1 + pct) * mul;
}

/** 판정 바의 좋음 칸에 이 기술이 더하는 폭 (화면이 쓴다) */
export function skillGoodWidth(state: BattleState, ally: AllyUnit, skill: BattleSkill, target: EnemyUnit | undefined): number {
  let width = skill.goodWidth ?? 0;
  for (const rule of skill.conditional ?? []) {
    if (rule.kind === "좋음 칸" && holds(rule.when, state, ally, target, undefined)) width += rule.amount;
  }
  return width;
}

/** 이 기술을 이 판정들로 이 대상에게 쓰면 타마다 위력이 얼마인가 (효과·연계·찍은 칸까지 반영) */
export function skillHitPowers(
  state: BattleState,
  ctx: BattleContext,
  ally: AllyUnit,
  skill: BattleSkill,
  target: EnemyUnit | undefined,
  judgements: readonly Judgement[],
): number[] {
  // 뒷줄까지 닿는 근접 기술: 앞줄이 서 있는데 뒷줄을 치면 위력이 준다
  const overFront = target !== undefined && rowOf(target.slot) === "뒷줄" && standingEnemies(state).some((e) => rowOf(e.slot) === "앞줄");
  const exposedBonus = ally.exposed !== undefined && ally.exposed.turn === state.turn - 1 ? ally.exposed.powerPct : 0;
  const multiplier =
    masteryMultiplier(ctx.rules, ally.mastery) *
    (skill.reach === "원거리" ? ctx.rules.rangedMultiplier : 1) *
    (skill.reachBack && overFront ? skill.reachBack.multiplier : 1) *
    (1 + chainBonus(state, ctx, ally, skill)) *
    (1 + exposedBonus) *
    powerMultiplier(ctx.effects, ally.effects, target?.effects ?? {}, false);
  return judgements.map((judgement) => {
    const adjusted = adjustJudgement(ctx.effects, ally.effects, judgement);
    const conditional = conditionalMultiplier(skill, { plus: "위력 +", times: "위력 ×" }, state, ally, target, adjusted);
    return skill.baseHitPower * judgementMultiplier(ctx.effects, ctx.table, ally.effects, adjusted) * multiplier * conditional;
  });
}

/** 대상에게 걸린 효과를 없애고, 없앤 중첩만큼 방어를 무시하는 피해를 준다 */
function burstEffect(state: BattleState, ctx: BattleContext, ally: AllyUnit, enemy: EnemyUnit, burst: NonNullable<BattleSkill["burst"]>): void {
  const stacks = enemy.effects[burst.effect] ?? 0;
  if (stacks <= 0) return;
  const keep = Math.floor(stacks * burst.keepShare);
  if (keep > 0) enemy.effects[burst.effect] = keep;
  else delete enemy.effects[burst.effect];
  const amount = Math.max(1, Math.round(stacks * (1 + burst.perStackPct * stacks)));
  enemy.hp = Math.max(0, enemy.hp - amount);
  state.events.push({ turn: state.turn, type: "터뜨림", from: ally.id, to: enemy.id, effect: burst.effect, stacks, amount });
  if (burst.toStagger) reduceStagger(state, enemy, stacks);
  if (enemy.hp === 0) downEnemy(state, enemy);
}

/** 앞줄의 적을 같은 열의 뒷줄로 밀어낸다. 그 자리에 서 있던 적은 앞줄로 끌려 나온다 */
function pushEnemy(state: BattleState, ctx: BattleContext, enemy: EnemyUnit, skill: BattleSkill, push: NonNullable<BattleSkill["push"]>): void {
  if (enemy.down || rowOf(enemy.slot) !== "앞줄") return;
  const front = enemy.slot;
  const back = front + ROW_SIZE;
  const pulled = standingEnemies(state).find((e) => e.slot === back);
  enemy.slot = back;
  if (pulled) pulled.slot = front;
  state.events.push({ turn: state.turn, type: "밀어냄", pushed: enemy.id, ...(pulled ? { pulled: pulled.id } : {}) });
  for (const effect of push.pushedEffects) giveEffect(state, ctx, enemy, effect.id, effect.amount, skill);
  if (pulled) for (const effect of push.pulledEffects) giveEffect(state, ctx, pulled, effect.id, effect.amount, skill);
}

function useSkill(state: BattleState, ctx: BattleContext, ally: AllyUnit, action: Extract<AllyAction, { type: "기술" }>): void {
  const skill = findSkill(ally, action.skillId);
  if (!skill) throw new BattleError(`${ally.name}: 없는 기술 ${action.skillId}`);
  if ((ally.cooldowns[skill.id] ?? 0) > 0) throw new BattleError(`${ally.name}: ${skill.name}은(는) 쿨다운 중이다`);
  if (ally.energy < skill.energy) throw new BattleError(`${ally.name}: 기력이 모자라다`);
  if (skill.reach === "근접" && rowOf(ally.slot) === "뒷줄") throw new BattleError(`${ally.name}: 뒷줄에서는 근접 기술을 쓸 수 없다`);
  const bonus = chainBonus(state, ctx, ally, skill);

  const spend = () => {
    ally.energy -= skill.energy;
    // 쓴 턴의 턴 끝에도 1 줄어들므로 하나 더해 둔다: 쿨다운 1이면 다음 한 턴을 쉰다
    if (skill.cooldown > 0) ally.cooldowns[skill.id] = skill.cooldown + 1;
  };
  /** 기술이 제대로 들어갔을 때 연계를 잇는다. 순서에 맞지 않으면 끊긴다 */
  const linkChain = () => {
    if (bonus > 0) state.events.push({ turn: state.turn, type: "연계", unit: ally.id, bonus });
    if (skill.role === "여는") ally.chain = { last: "여는", turn: state.turn };
    else if (skill.role === "잇는" && bonus > 0) ally.chain = { last: "잇는", turn: state.turn };
    else delete ally.chain;
  };
  const used = () => decayEffects(ctx.effects, ally.effects, "쓸 때 −1");

  if (skill.stance) {
    const opts = skill.stanceOpts ?? {};
    // 자세를 잡으면서 찌르는 갈래는 대상이 있어야 한다
    const thrustTarget = opts.thrust ? reachable(standingEnemies(state), skill.reach).find((e) => e.id === action.targetId) : undefined;
    if (opts.thrust && !thrustTarget) throw new BattleError(`${ally.name}: 찌를 대상에게 닿지 않는다`);
    spend();
    const [power = 0] = skillHitPowers(state, ctx, ally, skill, undefined, ["좋음"]);
    ally.stance = {
      skillId: skill.id,
      power,
      damageType: skill.damageType,
      untilTurn: state.turn + (opts.holdTurns ?? 0),
      damageTaken: opts.damageTaken ?? 1,
      parryEnergy: opts.parryEnergy ?? 0,
      counterHits: opts.counterHits ?? 1,
    };
    if (opts.thrust && thrustTarget) {
      const thrust = opts.thrust;
      const thrustPower =
        hitPower(ctx.table, ally.basicAttack.baseHitPower, "좋음", masteryMultiplier(ctx.rules, ally.mastery)) *
        thrust.share *
        (1 + thrust.powerPct) *
        (1 + chainBonus(state, ctx, ally, skill)) *
        powerMultiplier(ctx.effects, ally.effects, thrustTarget.effects, false);
      strikeEnemy(state, ctx, ally.id, thrustTarget, thrustPower, thrust.damageType ?? ally.basicAttack.damageType, thrust.staggerMultiplier, "좋음");
    }
    linkChain();
    used();
    return;
  }

  if (action.judgements.length !== skill.hitCount) throw new BattleError(`${ally.name}: ${skill.name}은(는) ${skill.hitCount}타다`);

  // 대상: 고른 적이 그사이 쓰러졌으면 같은 규칙으로 닿는 다음 적에게. 없으면 기력을 돌려주고 취소
  const candidates = reachable(standingEnemies(state), skill.reachBack ? "원거리" : skill.reach);
  let target = state.enemies.find((e) => e.id === action.targetId);
  if (!target) throw new BattleError(`없는 대상: ${action.targetId}`);
  let retargeted = false;
  // 고른 뒤에 같은 턴의 밀어내기로 줄이 바뀌어 닿지 않게 된 대상도, 쓰러진 대상처럼 다음 적에게 돌린다
  const movedAway =
    !candidates.some((e) => e.id === action.targetId) &&
    state.events.some((ev) => ev.turn === state.turn && ev.type === "밀어냄" && (ev.pushed === action.targetId || ev.pulled === action.targetId));
  if (target.down || movedAway) {
    target = candidates[0];
    retargeted = true;
    if (!target) {
      state.events.push({ turn: state.turn, type: "취소", unit: ally.id, reason: "칠 대상이 없다" });
      delete ally.chain;
      return;
    }
  } else if (!candidates.some((e) => e.id === action.targetId)) {
    throw new BattleError(`${ally.name}: ${target.name}에게 닿지 않는다`);
  }

  spend();
  const powers = skillHitPowers(state, ctx, ally, skill, target, action.judgements);

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
      // 합에서 밀려 기술이 취소되면 연계도 끊긴다
      delete ally.chain;
      used();
      return;
    }
  }

  const share = skill.othersShare ?? ctx.rules.range.othersShare[skill.range];
  const staggerShare = skill.othersStaggerShare ?? ctx.rules.range.staggerOthersShare;
  const hitList = targetsInRange(standingEnemies(state), target, skill.range);
  if (skill.alsoBehind && rowOf(target.slot) === "앞줄") {
    const behindSlot = target.slot + ROW_SIZE;
    const behind = standingEnemies(state).find((e) => e.slot === behindSlot);
    if (behind && !hitList.includes(behind)) hitList.push(behind);
  }
  const main = target;
  powers.forEach((power, index) => {
    const judgement = action.judgements[index];
    const adjusted = judgement !== undefined ? adjustJudgement(ctx.effects, ally.effects, judgement) : undefined;
    hitList.forEach((enemy) => {
      const isMain = enemy.id === main.id;
      const stagger =
        (isMain ? 1 : staggerShare) * (skill.staggerMultiplier ?? 1) * conditionalMultiplier(skill, { times: "흐트러짐 ×" }, state, ally, enemy, adjusted);
      strikeEnemy(state, ctx, ally.id, enemy, isMain ? power : power * share, skill.damageType, stagger, judgement);
    });
    // 빗나간 타에는 효과가 붙지 않는다
    if (power <= 0) return;
    const hitEffects = [...skill.effects.filter((e) => e.hits === undefined || e.hits.includes(index + 1)), ...(adjusted === "완벽" ? (skill.perfectEffects ?? []) : [])];
    for (const effect of hitEffects) {
      if (effect.to === "나") giveEffect(state, ctx, ally, effect.id, effect.amount, skill);
      else for (const enemy of hitList) if (!enemy.down) giveEffect(state, ctx, enemy, effect.id, effect.amount, skill);
    }
    // 마지막 타에 터뜨리기
    if (index === powers.length - 1 && skill.burst && !main.down) burstEffect(state, ctx, ally, main, skill.burst);
  });
  if (extraStagger > 0) reduceStagger(state, target, extraStagger);
  if (skill.push && powers.some((p) => p > 0)) pushEnemy(state, ctx, main, skill, skill.push);
  if (skill.intoEnemy) ally.exposed = { turn: state.turn, powerPct: skill.intoEnemy.powerPct };

  // 모든 타가 빗나가면 연계가 끊긴다
  if (powers.every((p) => p <= 0)) delete ally.chain;
  else linkChain();
  used();
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
    // 적진에 나가 있는 아군이 있으면 닿든 안 닿든 그 사람을 먼저 노린다
    const exposed = standingAllies(state).find((a) => a.exposed?.turn === state.turn);
    const main = exposed ?? candidates.find((a) => a.id === intent.targetId) ?? pickTarget(state, enemy.targeting, intent.reach, rng.next());
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

function strikeAlly(state: BattleState, ctx: BattleContext, enemy: EnemyUnit, intent: Intent, ally: AllyUnit, basePower: number, input: DefenseInput): void {
  if (ally.down || enemy.down) return;
  // 사기·공포·위압이 적의 위력을 바꾸고, 자세가 받는 피해를 줄인다
  const power = basePower * powerMultiplier(ctx.effects, enemy.effects, ally.effects, true) * (ally.stance?.damageTaken ?? 1);
  // 피하기는 큰 공격에만 통하고, 묶여 있으면 피할 수 없다
  const dodgeable = intent.big && canMove(ctx.effects, ally.effects);
  const defense: DefenseInput = input === "피하기 성공" && !dodgeable ? "없음" : input;
  if (defense !== "없음") state.events.push({ turn: state.turn, type: "반응", ally: ally.id, enemy: enemy.id, result: defense });
  const maxEnergy = ctx.table.energy.max;

  if (defense === "받아치기 성공") {
    // 피해 없음 + 반격 + 흐트러짐 크게. 자세를 잡았으면 그 기술의 위력으로, 아니면 기본 공격으로
    const counter = ally.stance ?? {
      power: hitPower(ctx.table, ally.basicAttack.baseHitPower, "좋음", masteryMultiplier(ctx.rules, ally.mastery)),
      damageType: ally.basicAttack.damageType,
    };
    const hits = ally.stance?.counterHits ?? 1;
    for (let i = 0; i < hits; i++) strikeEnemy(state, ctx, ally.id, enemy, counter.power, counter.damageType, ctx.rules.stagger.parryMultiplier);
    ally.energy = Math.min(maxEnergy, ally.energy + (ally.stance?.parryEnergy ?? 0));
    return;
  }
  if (defense === "피하기 성공") {
    ally.energy = Math.min(maxEnergy, ally.energy + ctx.rules.dodge.energy);
    return;
  }

  const guarded = defense === "막기 성공";
  let amount = damageOf(guarded ? power * ctx.rules.guard.damageMultiplier : power, 1, ally.defense);
  if (guarded) ally.energy = Math.min(maxEnergy, ally.energy + ctx.rules.guard.energy);
  if (amount > 0) {
    amount = Math.max(1, amount + damageTakenBonus(ctx.effects, ally.effects));
    decayEffects(ctx.effects, ally.effects, "맞을 때 −1");
  }
  hurtAlly(state, ctx, ally, amount, enemy.id, enemy.rank === "보스" && intent.range !== "단일");
  if (amount > 0 && !ally.down) for (const effect of intent.effects) giveEffect(state, ctx, ally, effect.id, effect.amount);
}

/** 아군의 체력을 깎는다. 쓰러질 한 방은 결의로 버티고, 쓰러지면 부상을 정한다 */
function hurtAlly(state: BattleState, ctx: BattleContext, ally: AllyUnit, amount: number, from: string | undefined, bossArea: boolean): void {
  if (ally.down || amount <= 0) return;
  ally.hp = Math.max(0, ally.hp - amount);
  if (from !== undefined) state.events.push({ turn: state.turn, type: "피해", from, to: ally.id, amount });
  else state.events.push({ turn: state.turn, type: "지속 피해", unit: ally.id, amount });
  if (ally.hp > 0) return;

  const left = endure(ctx.effects, ally.effects);
  if (left !== undefined) {
    ally.hp = Math.min(ally.maxHp, left);
    state.events.push({ turn: state.turn, type: "버팀", unit: ally.id });
    return;
  }
  // 중상: 보스의 광역기에 쓰러졌거나, 한 방에 최대 체력의 일정 비율 이상을 맞고 쓰러졌을 때
  const heavy = amount >= ally.maxHp * ctx.rules.injury.severeHitShare;
  ally.down = true;
  ally.injury = bossArea || heavy ? "중상" : "경상";
  state.events.push({ turn: state.turn, type: "쓰러짐", unit: ally.id, injury: ally.injury });
}

/** 턴 끝. 명세서의 순서: 지속 피해 → 효과 줄이기 → 쿨다운 → 기력 → 흐트러짐 회복 */
function endTurn(state: BattleState, ctx: BattleContext): void {
  // 1. 지속 피해: 방어와 저항을 무시하고 중첩만큼 깎는다
  for (const ally of state.allies) {
    if (ally.down || ally.fled) continue;
    hurtAlly(state, ctx, ally, ongoingDamage(ctx.effects, ally.effects), undefined, false);
  }
  for (const enemy of state.enemies) {
    if (enemy.down) continue;
    const amount = ongoingDamage(ctx.effects, enemy.effects);
    if (amount <= 0) continue;
    enemy.hp = Math.max(0, enemy.hp - amount);
    state.events.push({ turn: state.turn, type: "지속 피해", unit: enemy.id, amount });
    if (enemy.hp === 0) downEnemy(state, enemy);
  }

  for (const ally of state.allies) {
    if (ally.stance && ally.stance.untilTurn <= state.turn) delete ally.stance;
    // 적진에 나가 있던 것은 다음 턴 내 차례까지만 이어진다
    if (ally.exposed && ally.exposed.turn < state.turn) delete ally.exposed;
    if (ally.down || ally.fled) continue;
    // 2. 효과 줄이기 (신속은 줄기 전의 값으로 쿨다운에 쓰인다)
    const faster = extraCooldown(ctx.effects, ally.effects);
    decayEffects(ctx.effects, ally.effects, "턴 끝", ally.held);
    delete ally.held;
    if (ally.fleeing) {
      ally.fled = true;
      state.events.push({ turn: state.turn, type: "도망", unit: ally.id });
      continue;
    }
    // 3. 쿨다운
    for (const id of Object.keys(ally.cooldowns)) {
      const left = (ally.cooldowns[id] ?? 0) - 1 - faster;
      if (left > 0) ally.cooldowns[id] = left;
      else delete ally.cooldowns[id];
    }
    // 4. 기력
    ally.energy = Math.min(ctx.table.energy.max, ally.energy + ctx.table.energy.perTurn);
  }
  for (const enemy of state.enemies) {
    if (enemy.down) continue;
    decayEffects(ctx.effects, enemy.effects, "턴 끝", enemy.held);
    delete enemy.held;
    // 5. 흐트러진 다음 턴의 끝에 게이지가 다시 찬다
    if (enemy.brokenOnTurn !== null && enemy.brokenOnTurn < state.turn) {
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
