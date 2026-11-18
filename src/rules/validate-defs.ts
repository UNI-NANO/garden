import type { z } from "zod";
import { BattleRulesSchema, EnemyListSchema, type BattleRules, type EnemyList } from "../schema/defs/battle";
import { DungeonListSchema, type DungeonList } from "../schema/defs/dungeon";
import { CAST_ZONES, FishingDefsSchema, SeasonSchema, type FishingDefs } from "../schema/defs/fishing";
import { GatheringDefsSchema, type GatheringDefs } from "../schema/defs/gathering";
import { HuntingDefsSchema, type HuntingDefs } from "../schema/defs/hunting";
import { CraftingDefsSchema, type CraftingDefs } from "../schema/defs/crafting";
import { EffectListSchema, type EffectList } from "../schema/defs/effect";
import { ItemListSchema, type ItemList } from "../schema/defs/item";
import { LimitsSchema, type Limits } from "../schema/defs/limits";
import { MigrationSchema, type Migration } from "../schema/defs/migration";
import { TalentListSchema, type TalentList } from "../schema/defs/talent";
import type { Role, SkillSpec } from "../schema/defs/skill";
import { SkillTableSchema, type SkillTable } from "../schema/defs/skill-table";
import { TreeSchema, type Tree, type TreeNode } from "../schema/defs/tree";

/** 검사에서 나온 문제 하나: 어느 파일의 어느 칸이 왜 */
export interface DefIssue {
  file: string;
  where: string;
  message: string;
}

export interface RawDefs {
  skillTable: unknown;
  effects: unknown;
  limits: unknown;
  items: unknown;
  migration: unknown;
  talents: unknown;
  battle: unknown;
  enemies: unknown;
  /** 파일 이름 → 내용 */
  trees: Record<string, unknown>;
}

export interface Defs {
  skillTable: SkillTable;
  effects: EffectList;
  limits: Limits;
  items: ItemList;
  migration: Migration;
  talents: TalentList;
  battle: BattleRules;
  enemies: EnemyList;
  trees: Tree[];
}

export type CheckResult = { ok: true; defs: Defs } | { ok: false; issues: DefIssue[] };

const SKILL_TABLE_FILE = "skill-table.json";
const EFFECTS_FILE = "effects.json";
const LIMITS_FILE = "limits.json";
const ITEMS_FILE = "items.json";
const MIGRATION_FILE = "migration.json";
const TALENTS_FILE = "talents.json";
const BATTLE_FILE = "battle.json";
const ENEMIES_FILE = "enemies.json";

function schemaIssues(file: string, error: z.ZodError): DefIssue[] {
  return error.issues.map((issue) => ({
    file,
    where: issue.path.length > 0 ? issue.path.join(".") : "(전체)",
    message: issue.message,
  }));
}

/**
 * 정의 데이터 묶음 전체를 검사한다. 스키마(모양)를 먼저 보고, 통과하면 카드 사이의 연결과 나무 모양을 본다.
 * 문제는 처음 하나에서 멈추지 않고 모아서 돌려준다.
 */
