import { describe, expect, it } from "vitest";
import { generateFloor, type Floor } from "../src/rules/dungeon/floor";
import { realDefs } from "./helpers/real-defs";

const defs = realDefs();
const forest = defs.dungeons.find((d) => d.id === "border-forest")!;

/** 열쇠·폭약 없이 시작방에서 닿는 방 (보물방·비밀방은 들어가지 않는다) */
function freeReach(floor: Floor): Set<number> {
  const seen = new Set([floor.start]);
  const queue = [floor.start];
  while (queue.length > 0) {
    for (const to of floor.rooms[queue.shift()!]!.doors) {
      const kind = floor.rooms[to]!.kind;
      if (seen.has(to) || kind === "보물" || kind === "비밀") continue;
      seen.add(to);
      queue.push(to);
    }
  }
  return seen;
}

describe("던전 층 만들기", () => {
  it("같은 씨앗·층이면 같은 지도", () => {
    expect(generateFloor(forest, 2, "s1", defs.itemMap, 1)).toEqual(generateFloor(forest, 2, "s1", defs.itemMap, 1));
    expect(generateFloor(forest, 2, "s1", defs.itemMap, 1)).not.toEqual(generateFloor(forest, 2, "s2", defs.itemMap, 1));
  });

  it("씨앗 3000개 × 층마다: 방 수, 꼭 있는 방, 열쇠·폭약 없이 끝방·쉼터에 닿음, 보물방이면 열쇠가 닿는 곳에, 비밀방은 일반 방 벽에", () => {
    const seen = { treasure: 0, secret: 0, bomb: 0, trap: 0 };
    for (let s = 0; s < 3000; s++) {
      forest.floors.forEach((spec, i) => {
        const floor = generateFloor(forest, i + 1, `seed-${s}`, defs.itemMap, 1);
        const rooms = floor.rooms;
        const where = `seed-${s} 층 ${i + 1}`;
        expect(rooms.length, where).toBeGreaterThanOrEqual(spec.rooms.min);
        expect(rooms.length, where).toBeLessThanOrEqual(spec.rooms.max);
        const count = (kind: string) => rooms.filter((r) => r.kind === kind).length;
        expect([count("시작"), count("쉼터"), count(floor.last ? "보스" : "정예")], where).toEqual([1, 1, 1]);
        expect(count(floor.last ? "정예" : "보스"), where).toBe(0);
        expect(count("보물"), where).toBeLessThanOrEqual(1);
        expect(count("비밀"), where).toBeLessThanOrEqual(1);
        expect(rooms[floor.start]!.kind).toBe("시작");

        // 칸이 겹치지 않고, 문은 맞붙은 방끼리 서로
        expect(new Set(rooms.map((r) => `${r.x},${r.y}`)).size, where).toBe(rooms.length);
        for (const room of rooms) {
          for (const to of room.doors) {
            const other = rooms[to]!;
            expect(Math.abs(other.x - room.x) + Math.abs(other.y - room.y), where).toBe(1);
            expect(other.doors, where).toContain(room.index);
          }
        }

        const reach = freeReach(floor);
        expect(reach.has(floor.end), where).toBe(true);
        expect(reach.has(floor.rest), where).toBe(true);
        // 보물방·비밀방을 뺀 모든 방에 닿는다
        expect(reach.size, where).toBe(rooms.filter((r) => r.kind !== "보물" && r.kind !== "비밀").length);

        const keyRooms = rooms.filter((r) => r.loot.some((p) => p.kind === "열쇠"));
        if (count("보물") === 1) {
          seen.treasure++;
          expect(keyRooms.length, where).toBe(1);
          expect(reach.has(keyRooms[0]!.index), where).toBe(true);
          expect(keyRooms[0]!.index, where).not.toBe(floor.end);
        } else expect(keyRooms.length, where).toBe(0);

        const secret = rooms.find((r) => r.kind === "비밀");
        if (secret) {
          seen.secret++;
          const anchors = rooms.filter((r) => r.secret === secret.index);
          expect(anchors.length, where).toBe(1);
          expect(["전투", "함정"], where).toContain(anchors[0]!.kind);
          expect(Math.abs(anchors[0]!.x - secret.x) + Math.abs(anchors[0]!.y - secret.y), where).toBe(1);
          expect(secret.doors, where).toEqual([]);
        }
        if (rooms.some((r) => r.loot.some((p) => p.kind === "폭약"))) seen.bomb++;
        seen.trap += count("함정");

        // 싸우는 방에는 무리가, 그 밖에는 없다
        for (const room of rooms) {
          const fights = room.kind === "전투" || room.kind === "정예" || room.kind === "보스";
          expect(room.group !== undefined, where).toBe(fights);
          if (room.group) for (const g of [room.group]) expect(g.minFloor ?? 1, where).toBeLessThanOrEqual(i + 1);
        }
      });
    }
    // 확률대로 가끔은 나온다
    expect(seen.treasure).toBeGreaterThan(1000);
    expect(seen.secret).toBeGreaterThan(1000);
    expect(seen.bomb).toBeGreaterThan(1000);
    expect(seen.trap).toBeGreaterThan(1000);
  });

  it("피로 배율은 묶음·잎전 수량에만 (내림, 최소 1), 낱개는 그대로", () => {
    for (let s = 0; s < 200; s++) {
      const full = generateFloor(forest, 3, `m-${s}`, defs.itemMap, 1);
      const low = generateFloor(forest, 3, `m-${s}`, defs.itemMap, 0.3);
      full.rooms.forEach((room, r) =>
        room.loot.forEach((p, i) => {
          const q = low.rooms[r]!.loot[i]!;
          if (p.kind === "물건" && defs.itemMap.get(p.item)?.kind === "낱개") expect(q).toEqual(p);
          else if (p.kind === "물건" || p.kind === "잎전") {
            expect(q.kind).toBe(p.kind);
            expect((q as { quantity: number }).quantity).toBeGreaterThanOrEqual(1);
            expect((q as { quantity: number }).quantity).toBeLessThanOrEqual(p.quantity);
          }
        }),
      );
    }
  });
});
