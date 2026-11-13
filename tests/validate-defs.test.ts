import { describe, expect, it } from "vitest";
import { checkDefs, type RawDefs } from "../src/rules/validate-defs";
import { fakeEffects, fakeItems, fakeLimits, fakeMigration, fakeTable, makeTree, type FakeNode, type FakeTree } from "./helpers/fake-tree";

const raw = (tree: unknown = makeTree(), over: Partial<RawDefs> = {}): RawDefs => ({
  skillTable: fakeTable(),
  effects: fakeEffects(),
  limits: fakeLimits(),
  items: fakeItems(),
  migration: fakeMigration(),
  trees: { "trees/t.json": tree },
  ...over,
});

/** 검사 결과에서 문제 문장만 뽑는다 */
const messages = (input: RawDefs): string[] => {
  const result = checkDefs(input);
  return result.ok ? [] : result.issues.map((i) => `${i.where}: ${i.message}`);
};
const broken = (change: (tree: FakeTree) => void): string[] => {
  const tree = makeTree();
  change(tree);
  return messages(raw(tree));
};
const find = (tree: FakeTree, id: string): FakeNode => {
  const node = tree.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`테스트 오류: ${id} 없음`);
  return node;
};

describe("올바른 데이터", () => {
  it("통과하고, 읽은 데이터를 돌려준다", () => {
    const result = checkDefs(raw());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.defs.trees[0]?.nodes).toHaveLength(4 * 21);
    }
  });
  it("숨은 셋째 선택지 하나는 허용한다", () => {
    expect(
      broken((t) => {
        t.nodes.push(
          { id: "t.b1.ax", kind: "끝갈래", name: "숨은", prev: "t.b1.a.s2", description: "설명", hidden: true },
          { id: "t.b1.ax.s", kind: "보완", name: "보완", prev: "t.b1.ax", description: "설명" },
          { id: "t.b1.ax.u", kind: "궁극기", name: "궁극기", prev: "t.b1.ax.s", description: "설명" },
        );
      }),
    ).toEqual([]);
  });
  it("나무가 여러 그루여도 통과한다", () => {
    expect(messages(raw(undefined, { trees: { "a.json": makeTree("a"), "b.json": makeTree("b") } }))).toEqual([]);
  });
});