export function checkDefs(raw: RawDefs): CheckResult {
  const issues: DefIssue[] = [];

  const table = SkillTableSchema.safeParse(raw.skillTable);
  if (!table.success) issues.push(...schemaIssues(SKILL_TABLE_FILE, table.error));

  const effects = EffectListSchema.safeParse(raw.effects);
  if (!effects.success) issues.push(...schemaIssues(EFFECTS_FILE, effects.error));

  const limits = LimitsSchema.safeParse(raw.limits);
  if (!limits.success) issues.push(...schemaIssues(LIMITS_FILE, limits.error));

  const items = ItemListSchema.safeParse(raw.items);
  if (!items.success) issues.push(...schemaIssues(ITEMS_FILE, items.error));

  const migration = MigrationSchema.safeParse(raw.migration);
  if (!migration.success) issues.push(...schemaIssues(MIGRATION_FILE, migration.error));

  const talents = TalentListSchema.safeParse(raw.talents);
  if (!talents.success) issues.push(...schemaIssues(TALENTS_FILE, talents.error));

  const battle = BattleRulesSchema.safeParse(raw.battle);
  if (!battle.success) issues.push(...schemaIssues(BATTLE_FILE, battle.error));

  const enemies = EnemyListSchema.safeParse(raw.enemies);
  if (!enemies.success) issues.push(...schemaIssues(ENEMIES_FILE, enemies.error));

  const trees: { file: string; tree: Tree }[] = [];
  for (const file of Object.keys(raw.trees).sort()) {
    const tree = TreeSchema.safeParse(raw.trees[file]);
    if (tree.success) trees.push({ file, tree: tree.data });
    else issues.push(...schemaIssues(file, tree.error));
  }

  if (!table.success || !effects.success || !limits.success || !items.success || !migration.success || !talents.success || !battle.success || !enemies.success || issues.length > 0) {
    return { ok: false, issues };
  }

  issues.push(...validateLinks(table.data, effects.data, limits.data, items.data, trees, battle.data.words));
  issues.push(...validateMigration(migration.data, items.data, talents.data));
  const knownEffects = new Set(effects.data.effects.map((e) => e.id));
  for (const effect of effects.data.effects) {
    if (effect.rule.kind !== "면역") continue;
    for (const id of effect.rule.effects) {
      if (!knownEffects.has(id)) issues.push({ file: EFFECTS_FILE, where: effect.id, message: `없는 효과를 막는다: ${id}` });
    }
  }
  const enemyIds = new Set<string>();
  for (const enemy of enemies.data.enemies) {
    if (enemyIds.has(enemy.id)) issues.push({ file: ENEMIES_FILE, where: enemy.id, message: "ID가 겹친다" });
    enemyIds.add(enemy.id);
    for (const id of [...(enemy.immune ?? []), ...enemy.actions.flatMap((a) => (a.effects ?? []).map((e) => e.id))]) {
      if (!knownEffects.has(id)) issues.push({ file: ENEMIES_FILE, where: enemy.id, message: `없는 효과를 가리킨다: ${id}` });
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, defs: {
      skillTable: table.data,
      effects: effects.data,
      limits: limits.data,
      items: items.data,
      migration: migration.data,
      talents: talents.data,
      battle: battle.data,
      enemies: enemies.data,
      trees: trees.map((t) => t.tree),
    },
  };
}

/** 환산 구간은 0에서 시작해 빈틈없이 이어지고, 옛 값이 클수록 새 값도 커야 한다 */
function validateMigration(migration: Migration, items: ItemList, talents: TalentList): DefIssue[] {
  const issues: DefIssue[] = [];
  const add = (where: string, message: string) => issues.push({ file: MIGRATION_FILE, where, message });
  const curve = migration.masteryCurve;
  curve.forEach((part, i) => {
    const where = `masteryCurve.${i}`;
    if (part.oldFrom >= part.oldTo) add(where, "옛 구간의 끝이 시작보다 커야 한다");
    if (part.newFrom > part.newTo) add(where, "새 구간의 끝이 시작보다 작다");
    const before = curve[i - 1];
    if (before === undefined) {
      if (part.oldFrom !== 0) add(where, "첫 구간은 옛 0에서 시작해야 한다");
    } else if (before.oldTo !== part.oldFrom || before.newTo !== part.newFrom) {
      add(where, "앞 구간과 빈틈없이 이어져야 한다");
    }
  });
  if (curve[curve.length - 1]?.oldTo !== 100) add("masteryCurve", "마지막 구간은 옛 100에서 끝나야 한다");

  // 재능: ID 중복
  const talentIds = new Set<string>();
  for (const talent of talents.talents) {
    if (talentIds.has(talent.id)) issues.push({ file: TALENTS_FILE, where: talent.id, message: "ID가 겹친다" });
    talentIds.add(talent.id);
  }
  const itemIds = new Set(items.items.map((item) => item.id));

  // 대응표가 가리키는 것이 실제로 있는지, 같은 옛 이름이 두 군데로 가지 않는지
  const skillIds = new Set<string>();
  const oldSkillNames = new Map<string, string>();
  const claimOld = (name: string, where: string) => {
    const before = oldSkillNames.get(name);
    if (before !== undefined) add(where, `옛 기술 「${name}」이 두 군데로 간다 (${before}에도 있음)`);
    else oldSkillNames.set(name, where);
  };
  for (const skill of migration.skills) {
    if (skillIds.has(skill.id)) add(`skills.${skill.id}`, "ID가 겹친다");
    skillIds.add(skill.id);
    for (const name of skill.from) claimOld(name, `skills.${skill.id}`);
  }
  for (const entry of migration.skillsToTalents) {
    claimOld(entry.from, `skillsToTalents.${entry.from}`);
    if (!talentIds.has(entry.talent)) add(`skillsToTalents.${entry.from}`, `없는 재능을 가리킨다: ${entry.talent}`);
  }
  for (const entry of migration.evolutionsToTalents) {
    if (!talentIds.has(entry.talent)) add(`evolutionsToTalents.${entry.from}`, `없는 재능을 가리킨다: ${entry.talent}`);
  }
  const oldItemNames = new Set<string>();
  for (const entry of migration.items) {
    if (oldItemNames.has(entry.from)) add(`items.${entry.from}`, "옛 물건 이름이 겹친다");
    oldItemNames.add(entry.from);
    if (!itemIds.has(entry.item)) add(`items.${entry.from}`, `없는 물건을 가리킨다: ${entry.item}`);
  }
  for (const [player, rule] of Object.entries(migration.characters)) {
    for (const id of rule.chosen ?? []) {
      if (!talentIds.has(id)) add(`characters.${player}`, `없는 재능을 가리킨다: ${id}`);
    }
    if (rule.innate !== undefined && !talentIds.has(rule.innate.talent)) {
      add(`characters.${player}`, `없는 재능을 가리킨다: ${rule.innate.talent}`);
    }
  }
  return issues;
}

function validateLinks(
  table: SkillTable,
  effects: EffectList,
  limits: Limits,
  items: ItemList,
  trees: { file: string; tree: Tree }[],
  words: Record<string, number>,
): DefIssue[] {
  const issues: DefIssue[] = [];
  const seen = new Map<string, string>();
  const claim = (file: string, id: string) => {
    const before = seen.get(id);
    if (before !== undefined) issues.push({ file, where: id, message: `ID가 겹친다 (${before}에도 있음)` });
    else seen.set(id, file);
  };

  claim(SKILL_TABLE_FILE, table.id);
  claim(EFFECTS_FILE, effects.id);
  claim(LIMITS_FILE, limits.id);
  claim(ITEMS_FILE, items.id);
  for (const item of items.items) claim(ITEMS_FILE, item.id);

  const add = (file: string, where: string, message: string) => issues.push({ file, where, message });
  const { abilities, month, exchange } = limits;
  if (abilities.min > abilities.max) add(LIMITS_FILE, "abilities", "min이 max보다 크다");
  if (abilities.initial < abilities.min || abilities.initial > abilities.max) {
    add(LIMITS_FILE, "abilities.initial", "처음 값이 범위 밖이다");
  }
  if (month.savedActionsMax < 0 || month.mainActions < 0) add(LIMITS_FILE, "month", "행동 수는 0 이상이어야 한다");
  if (exchange.maxWalletGainPerChange > exchange.walletMax) {
    add(LIMITS_FILE, "exchange.maxWalletGainPerChange", "한 번에 느는 양이 지갑 최대보다 크다");
  }
  if (exchange.maxQuantityGainPerChange > exchange.maxStackQuantity) {
    add(LIMITS_FILE, "exchange.maxQuantityGainPerChange", "한 번에 느는 양이 묶음 최대보다 크다");
  }
  if (limits.loadout.basics !== table.tree.equippedBasics) {
    add(LIMITS_FILE, "loadout.basics", `기준표의 들고 가는 기본기 수(${table.tree.equippedBasics})와 다르다`);
  }

  const effectIds = new Set<string>();
  for (const effect of effects.effects) {
    claim(EFFECTS_FILE, effect.id);
    effectIds.add(effect.id);
  }

  for (const { file, tree } of trees) {
    const add = (where: string, message: string) => issues.push({ file, where, message });

    claim(file, tree.id);
    claim(file, tree.basicAttack.id);
    for (const variant of tree.basicAttack.variants) claim(file, variant.id);
    for (const root of tree.roots) {
      claim(file, root.id);
      for (const slot of root.slots) claim(file, slot.id);
    }
    for (const node of tree.nodes) claim(file, node.id);

    const checkSkill = (where: string, skill: SkillSpec) => {
      const hitCount = skill.hits === "자세" ? 1 : skill.hits;
      for (const effect of skill.effects) {
        if (!effectIds.has(effect.id)) add(where, `없는 효과를 가리킨다: ${effect.id}`);
        for (const hit of effect.hits ?? []) if (hit > hitCount) add(where, `${hit}번째 타에 효과를 붙였는데 ${hitCount}타 기술이다`);
      }
    };

    // 기본 공격
    checkSkill(tree.basicAttack.id, tree.basicAttack.skill);
    if (tree.basicAttack.skill.tier !== "기본 공격") add(tree.basicAttack.id, "기본 공격의 단계는 「기본 공격」이어야 한다");

    // 뿌리
    if (tree.roots.length !== table.tree.rootsPerTree) {
      add("roots", `뿌리는 ${table.tree.rootsPerTree}갈래여야 한다 (지금 ${tree.roots.length})`);
    }
    for (const root of tree.roots) {
      if (root.slots.length !== table.tree.slotsPerRoot) {
        add(root.id, `뿌리 한 갈래는 ${table.tree.slotsPerRoot}칸이어야 한다 (지금 ${root.slots.length})`);
      }
    }

    issues.push(...validateNodes(file, tree, table, checkSkill, words, effectIds));
    issues.push(...validateStem(file, tree, table));
  }
  return issues;
}

/** 숫자 자리에 말을 적을 수 있는 규칙들 */
/** 말이 들어갈 수 있는 항목이 아닌 것: 종류, 효과 ID, 조건, 타, 피해 종류 */
const NOT_AMOUNT_KEYS = new Set(["kind", "effect", "when", "hit", "damageType", "row"]);

function validateNodes(
  file: string,
  tree: Tree,
  table: SkillTable,
  checkSkill: (where: string, skill: SkillSpec) => void,
  words: Record<string, number>,
  effectIds: ReadonlySet<string>,
): DefIssue[] {
  const issues: DefIssue[] = [];
  const add = (where: string, message: string) => issues.push({ file, where, message });

  const byId = new Map<string, TreeNode>();
  for (const node of tree.nodes) if (!byId.has(node.id)) byId.set(node.id, node);
  const children = new Map<string, TreeNode[]>();
  const basics: TreeNode[] = [];
  let linksOk = true;

  for (const node of tree.nodes) {
    // 칸 종류에 맞는 칸만 채웠는지
    const isFork = node.kind === "갈림길" || node.kind === "끝갈래";
    if (node.kind === "기본기") {
      if (node.skill === undefined) add(node.id, "기본기에는 skill이 있어야 한다");
      else {
        checkSkill(node.id, node.skill);
        if (node.skill.tier === "기본 공격" || node.skill.tier === "궁극기") {
          add(node.id, `기본기의 단계는 1~3단계여야 한다 (지금 ${node.skill.tier})`);
        }
      }
    } else if (node.kind === "궁극기") {
      if (node.skill === undefined) add(node.id, "궁극기에는 skill이 있어야 한다");
      else {
        checkSkill(node.id, node.skill);
        if (node.skill.tier !== "궁극기") add(node.id, `궁극기의 단계는 궁극기여야 한다 (지금 ${node.skill.tier})`);
      }
    } else if (node.skill !== undefined) add(node.id, "skill은 기본기와 궁극기에만 적는다");
    if (isFork) {
      if (node.hidden !== true && node.axis === undefined) add(node.id, "갈림길·끝갈래에는 axis가 있어야 한다");
      if (node.axis !== undefined && !table.tree.axes.includes(node.axis)) add(node.id, `기준표에 없는 축: ${node.axis}`);
    } else {
      if (node.axis !== undefined) add(node.id, "axis는 갈림길·끝갈래에만 적는다");
      if (node.hidden !== undefined) add(node.id, "hidden은 갈림길·끝갈래에만 적는다");
      if (node.overrides !== undefined) add(node.id, "overrides는 갈림길·끝갈래에만 적는다");
    }
    if (node.kind !== "보완" && node.choice !== undefined) add(node.id, "choice는 보완 칸에만 적는다");
    if (node.choice !== undefined && node.mods !== undefined) add(node.id, "mods와 choice를 함께 적을 수 없다 (고르는 칸이면 choice 안에 적는다)");
    // 규칙이 가리키는 말과 효과가 실제로 있는지
    for (const mod of [...(node.mods ?? []), ...(node.choice ?? []).flatMap((option) => option.mods ?? [])]) {
      for (const [key, value] of Object.entries(mod)) {
        if (typeof value === "string" && !NOT_AMOUNT_KEYS.has(key) && !(value in words)) {
          add(node.id, `기준값에 없는 말: ${value}`);
        }
      }
      const ids = "effect" in mod ? [typeof mod.effect === "string" ? mod.effect : mod.effect.id] : "effects" in mod ? mod.effects.map((e) => e.id) : [];
      for (const id of ids) if (!effectIds.has(id)) add(node.id, `없는 효과를 가리킨다: ${id}`);
    }

    // 앞 칸
    if (node.kind === "기본기") {
      if (node.prev !== null) add(node.id, "기본기는 앞 칸이 없어야 한다 (prev: null)");
      basics.push(node);
    } else if (node.prev === null) {
      add(node.id, "기본기가 아닌 칸은 앞 칸이 있어야 한다");
      linksOk = false;
    } else if (!byId.has(node.prev)) {
      add(node.id, `없는 앞 칸을 가리킨다: ${node.prev}`);
      linksOk = false;
    } else if (node.prev === node.id) {
      add(node.id, "앞 칸이 자기 자신이다");
      linksOk = false;
    } else {
      const list = children.get(node.prev) ?? [];
      list.push(node);
      children.set(node.prev, list);
    }
  }

  if (basics.length !== table.tree.basicsPerTree) {
    add("nodes", `기본기는 ${table.tree.basicsPerTree}개여야 한다 (지금 ${basics.length})`);
  }
  // 앞 칸이 끊겼으면 모양 검사는 뜻이 없다
  if (!linksOk) return issues;

  // 기본기에서 닿지 않는 칸 (서로 돌고 도는 칸 포함)
  const reached = new Set<string>();
  const pattern = table.tree.routePattern;
  const usedAxes = new Map<string, string>();
  /** 기본기 ID → 갈래를 어떻게 찍느냐에 따라 가질 수 있는 연계 역할 (숨은 갈래 제외) */
  const rolesByBasic = new Map<string, Set<Role>>();

  const walk = (node: TreeNode, depth: number, basicId: string, roleBefore: Role | undefined, underHidden: boolean) => {
    reached.add(node.id);
    // 숨은 갈래와 그 아래는 누구나 갈 수 있는 길이 아니므로 역할 계산에서 뺀다
    const hiddenPath = underHidden || node.hidden === true;
    const role = node.skill?.role ?? node.overrides?.role ?? roleBefore;
    if (role !== undefined && !hiddenPath) {
      const roles = rolesByBasic.get(basicId) ?? new Set<Role>();
      roles.add(role);
      rolesByBasic.set(basicId, roles);
    }
    const expected = pattern[depth];
    if (expected === undefined) {
      add(node.id, `루트가 ${pattern.length}칸보다 길다`);
      return;
    }
    if (node.kind !== expected) add(node.id, `루트의 ${depth + 1}번째 칸은 「${expected}」이어야 한다 (지금 ${node.kind})`);

    const next = children.get(node.id) ?? [];
    if (next.length === 0) {
      if (depth !== pattern.length - 1) add(node.id, `루트가 여기서 끊긴다 (${depth + 1}칸째, 끝까지 ${pattern.length}칸)`);
      return;
    }
    const forks = next.filter((n) => n.kind === "갈림길" || n.kind === "끝갈래");
    if (forks.length === 0) {
      if (next.length > 1) add(node.id, `뒤 칸이 ${next.length}개다. 갈림길이 아니면 하나여야 한다`);
    } else if (forks.length !== next.length) {
      add(node.id, "뒤 칸에 갈림길과 다른 종류가 섞여 있다");
    } else {
      const open = forks.filter((n) => n.hidden !== true);
      const hidden = forks.filter((n) => n.hidden === true);
      if (open.length !== 2) add(node.id, `갈림길은 둘 중 하나여야 한다 (지금 ${open.length}개)`);
      if (hidden.length > 1) add(node.id, `숨은 선택지는 하나까지다 (지금 ${hidden.length}개)`);
      const axes = new Set(open.map((n) => n.axis));
      if (axes.size > 1) add(node.id, `같은 갈림길의 두 쪽은 같은 축이어야 한다 (${[...axes].join(" ↔ ")})`);
      const axis = open[0]?.axis;
      if (axes.size === 1 && axis !== undefined) {
        const before = usedAxes.get(axis);
        if (before !== undefined) add(node.id, `한 나무에서 같은 축을 두 번 썼다: ${axis} (${before} 뒤에도 있음)`);
        else usedAxes.set(axis, node.id);
      }
    }
    for (const child of next) walk(child, depth + 1, basicId, role, hiddenPath);
  };
  for (const basic of basics) walk(basic, 0, basic.id, undefined, false);

  for (const node of tree.nodes) {
    if (!reached.has(node.id)) add(node.id, "어느 기본기에서도 닿지 않는 칸이다 (앞 칸이 돌고 돈다)");
  }

  if (issues.length === 0) issues.push(...validateRoleCoverage(file, basics, rolesByBasic, table));
  return issues;
}

/** 어떤 기본기 묶음(전투에 드는 수만큼)을 골라도 연계 역할을 모두 갖출 갈래 조합이 있는지 */
function validateRoleCoverage(
  file: string,
  basics: TreeNode[],
  rolesByBasic: Map<string, Set<Role>>,
  table: SkillTable,
): DefIssue[] {
  const issues: DefIssue[] = [];
  const need = table.tree.roles;
  const size = table.tree.equippedBasics;

  /** 고른 기본기마다 역할 하나씩 정해서 need를 모두 채울 수 있는가 */
  const canCover = (picked: TreeNode[], index: number, have: ReadonlySet<Role>): boolean => {
    if (need.every((role) => have.has(role))) return true;
    const basic = picked[index];
    if (basic === undefined) return false;
    for (const role of rolesByBasic.get(basic.id) ?? []) {
      if (canCover(picked, index + 1, new Set([...have, role]))) return true;
    }
    return false;
  };

  const pick = (start: number, picked: TreeNode[]) => {
    if (picked.length === size) {
      if (!canCover(picked, 0, new Set())) {
        issues.push({
          file,
          where: picked.map((b) => b.id).join(" + "),
          message: `이 기본기 ${size}개로는 어떤 갈래를 골라도 ${need.join("·")}을 모두 갖출 수 없다`,
        });
      }
      return;
    }
    for (let i = start; i < basics.length; i++) {
      const basic = basics[i];
      if (basic !== undefined) pick(i + 1, [...picked, basic]);
    }
  };
  pick(0, []);
  return issues;
}

function validateStem(file: string, tree: Tree, table: SkillTable): DefIssue[] {
  const issues: DefIssue[] = [];
  const add = (where: string, message: string) => issues.push({ file, where, message });

  const thresholds = tree.stem.map((step) => step.mastery);
  if (thresholds.join(",") !== table.tree.stemThresholds.join(",")) {
    add("stem", `줄기 문턱은 ${table.tree.stemThresholds.join(", ")}이어야 한다 (지금 ${thresholds.join(", ")})`);
  }

  // 줄기에서 열려야 하는 것: 기본 공격, 그 변형 둘, 기본기 전부. 하나도 빠지거나 두 번 나오면 안 된다.
  const mustUnlock = new Set<string>([
    tree.basicAttack.id,
    ...tree.basicAttack.variants.map((v) => v.id),
    ...tree.nodes.filter((n) => n.kind === "기본기").map((n) => n.id),
  ]);
  const unlocked = new Set<string>();
  for (const step of tree.stem) {
    for (const id of step.unlocks) {
      if (!mustUnlock.has(id)) add(`stem.${step.mastery}`, `줄기에서 열 수 없는 것을 가리킨다: ${id}`);
      else if (unlocked.has(id)) add(`stem.${step.mastery}`, `줄기에서 두 번 열린다: ${id}`);
      unlocked.add(id);
    }
  }
  for (const id of mustUnlock) if (!unlocked.has(id)) add("stem", `줄기 어디에서도 열리지 않는다: ${id}`);
  return issues;
}

const DUNGEONS_FILE = "dungeons.json";

/**
 * 던전 카드 검사: 모양, 그리고 적·물건 연결.
 * 정예 무리에는 정예 적이, 보스 무리에는 보스 적이 있어야 하고, 한 무리 안의 칸은 겹치지 않는다.
 */
export function checkDungeons(raw: unknown, defs: { enemies: EnemyList; items: ItemList }): { ok: true; dungeons: DungeonList } | { ok: false; issues: DefIssue[] } {
  const parsed = DungeonListSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: schemaIssues(DUNGEONS_FILE, parsed.error) };
  const issues: DefIssue[] = [];
  const enemies = new Map(defs.enemies.enemies.map((e) => [e.id, e]));
  const items = new Set(defs.items.items.map((i) => i.id));
  const ids = new Set<string>();
  for (const dungeon of parsed.data.dungeons) {
    const add = (where: string, message: string) => issues.push({ file: DUNGEONS_FILE, where: `${dungeon.id}.${where}`, message });
    if (ids.has(dungeon.id)) add("id", "ID가 겹친다");
    ids.add(dungeon.id);
    dungeon.floors.forEach((floor, i) => {
      // 시작·쉼터·끝방은 꼭 있어야 한다
      if (floor.rooms.min < 3) add(`floors.${i}`, "방은 셋 이상 (시작·쉼터·끝)");
    });
    for (const rank of ["일반", "정예", "보스"] as const) {
      dungeon.groups[rank].forEach((group, g) => {
        const slots = new Set<number>();
        for (const member of group.enemies) {
          const enemy = enemies.get(member.enemy);
          if (!enemy) add(`groups.${rank}.${g}`, `없는 적: ${member.enemy}`);
          if (slots.has(member.slot)) add(`groups.${rank}.${g}`, `칸 ${member.slot}이 겹친다`);
          slots.add(member.slot);
        }
        if (rank !== "일반" && !group.enemies.some((m) => enemies.get(m.enemy)?.rank === rank)) add(`groups.${rank}.${g}`, `${rank} 무리에 ${rank} 적이 없다`);
        if (group.minFloor !== undefined && group.minFloor > dungeon.floors.length) add(`groups.${rank}.${g}`, "없는 층부터 나온다");
      });
      if (rank === "일반" && !dungeon.groups.일반.some((g) => (g.minFloor ?? 1) === 1)) add("groups.일반", "첫 층에 나올 무리가 없다");
    }
    const lootItems = [
      ...Object.values(dungeon.loot).flatMap((table) => table.entries),
      ...dungeon.firstClear,
    ].flatMap((entry) => (entry.kind === "물건" ? [entry.item] : []));
    for (const item of lootItems) if (!items.has(item)) add("loot", `없는 물건: ${item}`);
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, dungeons: parsed.data };
}

