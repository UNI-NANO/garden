import type { Character } from "../../schema/character";
import { keyToId } from "../../schema/keys";
import { monthName, parseMonthKey } from "../calendar";
import type { SceneContext } from "./run";

/**
 * 캐릭터에서 장면의 조건·바꿔 넣기에 쓰는 값을 뽑는다.
 * {연도}·{달}은 캐릭터의 이번 달, {지역}은 지금 있는 지역. 그 밖({친구} 등)은 그 값이 생기면 더한다(없으면 글 그대로).
 */
export function sceneContextOf(character: Character): SceneContext {
  const month = parseMonthKey(character.month.key);
  const vars: Record<string, string> = {};
  if (month) {
    vars["연도"] = String(month.year);
    vars["달"] = monthName(month.index);
  }
  if (character.profile.location) vars["지역"] = character.profile.location.region;
  const { abilities } = character;
  return {
    name: character.profile.name,
    vars,
    marks: new Set(character.profile.marks),
    worldMarks: new Set(),
    clues: new Set(character.clues),
    quests: new Set(character.quests.map((q) => q.id)),
    ...(character.profile.family !== undefined ? { house: character.profile.family } : {}),
    talents: new Set([...character.talents.chosen, ...(character.talents.innate ? [character.talents.innate] : []), ...Object.keys(character.talents.acquired).map(keyToId)]),
    numbers: { 건강: abilities.health, 정신력: abilities.spirit, 신용: abilities.credit, 인맥: abilities.connections, 평판: abilities.reputation },
  };
}
