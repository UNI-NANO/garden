import type { Reach } from "../../schema/defs/battle";
import type { Effect } from "../../schema/defs/effect";
import type { SkillTable } from "../../schema/defs/skill-table";
import type { Amount, Mod, Tree } from "../../schema/defs/tree";
import type { BattleSkill } from "./engine";
import { battleSkillOf } from "./setup";

export class BuildSkillError extends Error {
  override name = "BuildSkillError";
}

/** 숫자 또는 말을 숫자로. 말은 전투 기준값의 words에서 읽는다 */
export function resolveAmount(words: Readonly<Record<string, number>>, amount: Amount): number {
  if (typeof amount === "number") return amount;
  const value = words[amount];
  if (value === undefined) throw new BuildSkillError(`기준값에 없는 말: ${amount}`);
  return value;
}

/** 캐릭터가 한 나무에서 찍은 것 */
export interface PickedNodes {
  /** 찍은 칸의 ID */
  picked: ReadonlySet<string>;
  /** 고르는 보완 칸에서 고른 쪽: 칸 ID → 0 또는 1 */
  choices: Readonly<Record<string, 0 | 1>>;
}

/**
 * 기본기 하나와 그 루트에서 찍은 칸들로 전투용 기술을 만든다.
 * 기본기의 숫자(기술 기준표)에서 시작해, 찍은 칸의 규칙을 뿌리에서 가까운 순서로 적용한다.
 * 궁극기는 따로 드는 기술이라 여기서는 건너뛴다.
 */