const FISHING_FILE = "fishing.json";

/** 낚시 검사: 모양, 구역마다 모든 계절에 나오는 고기가 있는지, 물고기가 묶음 물건인지, 구역 경계 순서 */
export function checkFishing(raw: unknown, defs: { items: ItemList }): { ok: true; fishing: FishingDefs } | { ok: false; issues: DefIssue[] } {
  const parsed = FishingDefsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: schemaIssues(FISHING_FILE, parsed.error) };
  const issues: DefIssue[] = [];
  const items = new Map(defs.items.items.map((i) => [i.id, i]));
  const { rules } = parsed.data;
  if (rules.zoneEdges[0] >= rules.zoneEdges[1]) issues.push({ file: FISHING_FILE, where: "rules.zoneEdges", message: "구역 경계는 커지는 순서여야 한다" });
  if (rules.startDistance.max >= rules.lineLength) issues.push({ file: FISHING_FILE, where: "rules.startDistance", message: "시작 거리는 줄 길이보다 짧아야 한다" });
  const ids = new Set<string>();
  for (const spot of parsed.data.spots) {
    if (ids.has(spot.id)) issues.push({ file: FISHING_FILE, where: spot.id, message: "ID가 겹친다" });
    ids.add(spot.id);
    for (const zone of CAST_ZONES) {
      const fishes = spot.zones[zone];
      for (const season of SeasonSchema.options) {
        if (!fishes.some((f) => f.seasons.includes(season))) issues.push({ file: FISHING_FILE, where: `${spot.id}.${zone}`, message: `${season}에 나오는 고기가 없다` });
      }
      for (const fish of fishes) {
        const item = items.get(fish.item);
        if (!item) issues.push({ file: FISHING_FILE, where: `${spot.id}.${zone}`, message: `없는 물건: ${fish.item}` });
        else if (item.kind !== "묶음") issues.push({ file: FISHING_FILE, where: `${spot.id}.${zone}`, message: `물고기는 묶음 물건이어야 한다: ${fish.item}` });
      }
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, fishing: parsed.data };
}

