import { KEY_PATTERN } from "../schema/keys";
import type { AdminPort } from "./migrate-write";
import { paths } from "./paths";

export type LinkResult =
  | { ok: true }
  | { ok: false; reason: "잘못된 요청" | "없는 캐릭터" | "이미 주인이 있는 캐릭터" | "이미 살아 있는 캐릭터가 있는 계정" };

/**
 * 계정과 캐릭터를 잇는다 (GM이 하는 일).
 * 계정 쪽(`characterId`)과 캐릭터 쪽(`meta/owner`)을 한 번에 쓴다: 한쪽만 이어지는 일은 없다.
 * 계정당 살아 있는 캐릭터는 하나다.
 */
export async function linkCharacter(db: AdminPort, uid: string, characterId: string): Promise<LinkResult> {
  if (uid.length === 0 || /[.#$[\]/]/.test(uid) || !KEY_PATTERN.test(characterId)) return { ok: false, reason: "잘못된 요청" };

  const [stage, owner, current] = await Promise.all([
    db.get(paths.characterPart(characterId, "meta/stage")),
    db.get(paths.characterPart(characterId, "meta/owner")),
    db.get(`${paths.account(uid)}/characterId`),
  ]);
  if (stage === null || stage === undefined) return { ok: false, reason: "없는 캐릭터" };
  if (owner === uid && current === characterId) return { ok: true };
  if (typeof owner === "string" && owner !== "") return { ok: false, reason: "이미 주인이 있는 캐릭터" };

  if (typeof current === "string" && current !== characterId) {
    const currentStage = await db.get(paths.characterPart(current, "meta/stage"));
    const alive = currentStage !== null && currentStage !== undefined && currentStage !== "죽음";
    if (alive) return { ok: false, reason: "이미 살아 있는 캐릭터가 있는 계정" };
  }

  await db.update({
    [`${paths.account(uid)}/characterId`]: characterId,
    [paths.characterPart(characterId, "meta/owner")]: uid,
  });
  return { ok: true };
}
