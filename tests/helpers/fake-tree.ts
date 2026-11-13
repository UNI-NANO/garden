import rawMigration from "../../data/defs/migration.json";
import rawLimits from "../../data/defs/limits.json";
import rawTalents from "../../data/defs/talents.json";
import rawTable from "../../data/defs/skill-table.json";

type Json = Record<string, unknown>;
export interface FakeNode extends Json {
  id: string;
  kind: string;
  prev: string | null;
}
export interface FakeTree extends Json {
  id: string;
  nodes: FakeNode[];
  stem: { mastery: number; unlocks: string[] }[];
  roots: { id: string; name: string; slots: { id: string; description: string }[] }[];
}

const axes = rawTable.tree.axes;

/** 규칙에 맞는 작은 나무를 만든다. 기본기 넷, 루트마다 9칸. */
export function makeTree(id = "t"): FakeTree {
  const nodes: FakeNode[] = [];
  let axisIndex = 0;
  const node = (nid: string, kind: string, prev: string | null, extra: Json = {}): string => {
    nodes.push({ id: nid, kind, name: nid, prev, description: "설명", ...extra });
    return nid;
  };
  const skill = { tier: "1단계", potency: "보통", hits: 1, range: "단일", role: "여는", damageType: "자상", effects: [] };

  for (let b = 1; b <= 4; b++) {
    const base = node(`${id}.b${b}`, "기본기", null, { skill: structuredClone(skill) });
    const s2 = node(`${base}.s2`, "보완", node(`${base}.s1`, "보완", base));
    const forkAxis = axes[axisIndex++];
    for (const side of ["a", "b"]) {
      const fork = node(`${base}.${side}`, "갈림길", s2, {
        axis: forkAxis,
        overrides: { role: side === "a" ? "잇는" : "끝내는" },
      });
      const fs2 = node(`${fork}.s2`, "보완", node(`${fork}.s1`, "보완", fork));
      const endAxis = axes[axisIndex++];
      for (const n of ["1", "2"]) {
        const end = node(`${fork}${n}`, "끝갈래", fs2, { axis: endAxis });
        node(`${end}.u`, "궁극기", node(`${end}.s`, "보완", end));
      }
    }
  }

  return {
    id,
    name: "가짜 나무",
    version: 1,
    description: "설명",
    basicAttack: {
      id: `${id}.atk`,
      name: "기본 공격",
      skill: { ...structuredClone(skill), tier: "기본 공격" },
      variants: [
        { id: `${id}.atk.v1`, name: "변형 1", description: "설명" },
        { id: `${id}.atk.v2`, name: "변형 2", description: "설명" },
      ],
    },
    stem: [
      { mastery: 1, unlocks: [`${id}.atk`, `${id}.b1`, `${id}.b4`] },
      { mastery: 10, unlocks: [`${id}.b3`] },
      { mastery: 30, unlocks: [`${id}.b2`] },
      { mastery: 50, unlocks: [`${id}.atk.v1`, `${id}.atk.v2`] },
    ],
    roots: ["r1", "r2", "r3", "r4"].map((r) => ({
      id: `${id}.${r}`,
      name: r,
      slots: [1, 2, 3, 4].map((s) => ({ id: `${id}.${r}.${s}`, description: "설명" })),
    })),
    nodes,
  };
}

export const fakeEffects = () => ({
  id: "effects",
  name: "효과",
  version: 1,
  effects: [
    { id: "bleed", name: "출혈", weight: "가벼운" },
    { id: "bind", name: "속박", weight: "무거운" },
  ],
});

export const fakeTable = () => structuredClone(rawTable);

export const fakeLimits = () => structuredClone(rawLimits);

export const fakeItems = () => ({
  id: "items",
  name: "물건",
  version: 1,
  items: [
    { id: "herb", name: "약초", kind: "묶음", weight: 1 },
    { id: "ore", name: "철광석", kind: "묶음", weight: 5 },
    { id: "sword.iron", name: "철검", kind: "낱개", weight: 10 },
  ],
});

export const fakeMigration = () => ({ ...structuredClone(rawMigration), items: [] as { from: string; item: string }[] });

export const fakeTalents = () => structuredClone(rawTalents);