const GATHERING_FILE = "gathering.json";

/** 채집 검사: 모양, 독초는 잎 뒤가 늘 다르고, 계절마다 나올 약초(독초 짝이 있는)가 있고, 약초가 묶음 물건인지 */
export function checkGathering(raw: unknown, defs: { items: ItemList }): { ok: true; gathering: GatheringDefs } | { ok: false; issues: DefIssue[] } {
  const parsed = GatheringDefsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: schemaIssues(GATHERING_FILE, parsed.error) };
  const issues: DefIssue[] = [];
  const items = new Map(defs.items.items.map((i) => [i.id, i]));
  const ids = new Set<string>();
  for (const spot of parsed.data.spots) {
    const add = (where: string, message: string) => issues.push({ file: GATHERING_FILE, where: `${spot.id}.${where}`, message });
    if (ids.has(spot.id)) add("id", "ID가 겹친다");
    ids.add(spot.id);
    for (const herb of spot.herbs) {
      const item = items.get(herb.item);
      if (!item) add(herb.item, "없는 물건");
      else if (item.kind !== "묶음") add(herb.item, "약초는 묶음 물건이어야 한다");
      if (herb.lookalike && herb.lookalike.tells.back === herb.tells.back) add(herb.item, "닮은 독초는 잎 뒤가 달라야 한다 (잎 뒤 보기로 가려낼 수 있게)");
    }
    for (const season of SeasonSchema.options) {
      if (!spot.herbs.some((h) => h.lookalike !== undefined && h.seasons.includes(season))) add("herbs", `${season}에 나올 약초가 없다`);
    }
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, gathering: parsed.data };
}

