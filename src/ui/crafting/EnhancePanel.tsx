import { push, ref } from "firebase/database";
import { useState } from "preact/hooks";
import rawEnhance from "../../../data/defs/enhance.json";
import { commitEnhance, type EnhanceCommitResult } from "../../data/enhance";
import type { Firebase } from "../../data/firebase-app";
import { firebasePort } from "../../data/firebase-port";
import { reportError, type Session } from "../../data/session";
import { countInBag } from "../../rules/crafting";
import {
  canDrop,
  enhancedName,
  MAX_ENHANCE,
  nextStep,
  successChance,
  totalPower,
} from "../../rules/enhance";
import { EnhanceDefsSchema } from "../../schema/defs/enhance";
import type { Item } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import { Paper } from "../parts";

type SignedIn = Extract<Session, { status: "signedIn" }>;
const table = EnhanceDefsSchema.parse(rawEnhance);

/**
 * 강화 (대장간, 8단계 ③ 나). 가방의 강화할 수 있는 장비를 골라 맡긴다.
 * 다음 단계의 성공 확률(연속 실패 보정 포함)·비용·실패하면 어떻게 되는지를 미리 보여 주고, 결과는 맡기는 순간 정해진다.
 */
export function EnhancePanel(props: {
  fb: Firebase;
  limits: Limits;
  items: ReadonlyMap<string, Item>;
  characterId: string;
  character: NonNullable<SignedIn["character"]>;
}) {
  const { fb, items, character } = props;
  const gear = Object.entries(character.bag.uniques).filter(
    ([, u]) => items.get(u.itemId)?.enhanceable,
  );
  const [picked, setPicked] = useState<string | undefined>(gear[0]?.[0]);
  const [useCharm, setUseCharm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; line?: string }>();
  const itemName = (id: string) => items.get(id)?.name ?? id;
  const unique = picked ? character.bag.uniques[picked] : undefined;
  const charms = countInBag(character.bag, table.charm);

  const entrust = async () => {
    if (!picked || !unique) return;
    setBusy(true);
    setResult(undefined);
    try {
      const requestId =
        push(ref(fb.db, "requests")).key ?? `enhance${Date.now()}`;
      const r: EnhanceCommitResult = await commitEnhance(
        firebasePort(fb.db),
        props.characterId,
        requestId,
        { uniqueId: picked, useCharm: useCharm && charms > 0 },
        table,
        {
          limits: props.limits,
          items,
          now: Date.now(),
          carryLimit: 100,
        },
      );
      if (r.status !== "ok") {
        setResult({
          text:
            r.status === "rejected"
              ? `맡기지 못했어요: ${r.detail}`
              : "맡기지 못했어요. 잠시 뒤 다시 해 주세요.",
        });
        return;
      }
      const name = itemName(unique.itemId);
      const milestone = r.roll.success
        ? table.milestones[String(r.roll.level)]
        : undefined;
      setResult(
        r.roll.success
          ? {
              text: `성공! ${enhancedName(name, r.roll.level, table)}${milestone ? ` · ${milestone}` : ""}`,
              ...(r.roll.level >= MAX_ENHANCE ? { line: table.lines.max } : {}),
            }
          : {
              text: r.roll.dropped
                ? `실패… 한 단계 내려갔다 (+${r.roll.level})`
                : r.roll.charmUsed
                  ? `실패… 부적이 내려감을 막았다 (+${r.roll.level})`
                  : `실패… (+${r.roll.level} 그대로)`,
              line: table.lines.fail,
            },
      );
    } catch (error) {
      reportError(fb, error, "강화");
      setResult({ text: "맡기지 못했어요. 잠시 뒤 다시 해 주세요." });
    } finally {
      setBusy(false);
    }
  };

  const step =
    unique && unique.enhance < MAX_ENHANCE
      ? nextStep(unique.enhance, table)
      : undefined;
  const enough = step
    ? character.wallet >= step.money &&
      step.materials.every(
        (m) => countInBag(character.bag, m.item) >= m.quantity,
      )
    : false;

  return (
    <Paper class="cf__enhance" label="강화">
      <h2 class="cf__title">강화</h2>
      {gear.length === 0 ? (
        <p class="cf__note">가방에 강화할 수 있는 장비가 없어요.</p>
      ) : (
        <>
          <label class="cf__field">
            맡길 장비
            <select
              value={picked}
              onChange={(e) =>
                setPicked((e.currentTarget as HTMLSelectElement).value)
              }
            >
              {gear.map(([id, u]) => (
                <option key={id} value={id}>
                  {enhancedName(itemName(u.itemId), u.enhance, table)}
                </option>
              ))}
            </select>
          </label>
          {unique && (
            <p class="cf__note">
              지금 +{unique.enhance} · 오른 힘 +
              {totalPower(unique.enhance, table)}%
              {(unique.failStreak ?? 0) > 0
                ? ` · 연속 실패 ${unique.failStreak}번`
                : ""}
            </p>
          )}
          {unique && step ? (
            <>
              <dl class="cf__facts">
                <dt>다음</dt>
                <dd>
                  +{unique.enhance + 1} · 성공{" "}
                  {successChance(unique.enhance, unique.failStreak ?? 0, table)}
                  % · 힘 +{step.power}%
                </dd>
                <dt>비용</dt>
                <dd>
                  잎전 {step.money}
                  {step.materials
                    .map(
                      (m) =>
                        ` · ${itemName(m.item)} ${countInBag(character.bag, m.item)}/${m.quantity}`,
                    )
                    .join("")}
                </dd>
                <dt>실패하면</dt>
                <dd>
                  재료 전부 + 잎전{" "}
                  {Math.floor(step.money * table.fail.moneyShare)}
                  {canDrop(unique.enhance, table)
                    ? ` · ${table.fail.dropChance}% 확률로 한 단계 내려감`
                    : ""}
                </dd>
              </dl>
              {unique.enhance + 1 >= table.lines.warnFrom && (
                <p class="cf__smith">대장장이: “{table.lines.warn}”</p>
              )}
              {canDrop(unique.enhance, table) && (
                <label class="cf__field">
                  <input
                    type="checkbox"
                    checked={useCharm}
                    disabled={charms === 0}
                    onChange={(e) =>
                      setUseCharm((e.currentTarget as HTMLInputElement).checked)
                    }
                  />
                  {itemName(table.charm)} 쓰기 (가진 것 {charms}개, 내려갈 때만
                  하나 씀)
                </label>
              )}
              <button
                class="button button--main"
                type="button"
                disabled={busy || !enough}
                onClick={() => void entrust()}
              >
                맡기기
              </button>
            </>
          ) : (
            unique && (
              <p class="cf__note">더 강화할 수 없어요 (+{MAX_ENHANCE}).</p>
            )
          )}
        </>
      )}
      {result && (
        <div class="cf__result" role="status" aria-label="강화 결과">
          <p>{result.text}</p>
          {result.line && <p class="cf__smith">대장장이: “{result.line}”</p>}
        </div>
      )}
    </Paper>
  );
}
