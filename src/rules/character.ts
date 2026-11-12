import { CHARACTER_SCHEMA_VERSION, type Character } from "../schema/character";
import type { Limits } from "../schema/defs/limits";

export interface NewCharacterInput {
  owner: string;
  name: string;
  gender: string;
  origin: Character["profile"]["origin"];
  chosenTalents: string[];
  /** 지금 세계의 달 (예: "514-3") */
  monthKey: string;
  /** 지금 시각 (UTC 밀리초) */
  now: number;
  stage?: Character["meta"]["stage"];
}

/** 처음 값으로 채운 캐릭터를 만든다. 저장하기 전에 characterSchema로 검사해야 한다. */
export function newCharacter(limits: Limits, input: NewCharacterInput): Character {
  const initial = limits.abilities.initial;
  return {
    meta: {
      schemaVersion: CHARACTER_SCHEMA_VERSION,
      owner: input.owner,
      rev: 0,
      stage: input.stage ?? "요청",
      createdAt: input.now,
    },
    profile: {
      name: input.name,
      gender: input.gender,
      age: 0,
      origin: input.origin,
      imperialResident: false,
    },
    abilities: { health: initial, spirit: initial, credit: initial, connections: initial, reputation: initial },
    talents: { chosen: [...input.chosenTalents], acquired: {}, progress: {} },
    mastery: {},
    trees: {},
    loadout: { basics: [] },
    wallet: 0,
    bag: { stacks: {}, uniques: {} },
    month: {
      key: input.monthKey,
      mainActions: limits.month.mainActions,
      minorActions: limits.month.minorActions,
      savedActions: 0,
      career: 0,
      learnCounts: {},
      combatMasteryGained: {},
      fatigue: {},
    },
    claimedRewards: {},
    mailbox: {},
  };
}