const HUNTING_FILE = "hunting.json";

/** 사냥 검사: 모양, 물건·적 연결, 계절마다 나올 짐승 */
export function checkHunting(raw: unknown, defs: { items: ItemList; enemies: EnemyList }): { ok: true; hunting: HuntingDefs } | { ok: false; issues: DefIssue[] } {
  const parsed = HuntingDefsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: schemaIssues(HUNTING_FILE, parsed.error) };
  const issues: DefIssue[] = [];
  const items = new Map(defs.items.items.map((i) => [i.id, i]));
  const enemies = new Set(defs.enemies.enemies.map((e) => e.id));
  const { rules } = parsed.data;
  if (rules.distance.min > rules.distance.start) issues.push({ file: HUNTING_FILE, where: "rules.distance", message: "가장 가까운 거리가 처음 거리보다 멀다" });
  if (rules.paths.max > 4) issues.push({ file: HUNTING_FILE, where: "rules.paths", message: "길은 방향 넷보다 많을 수 없다" });
  for (const ground of parsed.data.grounds) {
    const add = (where: string, message: string) => issues.push({ file: HUNTING_FILE, where: `${ground.id}.${where}`, message });
    for (const prey of ground.prey) {
      for (const drop of prey.drops) {
        const item = items.get(drop.item);
        if (!item) add(prey.id, `없는 물건: ${drop.item}`);
        else if (item.kind !== "묶음") add(prey.id, `얻는 것은 묶음 물건이어야 한다: ${drop.item}`);
      }
      for (const member of prey.danger?.enemies ?? []) if (!enemies.has(member.enemy)) add(prey.id, `없는 적: ${member.enemy}`);
    }
    for (const season of SeasonSchema.options) if (!ground.prey.some((p) => p.seasons.includes(season))) add("prey", `${season}에 나올 짐승이 없다`);
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, hunting: parsed.data };
}

