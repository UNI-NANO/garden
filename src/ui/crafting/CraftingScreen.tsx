import { push, ref } from "firebase/database";
import { useMemo, useState } from "preact/hooks";
import rawCrafting from "../../../data/defs/crafting.json";
import rawItems from "../../../data/defs/items.json";
import {
  commitCombine,
  commitCraft,
  type CraftCommitResult,
} from "../../data/crafting";
import type { Firebase } from "../../data/firebase-app";
import { firebasePort } from "../../data/firebase-port";
import { reportError, type Session } from "../../data/session";
import { countInBag, knowsRecipe, recipeByName } from "../../rules/crafting";
import {
  CraftingDefsSchema,
  type CraftingDefs,
  type Recipe,
} from "../../schema/defs/crafting";
import { ItemListSchema, type Item } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import type { Judgement } from "../../schema/defs/skill-table";
import { idToKey } from "../../schema/keys";
import { JudgeBar } from "../battle/JudgeBar";
import "../battle/battle.css";
import { withJosa } from "../josa";
import { Notice, Paper } from "../parts";
import "./crafting.css";

type SignedIn = Extract<Session, { status: "signedIn" }>;

/**
 * 제작 (docs/ui/Craft·Forge, 8단계 ③ 가). 작업장(대장간·약방·부엌)을 고르고, 아는 레시피로 만든다.
 * 만들기는 타이밍 미니게임(전투의 판정 바를 작업장마다 정한 횟수만큼). 실패는 없고 품질만 달라진다.
 * 「조합 시도」로 가방의 재료를 넣어 보며 새 레시피를 발견한다(틀리면 재료 일부를 잃는다).
 */
