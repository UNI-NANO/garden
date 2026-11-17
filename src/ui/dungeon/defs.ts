import rawDungeons from "../../../data/defs/dungeons.json";
import rawItems from "../../../data/defs/items.json";
import type { Enemy } from "../../schema/defs/battle";
import { DungeonListSchema, type Dungeon } from "../../schema/defs/dungeon";
import { ItemListSchema, type Item } from "../../schema/defs/item";
import { loadBattleDefs, type BattleDefs } from "../battle/defs";

export interface DungeonDefs {
  battle: BattleDefs;
  dungeons: ReadonlyMap<string, Dungeon>;
  items: ReadonlyMap<string, Item>;
  enemies: ReadonlyMap<string, Enemy>;
}

/** 던전 화면이 쓰는 정의 데이터. 스키마 검사에 실패하면 던진다(화면이 안내를 띄운다) */
export function loadDungeonDefs(): DungeonDefs {
  const battle = loadBattleDefs();
  return {
    battle,
    dungeons: new Map(
      DungeonListSchema.parse(rawDungeons).dungeons.map((d) => [d.id, d]),
    ),
    items: new Map(ItemListSchema.parse(rawItems).items.map((i) => [i.id, i])),
    enemies: new Map(battle.practice.enemies.map((e) => [e.id, e])),
  };
}
