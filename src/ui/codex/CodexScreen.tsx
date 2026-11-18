import { useMemo, useState } from "preact/hooks";
import rawDungeons from "../../../data/defs/dungeons.json";
import rawEnemies from "../../../data/defs/enemies.json";
import rawFishing from "../../../data/defs/fishing.json";
import rawGathering from "../../../data/defs/gathering.json";
import rawHunting from "../../../data/defs/hunting.json";
import rawItems from "../../../data/defs/items.json";
import rawRaids from "../../../data/defs/raids.json";
import rawBattle from "../../../data/defs/battle.json";
import type { Firebase } from "../../data/firebase-app";
import { reportError, type Session } from "../../data/session";
import { enemyNumbers } from "../../rules/battle/numbers";
import {
  codexStage,
  dropsOf,
  fastReveal,
  inCodex,
  type CodexStage,
} from "../../rules/codex";
import {
  BattleRulesSchema,
  EnemyListSchema,
  type BattleRules,
  type Enemy,
} from "../../schema/defs/battle";
import { DungeonListSchema, type Dungeon } from "../../schema/defs/dungeon";
import { FishingDefsSchema } from "../../schema/defs/fishing";
import { GatheringDefsSchema } from "../../schema/defs/gathering";
import { HuntingDefsSchema, type HuntingDefs } from "../../schema/defs/hunting";
import { ItemListSchema, type Item } from "../../schema/defs/item";
import type { Limits } from "../../schema/defs/limits";
import { RaidDefsSchema, type RaidDefs } from "../../schema/defs/raid";
import { idToKey } from "../../schema/keys";
import { Notice, Paper } from "../parts";
import "./codex.css";

type SignedIn = Extract<Session, { status: "signedIn" }>;
type Tab = "적" | "물건" | "물고기" | "약초";

interface CodexDefs {
  enemies: Enemy[];
  items: Item[];
  fish: ReadonlySet<string>;
  herbs: ReadonlySet<string>;
  battle: BattleRules;
  sources: { dungeons: Dungeon[]; hunting: HuntingDefs; raids: RaidDefs };
}

const TARGETING: Record<Enemy["targeting"], string> = {
  앞줄: "앞줄을 노린다",
  뒷줄: "뒷줄을 노린다",
  "체력이 가장 낮은 쪽": "체력이 가장 낮은 쪽을 노린다",
  무작위: "아무나 노린다",
};

const STAGE_LABEL: Record<CodexStage, string> = {
  0: "처음 봄",
  1: "1단계",
  2: "2단계",
  3: "도감 완성",
};

/**
 * 도감 (docs/ui/Codex, 8단계 ⑥ 가). 적은 싸울수록 한 단계씩 드러나고, 물건·물고기·약초는 처음 얻으면 적힌다.
 * 모르는 것은 「???」. 적: 0 이름 · 1 위력·저항 · 2 성향·약점·드롭 · 3 서식지·설명문·완성 보상.
 */
export function CodexScreen(props: {
  fb: Firebase;
  limits: Limits;
  session: SignedIn;
  onExit: () => void;
}) {
  const defs = useMemo<CodexDefs | Error>(() => {
    try {
      const fishing = FishingDefsSchema.parse(rawFishing);
      const gathering = GatheringDefsSchema.parse(rawGathering);
      return {
        enemies: EnemyListSchema.parse(rawEnemies).enemies.filter(inCodex),
        items: ItemListSchema.parse(rawItems).items,
        fish: new Set(
          fishing.spots.flatMap((s) =>
            Object.values(s.zones).flatMap((z) => z.map((f) => f.item)),
          ),
        ),
        herbs: new Set(
          gathering.spots.flatMap((s) => s.herbs.map((h) => h.item)),
        ),
        battle: BattleRulesSchema.parse(rawBattle),
        sources: {
          dungeons: DungeonListSchema.parse(rawDungeons).dungeons,
          hunting: HuntingDefsSchema.parse(rawHunting),
          raids: RaidDefsSchema.parse(rawRaids),
        },
      };
    } catch (error) {
      reportError(props.fb, error, "도감 정의 읽기");
      return error instanceof Error ? error : new Error(String(error));
    }
  }, [props.fb]);
  const { character } = props.session;
  if (defs instanceof Error)
    return (
      <Notice title="도감">도감을 펼치지 못했어요. 기록해 두었어요.</Notice>
    );
  if (!character)
    return <Notice title="도감">열람증이 준비되면 볼 수 있어요.</Notice>;
  return <Codex {...props} defs={defs} character={character} />;
}