describe("스키마(모양) 오류", () => {
  it("모르는 칸, 빠진 칸, 틀린 값", () => {
    expect(broken((t) => void (t["extra"] = 1)).length).toBeGreaterThan(0);
    expect(broken((t) => void delete t["description"]).length).toBeGreaterThan(0);
    expect(broken((t) => void (find(t, "t.b1").kind = "기본")).length).toBeGreaterThan(0);
    expect(broken((t) => void (find(t, "t.b1").id = "검술")).length).toBeGreaterThan(0);
  });
  it("기준표나 효과 파일이 틀려도 잡는다", () => {
    expect(messages(raw(undefined, { skillTable: {} })).length).toBeGreaterThan(0);
    expect(messages(raw(undefined, { effects: { id: "effects" } })).length).toBeGreaterThan(0);
  });
  it("문제는 하나에서 멈추지 않고 모아서 알려준다", () => {
    const tree = makeTree();
    tree["extra"] = 1;
    const result = checkDefs(raw(tree, { effects: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(new Set(result.issues.map((i) => i.file)).size).toBe(2);
  });
});

describe("연결 오류", () => {
  it("없는 효과를 가리킴", () => {
    expect(
      broken((t) => void ((find(t, "t.b1")["skill"] as { effects: string[] }).effects = ["nope"])),
    ).toEqual(["t.b1: 없는 효과를 가리킨다: nope"]);
  });
  it("ID 중복 (한 나무 안, 나무 사이)", () => {
    expect(broken((t) => void (find(t, "t.b1.s1").id = "t.b2")).some((m) => m.includes("ID가 겹친다"))).toBe(true);
    const two = messages(raw(undefined, { trees: { "a.json": makeTree(), "b.json": makeTree() } }));
    expect(two.some((m) => m.includes("ID가 겹친다 (a.json에도 있음)"))).toBe(true);
  });
  it("없는 앞 칸, 자기 자신, 앞 칸 없는 칸", () => {
    expect(broken((t) => void (find(t, "t.b1.s1").prev = "nope"))).toContain("t.b1.s1: 없는 앞 칸을 가리킨다: nope");
    expect(broken((t) => void (find(t, "t.b1.s1").prev = "t.b1.s1"))).toContain("t.b1.s1: 앞 칸이 자기 자신이다");
    expect(broken((t) => void (find(t, "t.b1.s1").prev = null))).toContain(
      "t.b1.s1: 기본기가 아닌 칸은 앞 칸이 있어야 한다",
    );
  });
  it("앞 칸이 돌고 돎", () => {
    const result = broken((t) => {
      find(t, "t.b1.s1").prev = "t.b1.s2";
    });
    expect(result.some((m) => m.includes("돌고 돈다"))).toBe(true);
  });
  it("3타보다 많은 타수도 규칙으로 계산되므로 통과한다", () => {
    expect(broken((t) => void ((find(t, "t.b1")["skill"] as { hits: number }).hits = 8))).toEqual([]);
  });
});

describe("연계 역할", () => {
  const setRole = (t: FakeTree, id: string, role: string | undefined) => {
    const node = find(t, id);
    if (node.kind === "기본기") (node["skill"] as { role: string }).role = role ?? "여는";
    else if (role === undefined) delete node["overrides"];
    else node["overrides"] = { role };
  };
  it("갈림길에서 바뀌는 역할로 셋을 갖추면 통과한다", () => {
    expect(broken(() => undefined)).toEqual([]);
  });
  it("어떤 갈래를 골라도 한 역할이 빠지는 기본기 셋을 잡는다", () => {
    // b1만 「잇는」이 될 수 있게 만든다 → b1을 뺀 셋(b2+b3+b4)은 잇는 기술이 없다
    const result = broken((t) => {
      for (const b of ["t.b2", "t.b3", "t.b4"]) setRole(t, `${b}.a`, "끝내는");
    });
    expect(result).toEqual(["t.b2 + t.b3 + t.b4: 이 기본기 3개로는 어떤 갈래를 골라도 여는·잇는·끝내는을 모두 갖출 수 없다"]);
  });
  it("갈래가 역할을 바꾸지 않으면 기본기의 역할이 그대로 간다", () => {
    const result = broken((t) => {
      for (const node of t.nodes) if (node.kind === "갈림길") delete node["overrides"];
    });
    expect(result).toHaveLength(4);
  });
  it("기본기 역할만으로 셋을 갖춰도 통과한다", () => {
    const result = broken((t) => {
      for (const node of t.nodes) if (node.kind === "갈림길") delete node["overrides"];
      setRole(t, "t.b1", "여는");
      setRole(t, "t.b2", "잇는");
      setRole(t, "t.b3", "끝내는");
      setRole(t, "t.b4", "잇는");
      setRole(t, "t.b4.a", "여는");
      setRole(t, "t.b4.b", "끝내는");
      setRole(t, "t.b1.a", "잇는");
      setRole(t, "t.b1.b", "끝내는");
    });
    expect(result).toEqual([]);
  });
  it("숨은 갈래의 역할은 세지 않는다", () => {
    const result = broken((t) => {
      for (const b of ["t.b2", "t.b3", "t.b4"]) setRole(t, `${b}.a`, "끝내는");
      t.nodes.push(
        { id: "t.b2.ax", kind: "끝갈래", name: "숨은", prev: "t.b2.a.s2", description: "설명", hidden: true, overrides: { role: "잇는" } },
        { id: "t.b2.ax.s", kind: "보완", name: "보완", prev: "t.b2.ax", description: "설명" },
        { id: "t.b2.ax.u", kind: "궁극기", name: "궁극기", prev: "t.b2.ax.s", description: "설명" },
      );
    });
    expect(result).toHaveLength(1);
  });
});

describe("나무 모양 오류", () => {
  it("기본기 수", () => {
    const result = broken((t) => {
      t.nodes = t.nodes.filter((n) => !n.id.startsWith("t.b4"));
      t.stem[0]?.unlocks.pop();
    });
    expect(result).toEqual(["nodes: 기본기는 4개여야 한다 (지금 3)"]);
  });
  it("루트가 9칸보다 짧음 (보완 칸 하나 빠짐)", () => {
    const result = broken((t) => {
      t.nodes = t.nodes.filter((n) => n.id !== "t.b1.a1.s");
      find(t, "t.b1.a1.u").prev = "t.b1.a1";
    });
    expect(result).toEqual(["t.b1.a1.u: 루트의 8번째 칸은 「보완」이어야 한다 (지금 궁극기)", "t.b1.a1.u: 루트가 여기서 끊긴다 (8칸째, 끝까지 9칸)"]);
  });
  it("궁극기가 없는 끝갈래", () => {
    const result = broken((t) => void (t.nodes = t.nodes.filter((n) => n.id !== "t.b1.a1.u")));
    expect(result).toEqual(["t.b1.a1.s: 루트가 여기서 끊긴다 (8칸째, 끝까지 9칸)"]);
  });
  it("궁극기 뒤에 칸이 더 있음", () => {
    const result = broken((t) => {
      t.nodes.push({ id: "t.b1.a1.u2", kind: "보완", name: "x", prev: "t.b1.a1.u", description: "설명" });
    });
    expect(result).toEqual(["t.b1.a1.u2: 루트가 9칸보다 길다"]);
  });
  it("갈림길이 하나뿐이거나 셋", () => {
    const one = broken((t) => void (t.nodes = t.nodes.filter((n) => !n.id.startsWith("t.b1.b"))));
    expect(one).toContain("t.b1.s2: 갈림길은 둘 중 하나여야 한다 (지금 1개)");
    const three = broken((t) => {
      t.nodes.push({ id: "t.b1.c", kind: "갈림길", name: "c", prev: "t.b1.s2", description: "설명", axis: find(t, "t.b1.a")["axis"] });
    });
    expect(three).toContain("t.b1.s2: 갈림길은 둘 중 하나여야 한다 (지금 3개)");
  });
  it("숨은 선택지가 둘", () => {
    const result = broken((t) => {
      for (const x of ["x", "y"]) {
        t.nodes.push(
          { id: `t.b1.a${x}`, kind: "끝갈래", name: x, prev: "t.b1.a.s2", description: "설명", hidden: true },
          { id: `t.b1.a${x}.s`, kind: "보완", name: x, prev: `t.b1.a${x}`, description: "설명" },
          { id: `t.b1.a${x}.u`, kind: "궁극기", name: x, prev: `t.b1.a${x}.s`, description: "설명" },
        );
      }
    });
    expect(result).toEqual(["t.b1.a.s2: 숨은 선택지는 하나까지다 (지금 2개)"]);
  });
  it("같은 축을 두 번 씀, 두 쪽의 축이 다름, 없는 축", () => {
    const twice = broken((t) => {
      const axis = find(t, "t.b1.a")["axis"];
      find(t, "t.b2.a")["axis"] = axis;
      find(t, "t.b2.b")["axis"] = axis;
    });
    expect(twice.some((m) => m.includes("같은 축을 두 번 썼다"))).toBe(true);
    const differ = broken((t) => void (find(t, "t.b1.a")["axis"] = find(t, "t.b2.a")["axis"]));
    expect(differ.some((m) => m.includes("같은 축이어야 한다"))).toBe(true);
    expect(broken((t) => void (find(t, "t.b1.a")["axis"] = "앞 / 뒤"))).toContain("t.b1.a: 기준표에 없는 축: 앞 / 뒤");
  });
  it("칸 종류에 맞지 않는 칸", () => {
    expect(broken((t) => void delete find(t, "t.b1")["skill"])).toContain("t.b1: 기본기에는 skill이 있어야 한다");
    expect(broken((t) => void (find(t, "t.b1.a")["bonus"] = { powerPct: 0.05 }))).toContain(
      "t.b1.a: bonus는 보완 칸에만 적는다",
    );
    expect(broken((t) => void (find(t, "t.b1.s1")["axis"] = "넓게 / 깊게"))).toContain(
      "t.b1.s1: axis는 갈림길·끝갈래에만 적는다",
    );
    expect(broken((t) => void delete find(t, "t.b1.a")["axis"]).some((m) => m.includes("axis가 있어야 한다"))).toBe(true);
  });
  it("단계가 맞지 않음", () => {
    expect(broken((t) => void ((find(t, "t.b1")["skill"] as { tier: string }).tier = "궁극기"))).toEqual([
      "t.b1: 기본기의 단계는 1~3단계여야 한다 (지금 궁극기)",
    ]);
    expect(
      broken((t) => void ((t["basicAttack"] as { skill: { tier: string } }).skill.tier = "1단계")),
    ).toEqual(["t.atk: 기본 공격의 단계는 「기본 공격」이어야 한다"]);
  });
  it("뿌리 갈래 수와 칸 수", () => {
    expect(broken((t) => void t.roots.pop())).toEqual(["roots: 뿌리는 4갈래여야 한다 (지금 3)"]);
    expect(broken((t) => void t.roots[0]?.slots.pop())).toEqual(["t.r1: 뿌리 한 갈래는 4칸이어야 한다 (지금 3)"]);
  });
});

describe("줄기 오류", () => {
  it("문턱이 기준과 다름", () => {
    expect(broken((t) => void (t.stem[1]!.mastery = 20))).toEqual([
      "stem: 줄기 문턱은 1, 10, 30, 50이어야 한다 (지금 1, 20, 30, 50)",
    ]);
  });
  it("안 열리는 기본기, 두 번 열림, 열 수 없는 것", () => {
    expect(broken((t) => void (t.stem[1]!.unlocks = ["t.b2"]))).toEqual([
      "stem.30: 줄기에서 두 번 열린다: t.b2",
      "stem: 줄기 어디에서도 열리지 않는다: t.b3",
    ]);
    expect(broken((t) => void t.stem[0]!.unlocks.push("t.b1.s1"))).toEqual([
      "stem.1: 줄기에서 열 수 없는 것을 가리킨다: t.b1.s1",
    ]);
  });
});

describe("범위와 물건", () => {
  it("범위 파일이 틀리면 잡는다", () => {
    const limits = fakeLimits();
    limits.abilities.initial = 500;
    limits.exchange.maxWalletGainPerChange = limits.exchange.walletMax + 1;
    limits.loadout.basics = 2;
    expect(messages(raw(undefined, { limits }))).toEqual([
      "abilities.initial: 처음 값이 범위 밖이다",
      "exchange.maxWalletGainPerChange: 한 번에 느는 양이 지갑 최대보다 크다",
      "loadout.basics: 기준표의 들고 가는 기본기 수(3)와 다르다",
    ]);
  });
  it("물건 ID가 겹치거나 모양이 틀리면 잡는다", () => {
    const items = fakeItems();
    items.items.push({ id: "herb", name: "또 약초", kind: "묶음", weight: 1 });
    expect(messages(raw(undefined, { items })).some((m) => m.includes("ID가 겹친다"))).toBe(true);
    const bad = fakeItems();
    bad.items[0]!.kind = "더미";
    expect(messages(raw(undefined, { items: bad })).length).toBeGreaterThan(0);
  });
});

describe("이전 규칙", () => {
  it("환산 구간에 빈틈이 있거나 끝이 맞지 않으면 잡는다", () => {
    const migration = fakeMigration();
    migration.masteryCurve[1]!.oldFrom = 35;
    migration.masteryCurve[3]!.oldTo = 90;
    expect(messages(raw(undefined, { migration }))).toEqual([
      "masteryCurve.1: 앞 구간과 빈틈없이 이어져야 한다",
      "masteryCurve: 마지막 구간은 옛 100에서 끝나야 한다",
    ]);
  });
});
