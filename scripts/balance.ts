// 균형 시험: 판정을 전부 "좋음"으로 놓고 스스로 고르는 규칙으로 싸워, 이기는지·몇 턴 걸리는지·체력이 얼마나 남는지 표로 찍는다.
// 숫자(data/defs/battle.json, skill-table.json, enemies.json)를 바꾼 뒤 다시 돌려 본다.
//   npm run balance
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DefensePolicy } from "../src/rules/battle/auto";
import { effectDefs } from "../src/rules/battle/effects";
import type { AllySetup, BattleSetup } from "../src/rules/battle/engine";
import { enemyNumbers, playerMaxHp } from "../src/rules/battle/numbers";
import { treeBattleSkills } from "../src/rules/battle/setup";
import { simulateBattle } from "../src/rules/battle/simulate";
import { checkDefs } from "../src/rules/validate-defs";

const root = join(import.meta.dirname, "..", "data", "defs");
const read = (file: string): unknown => JSON.parse(readFileSync(join(root, file), "utf8"));
const trees: Record<string, unknown> = {};
for (const name of readdirSync(join(root, "trees"))) trees[`trees/${name}`] = read(`trees/${name}`);
const checked = checkDefs({
  skillTable: read("skill-table.json"),
  effects: read("effects.json"),
  limits: read("limits.json"),
  items: read("items.json"),
  migration: read("migration.json"),
  talents: read("talents.json"),
  battle: read("battle.json"),
  enemies: read("enemies.json"),
  trees,
});
if (!checked.ok) {
  console.error("정의 데이터에 문제가 있다:", checked.issues[0]);
  process.exit(1);
}
const defs = checked.defs;
const ctx = { rules: defs.battle, table: defs.skillTable, effects: effectDefs(defs.effects.effects) };
const sword = defs.trees.find((t) => t.id === "sword");
if (!sword) throw new Error("검술 나무가 없다");
const skills = treeBattleSkills(defs.skillTable, defs.effects.effects, sword, "근접");
const pick = (id: string) => {
  const found = skills.basics.find((s) => s.id === id);
  if (!found) throw new Error(`기술 없음: ${id}`);
  return found;
};
const enemy = (id: string) => {
  const found = defs.enemies.enemies.find((e) => e.id === id);
  if (!found) throw new Error(`적 없음: ${id}`);
  return found;
};

const MASTERY = 30;
const HEALTH = 50;
const player: AllySetup = {
  id: "player",
  name: "플레이어",
  kind: "플레이어",
  slot: 0,
  health: HEALTH,
  mastery: MASTERY,
  basicAttack: skills.basicAttack,
  skills: [pick("sword.combo"), pick("sword.charge"), pick("sword.gale")],
};
const mate = (n: number): AllySetup => ({ ...player, id: `mate${n}`, name: `동료 ${n}`, kind: "동료", slot: n, skills: [] });

const parties: [string, AllySetup[]][] = [
  ["혼자", [player]],
  ["동료 둘과", [player, mate(1), mate(2)]],
];
const foes: [string, BattleSetup["enemies"]][] = [
  ["늑대 하나", [{ id: "w1", def: enemy("wolf"), slot: 0 }]],
  ["늑대 셋", [1, 2, 3].map((n) => ({ id: `w${n}`, def: enemy("wolf"), slot: n - 1 }))],
  [
    "방패병 + 석궁병",
    [
      { id: "s1", def: enemy("deserter.shield"), slot: 0 },
      { id: "c1", def: enemy("deserter.crossbow"), slot: 3 },
    ],
  ],
];
const policies: DefensePolicy[] = ["안 누름", "자동", "늘 막기"];

console.log(`\n조건: 검술 숙련도 ${MASTERY} · 건강 ${HEALTH} (체력 ${playerMaxHp(defs.battle, HEALTH)}), 판정은 모두 좋음`);
console.log(`플레이어 기술: ${[player.basicAttack, ...player.skills].map((s) => `${s.name}(위력 ${+(s.baseHitPower * s.hitCount).toFixed(2)}, 쿨다운 ${s.cooldown}, 기력 ${s.energy})`).join(", ")}`);
console.log("동료: 플레이어와 같은 체력·숙련도, 베기만 씀. 쓸 수 있는 연계를 먼저 고르고, 합은 이길 수 있을 때만 건다.");
console.log(
  `적: ${["wolf", "deserter.shield", "deserter.crossbow"]
    .map((id) => {
      const def = enemy(id);
      const n = enemyNumbers(defs.battle, def);
      return `${def.name}(체력 ${n.maxHp}, 위력 ${n.power}, 방어 ${def.defense}, 흐트러짐 ${n.maxStagger})`;
    })
    .join(", ")}\n`,
);
console.log("| 편성 | 상대 | 반응 | 결과 | 턴 | 플레이어 체력 | 동료 체력 | 부상 |");
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const [partyName, allies] of parties) {
  for (const [foeName, enemies] of foes) {
    for (const policy of policies) {
      const result = simulateBattle({ id: "balance", kind: "일반", seed: "균형 시험", allies, enemies }, ctx, policy);
      const [me, ...mates] = result.allies;
      const injuries = result.allies.filter((a) => a.injury).map((a) => `${a.name} ${a.injury}`);
      console.log(
        `| ${partyName} | ${foeName} | ${policy} | ${result.outcome} | ${result.turns} | ${me ? `${me.hp}/${me.maxHp}` : "-"} | ${mates.map((m) => m.hp).join(", ") || "-"} | ${injuries.join(", ") || "-"} |`,
      );
    }
  }
}
console.log("");