export function CraftingScreen(props: {
  fb: Firebase;
  limits: Limits;
  session: SignedIn;
  onExit: () => void;
}) {
  const defs = useMemo<
    { crafting: CraftingDefs; items: ReadonlyMap<string, Item> } | Error
  >(() => {
    try {
      return {
        crafting: CraftingDefsSchema.parse(rawCrafting),
        items: new Map(
          ItemListSchema.parse(rawItems).items.map((i) => [i.id, i]),
        ),
      };
    } catch (error) {
      reportError(props.fb, error, "제작 정의 읽기");
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [props.fb]);
  const { character, characterId } = props.session;
  if (defs instanceof Error)
    return (
      <Notice title="제작">
        레시피 기록을 읽지 못했어요. 기록해 두었어요.
      </Notice>
    );
  if (!character || !characterId)
    return <Notice title="제작">열람증이 준비되면 만들 수 있어요.</Notice>;
  return (
    <Crafting
      {...props}
      defs={defs}
      characterId={characterId}
      character={character}
    />
  );
}

function Crafting(props: {
  fb: Firebase;
  limits: Limits;
  onExit: () => void;
  defs: { crafting: CraftingDefs; items: ReadonlyMap<string, Item> };
  characterId: string;
  character: NonNullable<SignedIn["character"]>;
}) {
  const { fb, limits, defs, character, characterId } = props;
  const { crafting } = defs;
  const [stationId, setStationId] = useState(crafting.stations[0]!.id);
  const station = crafting.stations.find((s) => s.id === stationId)!;
  const [making, setMaking] = useState<{
    recipe: Recipe;
    judgements: Judgement[];
  }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [picked, setPicked] = useState<Record<string, number>>({});
  const itemName = (id: string) => defs.items.get(id)?.name ?? id;
  const bag = character.bag;

  // 보류된 [레시피]는 저장할 때 배우지만, 목록에는 미리 보인다
  const learned: Record<string, true> = { ...character.recipes };
  for (const p of character.pendingResults) {
    const r =
      p.cmd === "레시피"
        ? recipeByName(p.args[0] ?? "", crafting.recipes)
        : undefined;
    if (r) learned[idToKey(r.id)] = true;
  }
  const recipes = crafting.recipes.filter(
    (r) => r.station === stationId && knowsRecipe(r, learned),
  );
  const enough = (r: Recipe) =>
    r.inputs.every((i) => countInBag(bag, i.item) >= i.quantity);
  const ctx = () => ({
    limits,
    items: defs.items,
    now: Date.now(),
    carryLimit: 100,
  });
  const say = (
    result: CraftCommitResult,
    ok: (r: Extract<CraftCommitResult, { status: "ok" }>) => string,
  ) => {
    if (result.status === "ok") setMessage(ok(result));
    else {
      setMessage(
        result.status === "rejected"
          ? `하지 못했어요: ${result.detail}`
          : "하지 못했어요. 잠시 뒤 다시 해 주세요.",
      );
      if (result.status !== "duplicate")
        reportError(fb, new Error(`제작: ${result.status}`), "제작 저장");
    }
  };

  const judged = async (judgement: Judgement) => {
    if (!making) return;
    const judgements = [...making.judgements, judgement];
    if (judgements.length < station.game.hits)
      return setMaking({ ...making, judgements });
    setMaking(undefined);
    setBusy(true);
    try {
      const requestId =
        push(ref(fb.db, "requests")).key ?? `craft${Date.now()}`;
      const result = await commitCraft(
        firebasePort(fb.db),
        characterId,
        requestId,
        { recipeId: making.recipe.id, judgements },
        crafting,
        ctx(),
      );
      say(
        result,
        (r) =>
          `${withJosa(making.recipe.name, "을", "를")} 만들었어요 · 품질 ${r.quality ?? ""}${r.mailed.length > 0 ? " (가방이 넘쳐 우편함으로)" : ""}`,
      );
    } catch (error) {
      reportError(fb, error, "제작");
      setMessage("만들지 못했어요. 잠시 뒤 다시 해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const combine = async () => {
    const inputs = Object.entries(picked)
      .filter(([, q]) => q > 0)
      .map(([item, quantity]) => ({ item, quantity }));
    if (inputs.length === 0) return setMessage("넣을 재료를 골라 주세요.");
    setBusy(true);
    try {
      const requestId =
        push(ref(fb.db, "requests")).key ?? `combine${Date.now()}`;
      const result = await commitCombine(
        firebasePort(fb.db),
        characterId,
        requestId,
        { stationId, inputs },
        crafting,
        ctx(),
      );
      say(result, (r) =>
        r.learned
          ? `새 레시피를 알아냈어요: ${crafting.recipes.find((x) => x.id === r.learned)?.name ?? r.learned}`
          : `맞는 조합이 아니었어요. 잃은 것: ${(r.lost ?? []).map((l) => `${itemName(l.item)} ${l.quantity}`).join(", ")}`,
      );
      setPicked({});
    } catch (error) {
      reportError(fb, error, "조합 시도");
      setMessage("하지 못했어요. 잠시 뒤 다시 해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  const materials = [
    ...new Set(Object.values(bag.stacks).map((s) => s.itemId)),
  ].sort((a, b) => itemName(a).localeCompare(itemName(b), "ko"));

  return (
    <main class="stage cf">
      <header class="bar">
        <div class="bar__inner">
          <h1 class="bar__title">제작 — {station.name}</h1>
          <div class="bar__side">
            <button class="bar__button" type="button" onClick={props.onExit}>
              나가기
            </button>
          </div>
        </div>
      </header>

      <nav class="cf__stations" aria-label="작업장">
        {crafting.stations.map((s) => (
          <button
            key={s.id}
            class="button"
            type="button"
            aria-pressed={s.id === stationId}
            onClick={() => {
              setStationId(s.id);
              setPicked({});
              setMessage(undefined);
            }}
          >
            {s.name}
          </button>
        ))}
      </nav>
      {message && (
        <p class="cf__message" role="status">
          {message}
        </p>
      )}

      <div class="cf__body">
        <Paper class="cf__recipes" label="아는 레시피">
          <h2 class="cf__title">아는 레시피 · {station.game.name}</h2>
          <ul class="cf__list">
            {recipes.map((r) => (
              <li key={r.id} class="cf__recipe">
                <div>
                  <b>{r.name}</b>
                  <span class="cf__output">
                    {" "}
                    → {itemName(r.output.item)} ×{r.output.quantity}
                  </span>
                  <ul class="cf__inputs">
                    {r.inputs.map((i) => {
                      const have = countInBag(bag, i.item);
                      return (
                        <li
                          key={i.item}
                          class={have < i.quantity ? "cf__short" : ""}
                        >
                          {itemName(i.item)} {have}/{i.quantity}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <button
                  class="button button--main"
                  type="button"
                  disabled={busy || !enough(r)}
                  onClick={() => setMaking({ recipe: r, judgements: [] })}
                >
                  만들기
                </button>
              </li>
            ))}
          </ul>
          {station.mastery && (
            <p class="cf__note">
              {withJosa(station.name, "은", "는")} 숙련도도 품질에 반영돼요.
            </p>
          )}
        </Paper>

        <Paper class="cf__combine" label="조합 시도">
          <h2 class="cf__title">조합 시도</h2>
          <p class="cf__note">
            레시피 없이 재료를 넣어 봐요. 맞는 조합이면 레시피를 알게 되고,
            아니면 넣은 재료의 절반을 잃어요.
          </p>
          {materials.length === 0 && <p>가방에 재료가 없어요.</p>}
          <ul class="cf__list">
            {materials.map((item) => {
              const have = countInBag(bag, item);
              const q = picked[item] ?? 0;
              return (
                <li key={item} class="cf__pick">
                  <span>
                    {itemName(item)} <span class="cf__have">({have})</span>
                  </span>
                  <span class="cf__qty">
                    <button
                      class="button button--small"
                      type="button"
                      aria-label={`${itemName(item)} 빼기`}
                      disabled={q <= 0}
                      onClick={() => setPicked({ ...picked, [item]: q - 1 })}
                    >
                      −
                    </button>
                    <span aria-label={`${itemName(item)} 넣을 수`}>{q}</span>
                    <button
                      class="button button--small"
                      type="button"
                      aria-label={`${itemName(item)} 넣기`}
                      disabled={q >= have}
                      onClick={() => setPicked({ ...picked, [item]: q + 1 })}
                    >
                      +
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          <button
            class="button"
            type="button"
            disabled={busy || materials.length === 0}
            onClick={() => void combine()}
          >
            넣어 보기
          </button>
        </Paper>
      </div>

      {making && (
        <JudgeBar
          title={`${making.recipe.name} · ${station.game.name}`}
          hitIndex={making.judgements.length}
          hitCount={station.game.hits}
          widths={station.game.widths}
          length={100}
          sweepMs={station.game.sweepMs}
          done={making.judgements}
          onJudge={(j) => void judged(j)}
        />
      )}
    </main>
  );
}
