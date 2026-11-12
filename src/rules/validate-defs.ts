import type { z } from "zod";
import { EffectListSchema, type EffectList } from "../schema/defs/effect";
import { ItemListSchema, type ItemList } from "../schema/defs/item";
import { LimitsSchema, type Limits } from "../schema/defs/limits";
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
  /** 파일 이름 → 내용 */
  trees: Record<string, unknown>;
}

export interface Defs {
  skillTable: SkillTable;
  effects: EffectList;
  limits: Limits;
  items: ItemList;
  trees: Tree[];
}

export type CheckResult = { ok: true; defs: Defs } | { ok: false; issues: DefIssue[] };

const SKILL_TABLE_FILE = "skill-table.json";
const EFFECTS_FILE = "effects.json";
const LIMITS_FILE = "limits.json";
const ITEMS_FILE = "items.json";

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

  const trees: { file: string; tree: Tree }[] = [];
  for (const file of Object.keys(raw.trees).sort()) {
    const tree = TreeSchema.safeParse(raw.trees[file]);
    if (tree.success) trees.push({ file, tree: tree.data });
    else issues.push(...schemaIssues(file, tree.error));
  }

  if (!table.success || !effects.success || !limits.success || !items.success || issues.length > 0) {
    return { ok: false, issues };
  }

  issues.push(...validateLinks(table.data, effects.data, limits.data, items.data, trees));
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, defs: {
      skillTable: table.data,
      effects: effects.data,
      limits: limits.data,
      items: items.data,
      trees: trees.map((t) => t.tree),
    },
  };
}

function validateLinks(
  table: SkillTable,
  effects: EffectList,
  limits: Limits,
  items: ItemList,
  trees: { file: string; tree: Tree }[],
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
      for (const id of skill.effects) if (!effectIds.has(id)) add(where, `없는 효과를 가리킨다: ${id}`);
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

    issues.push(...validateNodes(file, tree, table, checkSkill));
    issues.push(...validateStem(file, tree, table));
  }
  return issues;
}

function validateNodes(
  file: string,
  tree: Tree,
  table: SkillTable,
  checkSkill: (where: string, skill: SkillSpec) => void,
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
    } else if (node.skill !== undefined) add(node.id, "skill은 기본기에만 적는다");
    if (isFork) {
      if (node.hidden !== true && node.axis === undefined) add(node.id, "갈림길·끝갈래에는 axis가 있어야 한다");
      if (node.axis !== undefined && !table.tree.axes.includes(node.axis)) add(node.id, `기준표에 없는 축: ${node.axis}`);
    } else {
      if (node.axis !== undefined) add(node.id, "axis는 갈림길·끝갈래에만 적는다");
      if (node.hidden !== undefined) add(node.id, "hidden은 갈림길·끝갈래에만 적는다");
      if (node.overrides !== undefined) add(node.id, "overrides는 갈림길·끝갈래에만 적는다");
    }
    if (node.kind !== "보완") {
      if (node.bonus !== undefined) add(node.id, "bonus는 보완 칸에만 적는다");
      if (node.choice !== undefined) add(node.id, "choice는 보완 칸에만 적는다");
    } else if (node.bonus !== undefined && node.choice !== undefined) {
      add(node.id, "bonus와 choice를 함께 적을 수 없다 (고르는 칸이면 choice 안에 적는다)");
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
