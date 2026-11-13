import type { ConvertedCharacter } from "../rules/migrate/convert";
import { characterSchema } from "../schema/character";
import type { Limits } from "../schema/defs/limits";
import type { EnvConfig } from "../schema/env";
import { SecretsSchema } from "../schema/secrets";
import { paths } from "./paths";

/** 보안 규칙을 건너뛰는 관리용 창구 (에뮬레이터의 관리자, 나중에는 하루 계산의 관리 도구) */
export interface AdminPort {
  get(path: string): Promise<unknown>;
  /** 여러 경로를 한 번에 쓴다: 다 되거나 하나도 안 된다 */
  update(updates: Record<string, unknown>): Promise<void>;
}

export class MigrationWriteError extends Error {
  override name = "MigrationWriteError";
}

export interface WriteReport {
  written: string[];
  /** 이미 옮겨져 있어 건너뛴 캐릭터 */
  skipped: string[];
}

/**
 * 변환한 캐릭터를 저장한다.
 * - 지금은 에뮬레이터에만 쓸 수 있다. 다른 환경이면 거부한다.
 * - 모두 스키마를 통과해야 쓴다. 하나라도 틀리면 아무것도 쓰지 않는다.
 * - 이미 옮긴 캐릭터는 건너뛴다(덮어쓰지 않는다). 다시 옮기려면 GM이 그 캐릭터를 지운 뒤.
 */
export async function writeMigrated(
  db: AdminPort,
  env: Pick<EnvConfig, "name">,
  limits: Limits,
  converted: readonly ConvertedCharacter[],
): Promise<WriteReport> {
  if (env.name !== "emulator") {
    throw new MigrationWriteError(`이전 결과는 지금 에뮬레이터에만 쓸 수 있다 ("${env.name}" 거부)`);
  }

  const schema = characterSchema(limits);
  const ids = new Set<string>();
  for (const item of converted) {
    if (ids.has(item.characterId)) throw new MigrationWriteError(`캐릭터 ID가 겹친다: ${item.characterId}`);
    ids.add(item.characterId);
    const character = schema.safeParse(item.character);
    if (!character.success) {
      const issue = character.error.issues[0];
      throw new MigrationWriteError(`${item.characterId}: 스키마를 통과하지 못했다 (${issue?.path.join(".") ?? ""}: ${issue?.message ?? ""})`);
    }
    if (!SecretsSchema.safeParse(item.secrets).success) throw new MigrationWriteError(`${item.characterId}: 비밀의 모양이 틀리다`);
  }

  const report: WriteReport = { written: [], skipped: [] };
  const updates: Record<string, unknown> = {};
  for (const item of converted) {
    const already = await db.get(paths.characterPart(item.characterId, "migration/oldPlayer"));
    if (already !== null && already !== undefined) {
      report.skipped.push(item.characterId);
      continue;
    }
    updates[paths.character(item.characterId)] = item.character;
    const { innate, hiddenPeople, notes } = item.secrets;
    if (innate !== undefined || hiddenPeople.length > 0 || notes.length > 0) updates[`secrets/${item.characterId}`] = item.secrets;
    report.written.push(item.characterId);
  }
  if (report.written.length > 0) await db.update(updates);
  return report;
}