export function buildSkill(
  table: SkillTable,
  effects: readonly Effect[],
  words: Readonly<Record<string, number>>,
  tree: Tree,
  basicId: string,
  state: PickedNodes,
  reach: Reach,
): BattleSkill {
  const basic = tree.nodes.find((node) => node.id === basicId && node.kind === "기본기");
  if (!basic?.skill) throw new BuildSkillError(`기본기가 아니다: ${basicId}`);
  const skill: BattleSkill = battleSkillOf(table, effects, { id: basic.id, name: basic.name, skill: basic.skill }, reach);
  const amount = (value: Amount) => resolveAmount(words, value);

  let powerPct = 0;
  let powerMul = 1;
  let energy = skill.energy;
  let cooldown = skill.cooldown;

  const apply = (mod: Mod) => {
    switch (mod.kind) {
      case "위력 +":
      case "위력 ×":
      case "흐트러짐 ×":
      case "좋음 칸": {
        const value = amount(mod.amount);
        const hit = "hit" in mod ? mod.hit : undefined;
        if (mod.when !== undefined || hit !== undefined) {
          (skill.conditional ??= []).push({ kind: mod.kind, amount: value, ...(mod.when !== undefined ? { when: mod.when } : {}), ...(hit !== undefined ? { hit } : {}) });
        }
        else if (mod.kind === "위력 +") powerPct += value;
        else if (mod.kind === "위력 ×") powerMul *= value;
        else if (mod.kind === "흐트러짐 ×") skill.staggerMultiplier = (skill.staggerMultiplier ?? 1) * value;
        else skill.goodWidth = (skill.goodWidth ?? 0) + value;
        return;
      }
      case "완벽 칸":
        skill.perfectWidth = (skill.perfectWidth ?? 0) + amount(mod.amount);
        return;
      case "기력":
        if (mod.when !== undefined) (skill.conditionalEnergy ??= []).push({ add: mod.add, when: mod.when });
        else energy += mod.add;
        return;
      case "쿨다운":
        if (mod.when !== undefined) (skill.conditionalCooldown ??= []).push({ add: mod.add, when: mod.when });
        else cooldown += mod.add;
        return;
      case "타수":
        (skill.extraHits ??= []).push({ add: mod.add, ...(mod.when !== undefined ? { when: mod.when } : {}) });
        return;
      case "연계 보너스":
        skill.chainBonusAdd = (skill.chainBonusAdd ?? 0) + amount(mod.amount);
        return;
      case "끈질김":
        skill.persistence = { perTurn: amount(mod.perTurn), max: amount(mod.max) };
        return;
      case "끈질김 최대":
        if (!skill.persistence) throw new BuildSkillError(`${skill.name}: 끈질김이 없는데 끈질김 최대를 바꾸려 한다`);
        skill.persistence.max += amount(mod.amount);
        return;
      case "맞히면 기력":
        (skill.onHitEnergy ??= []).push({ add: mod.add, ...(mod.when !== undefined ? { when: mod.when } : {}) });
        return;
      case "쓰러뜨리면 쿨다운":
        (skill.onDown ??= {}).cooldownMultiply = mod.multiply;
        return;
      case "쓰러뜨리면 기력":
        (skill.onDown ??= {}).energy = (skill.onDown.energy ?? 0) + mod.add;
        return;
      case "생포":
        skill.capture ??= { rewardBonus: 0 };
        return;
      case "생포 보상":
        if (!skill.capture) throw new BuildSkillError(`${skill.name}: 생포가 없는데 생포 보상을 바꾸려 한다`);
        skill.capture.rewardBonus += amount(mod.amount);
        return;
      case "효과 ×":
        (skill.effectMultipliers ??= []).push({ effect: mod.effect, amount: amount(mod.amount), ...(mod.when !== undefined ? { when: mod.when } : {}) });
        return;
      case "효과":
        if (mod.when === "완벽") (skill.perfectEffects ??= []).push(mod.effect);
        else skill.effects = [...skill.effects, mod.effect];
        return;
      case "효과 교체":
        skill.effects = [...mod.effects];
        return;
      case "효과 유지":
        (skill.holdEffects ??= []).push(mod.effect);
        return;
      case "효과 상한":
        (skill.effectCapBonus ??= {})[mod.effect] = (skill.effectCapBonus[mod.effect] ?? 0) + amount(mod.add);
        return;
      case "터뜨리기":
        skill.burst = { effect: mod.effect, perStackPct: 0, keepShare: 0, toStagger: false, perfectMultiplier: 1, loseOnMiss: false, ...skill.burst };
        return;
      case "터뜨리기 강화":
        burstOf(skill).perStackPct += amount(mod.perStack);
        return;
      case "터뜨리기 남김":
        burstOf(skill).keepShare = mod.share;
        return;
      case "터뜨리기 흐트러짐":
        burstOf(skill).toStagger = true;
        return;
      case "터뜨리기 완벽":
        burstOf(skill).perfectMultiplier = amount(mod.amount);
        return;
      case "터뜨리기 빗나감":
        burstOf(skill).loseOnMiss = true;
        return;
      case "나머지 대상":
        skill.othersShare = mod.share;
        return;
      case "나머지 흐트러짐":
        skill.othersStaggerShare = mod.share;
        return;
      case "뒤 칸도":
        skill.alsoBehind = true;
        return;
      case "밀어내기":
        skill.push ??= { pushedEffects: [], pulledEffects: [] };
        return;
      case "밀려난 적 효과":
        pushOf(skill).pushedEffects.push(mod.effect);
        return;
      case "끌려 나온 적 효과":
        pushOf(skill).pulledEffects.push(mod.effect);
        return;
      case "밀어내기 없음":
        delete skill.push;
        return;
      case "끌려 나온 적 치기": {
        const push = pushOf(skill);
        push.strikePulled = { powerPct: (push.strikePulled?.powerPct ?? 0) + (mod.power !== undefined ? amount(mod.power) : 0) };
        return;
      }
      case "뒷줄까지":
        skill.reachBack = { multiplier: amount(mod.amount) };
        return;
      case "적진으로":
        skill.intoEnemy = { powerPct: amount(mod.amount) };
        return;
      case "자세": {
        const opts = (skill.stanceOpts ??= {});
        if (mod.damageTaken !== undefined) opts.damageTaken = (opts.damageTaken ?? 1) * amount(mod.damageTaken);
        if (mod.parryWidth !== undefined) opts.parryWidth = (opts.parryWidth ?? 0) + amount(mod.parryWidth);
        if (mod.parryEnergy !== undefined) opts.parryEnergy = (opts.parryEnergy ?? 0) + mod.parryEnergy;
        if (mod.holdTurns !== undefined) opts.holdTurns = (opts.holdTurns ?? 0) + mod.holdTurns;
        if (mod.counterHits !== undefined) opts.counterHits = mod.counterHits;
        return;
      }
      case "자세 찌르기":
        (skill.stanceOpts ??= {}).thrust = { share: amount(mod.amount), powerPct: 0, staggerMultiplier: 1, ...skill.stanceOpts.thrust };
        return;
      case "찌르기 효과":
        (thrustOf(skill).effects ??= []).push(mod.effect);
        return;
      case "받아치면 효과":
        ((skill.stanceOpts ??= {}).parryEffects ??= []).push(mod.effect);
        return;
      case "자세 중 효과":
        ((skill.stanceOpts ??= {}).turnEndEffects ??= []).push(mod.effect);
        return;
      case "대신 받기": {
        const opts = (skill.stanceOpts ??= {});
        opts.cover = { damageTaken: (opts.cover?.damageTaken ?? 1) * (mod.damageTaken !== undefined ? amount(mod.damageTaken) : 1) };
        return;
      }
      case "찌르기": {
        const thrust = thrustOf(skill);
        if (mod.power !== undefined) thrust.powerPct += amount(mod.power);
        if (mod.damageType !== undefined) thrust.damageType = mod.damageType;
        if (mod.stagger !== undefined) thrust.staggerMultiplier *= amount(mod.stagger);
        return;
      }
    }
  };

  // 나무의 칸은 앞 칸이 먼저 오도록 적혀 있다. 갈림길은 한쪽만 찍을 수 있으므로 찍은 칸들은 한 줄을 이룬다
  for (const node of tree.nodes) {
    if (node.id === basicId || !node.id.startsWith(`${basicId}.`) || !state.picked.has(node.id) || node.kind === "궁극기") continue;
    if (node.overrides?.role) skill.role = node.overrides.role;
    if (node.overrides?.damageType) skill.damageType = node.overrides.damageType;
    if (node.overrides?.range) skill.range = node.overrides.range;
    const mods = node.choice ? (node.choice[state.choices[node.id] ?? 0].mods ?? []) : (node.mods ?? []);
    for (const mod of mods) apply(mod);
  }

  skill.baseHitPower = skill.baseHitPower * (1 + powerPct) * powerMul;
  skill.energy = Math.max(0, energy);
  skill.cooldown = Math.max(0, cooldown);
  return skill;
}

function burstOf(skill: BattleSkill) {
  if (!skill.burst) throw new BuildSkillError(`${skill.name}: 터뜨리기가 없는데 터뜨리기를 바꾸려 한다`);
  return skill.burst;
}
function pushOf(skill: BattleSkill) {
  if (!skill.push) throw new BuildSkillError(`${skill.name}: 밀어내기가 없는데 밀어내기를 바꾸려 한다`);
  return skill.push;
}
function thrustOf(skill: BattleSkill) {
  const thrust = skill.stanceOpts?.thrust;
  if (!thrust) throw new BuildSkillError(`${skill.name}: 자세 찌르기가 없는데 찌르기를 바꾸려 한다`);
  return thrust;
}