function Codex(props: {
  limits: Limits;
  onExit: () => void;
  defs: CodexDefs;
  character: NonNullable<SignedIn["character"]>;
}) {
  const { limits, defs, character } = props;
  const [tab, setTab] = useState<Tab>("적");
  const [picked, setPicked] = useState<string>();
  const fast = fastReveal(character, limits);
  const stageOf = (id: string) =>
    codexStage(character.codex.enemies[idToKey(id)], fast, limits);
  const itemName = (id: string) =>
    defs.items.find((i) => i.id === id)?.name ?? id;
  const itemsOf = (t: Tab) =>
    defs.items.filter((i) =>
      t === "물고기"
        ? defs.fish.has(i.id)
        : t === "약초"
          ? defs.herbs.has(i.id)
          : !defs.fish.has(i.id) && !defs.herbs.has(i.id),
    );
  const list = tab === "적" ? defs.enemies : itemsOf(tab);
  const known =
    tab === "적"
      ? defs.enemies.filter((e) => stageOf(e.id) !== undefined).length
      : itemsOf(tab).filter(
          (i) => character.codex.items[idToKey(i.id)] !== undefined,
        ).length;
  const enemy =
    tab === "적" ? defs.enemies.find((e) => e.id === picked) : undefined;
  const stage = enemy ? stageOf(enemy.id) : undefined;

  return (
    <main class="stage cx">
      <header class="bar">
        <div class="bar__inner">
          <h1 class="bar__title">도감</h1>
          <div class="bar__side">
            <button class="bar__button" type="button" onClick={props.onExit}>
              나가기
            </button>
          </div>
        </div>
      </header>

      <nav class="cx__tabs" aria-label="도감 갈래">
        {(["적", "물건", "물고기", "약초"] as const).map((t) => (
          <button
            key={t}
            class="button"
            type="button"
            aria-pressed={t === tab}
            onClick={() => {
              setTab(t);
              setPicked(undefined);
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      <div class="cx__body">
        <Paper class="cx__grid-card" label={`${tab} 도감`}>
          <h2 class="cx__title">
            {tab} 도감 · {known} / {list.length}
          </h2>
          <ul class="cx__grid">
            {tab === "적"
              ? defs.enemies.map((e) => {
                  const s = stageOf(e.id);
                  return (
                    <li key={e.id}>
                      <button
                        class={`cx__cell ${e.id === picked ? "cx__cell--picked" : ""}`}
                        type="button"
                        disabled={s === undefined}
                        onClick={() => setPicked(e.id)}
                      >
                        <span class="cx__pic" aria-hidden="true">
                          {s === undefined ? "?" : e.name.slice(0, 1)}
                        </span>
                        <span class="cx__name">
                          {s === undefined ? "???" : e.name}
                        </span>
                        <span class="cx__stage">
                          {s === undefined
                            ? "???"
                            : `${STAGE_LABEL[s]} · ${character.codex.enemies[idToKey(e.id)] ?? 0}번 이김`}
                        </span>
                      </button>
                    </li>
                  );
                })
              : itemsOf(tab).map((i) => {
                  const at = character.codex.items[idToKey(i.id)];
                  return (
                    <li key={i.id}>
                      <div class="cx__cell">
                        <span class="cx__pic" aria-hidden="true">
                          {at === undefined ? "?" : i.name.slice(0, 1)}
                        </span>
                        <span class="cx__name">
                          {at === undefined ? "???" : i.name}
                        </span>
                        <span class="cx__stage">
                          {at === undefined
                            ? "???"
                            : `처음 얻음 ${new Date(at).toLocaleDateString("ko-KR")}`}
                        </span>
                      </div>
                    </li>
                  );
                })}
          </ul>
        </Paper>

        {tab === "적" && (
          <Paper class="cx__detail" label="적 자세히">
            {enemy && stage !== undefined ? (
              <EnemyDetail
                enemy={enemy}
                stage={stage}
                defs={defs}
                itemName={itemName}
              />
            ) : (
              <p class="cx__note">
                만난 적을 고르면 자세히 볼 수 있어요. 싸워 이길수록 더 드러나요.
              </p>
            )}
            {fast && (
              <p class="cx__note">재능 덕분에 한 단계씩 빨리 드러나요.</p>
            )}
          </Paper>
        )}
      </div>
    </main>
  );
}

function EnemyDetail(props: {
  enemy: Enemy;
  stage: CodexStage;
  defs: CodexDefs;
  itemName: (id: string) => string;
}) {
  const { enemy, stage, defs } = props;
  const n = enemyNumbers(defs.battle, enemy);
  const mults = enemy.actions.map((a) => a.powerMultiplier ?? 1);
  const power = (m: number) => Math.round(n.power * m * 10) / 10;
  const low = power(Math.min(...mults));
  const high = power(Math.max(...mults));
  const powerRange = low === high ? `${low}` : `${low} ~ ${high}`;
  const resist = Object.entries(enemy.resist)
    .map(([type, level]) => `${type} ${level}`)
    .join(" · ");
  const weak = Object.entries(enemy.resist)
    .filter(([, level]) => level === "약함")
    .map(([type]) => type);
  const drops = dropsOf(enemy, defs.sources).map(props.itemName);
  const hidden = "???";
  return (
    <>
      <h2 class="cx__title">
        {enemy.name} · {STAGE_LABEL[stage]}
      </h2>
      <dl class="cx__facts">
        <dt>기술</dt>
        <dd>{enemy.actions.map((a) => a.name).join(" · ")}</dd>
        <dt>위력</dt>
        <dd>{stage >= 1 ? powerRange : hidden}</dd>
        <dt>저항</dt>
        <dd>{stage >= 1 ? resist : hidden}</dd>
        <dt>성향</dt>
        <dd>{stage >= 2 ? TARGETING[enemy.targeting] : hidden}</dd>
        <dt>약점</dt>
        <dd>
          {stage >= 2 ? (weak.length > 0 ? weak.join(" · ") : "없음") : hidden}
        </dd>
        <dt>드롭</dt>
        <dd>
          {stage >= 2
            ? drops.length > 0
              ? drops.join(" · ")
              : "없음"
            : hidden}
        </dd>
        <dt>서식지</dt>
        <dd>{stage >= 3 ? (enemy.codex?.habitat ?? "—") : hidden}</dd>
      </dl>
      {stage >= 3 ? (
        <>
          {enemy.codex?.text && <p class="cx__text">{enemy.codex.text}</p>}
          {enemy.codex?.completionMoney ? (
            <p class="cx__note">
              완성 보상 · {enemy.codex.completionMoney} 잎전 (받음)
            </p>
          ) : null}
        </>
      ) : (
        <p class="cx__note">
          {enemy.codex?.completionMoney
            ? `도감을 완성하면 ${enemy.codex.completionMoney} 잎전`
            : ""}
        </p>
      )}
    </>
  );
}