const CRAFTING_FILE = "crafting.json";

/**
 * 제작 검사: 모양, 레시피의 작업장·물건 연결, 재료는 묶음 물건, 작업장마다 처음부터 아는 레시피가 하나 이상,
 * 같은 작업장에 재료 종류가 똑같은 레시피가 둘이면 조합 시도가 어느 것인지 모르므로 막는다.
 */
export function checkCrafting(raw: unknown, defs: { items: ItemList }): { ok: true; crafting: CraftingDefs } | { ok: false; issues: DefIssue[] } {
  const parsed = CraftingDefsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: schemaIssues(CRAFTING_FILE, parsed.error) };
  const issues: DefIssue[] = [];
  const add = (where: string, message: string) => issues.push({ file: CRAFTING_FILE, where, message });
  const items = new Map(defs.items.items.map((i) => [i.id, i]));
  const stations = new Set(parsed.data.stations.map((s) => s.id));
  const ids = new Set<string>();
  const sets = new Map<string, string>();
  for (const recipe of parsed.data.recipes) {
    if (ids.has(recipe.id)) add(recipe.id, "ID가 겹친다");
    ids.add(recipe.id);
    if (!stations.has(recipe.station)) add(recipe.id, `없는 작업장: ${recipe.station}`);
    for (const input of recipe.inputs) {
      const item = items.get(input.item);
      if (!item) add(recipe.id, `없는 물건: ${input.item}`);
      else if (item.kind !== "묶음") add(recipe.id, `재료는 묶음 물건이어야 한다: ${input.item}`);
    }
    if (new Set(recipe.inputs.map((i) => i.item)).size !== recipe.inputs.length) add(recipe.id, "같은 재료가 두 번 적혀 있다");
    if (!items.has(recipe.output.item)) add(recipe.id, `없는 결과 물건: ${recipe.output.item}`);
    const key = `${recipe.station}|${recipe.inputs.map((i) => i.item).sort().join(",")}`;
    const other = sets.get(key);
    if (other) add(recipe.id, `${other}와 재료 종류가 같다 (조합 시도로 가릴 수 없다)`);
    sets.set(key, recipe.id);
  }
  for (const station of parsed.data.stations) {
    if (!parsed.data.recipes.some((r) => r.station === station.id && r.known)) add(station.id, "처음부터 아는 레시피가 없다");
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, crafting: parsed.data };
}
