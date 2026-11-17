import { useMemo, useState } from "preact/hooks";
import book from "../../../docs/대본집.md?raw";
import rawItems from "../../../data/defs/items.json";
import rawLimits from "../../../data/defs/limits.json";
import { firebasePort } from "../../data/firebase-port";
import type { Firebase } from "../../data/firebase-app";
import { commitScene } from "../../data/scene-commit";
import { reportError, type Session } from "../../data/session";
import { sceneContextOf } from "../../rules/scene/context";
import { parseScriptBook } from "../../rules/scene/parse";
import { renderText, type SceneContext } from "../../rules/scene/run";
import { ItemListSchema } from "../../schema/defs/item";
import { LimitsSchema } from "../../schema/defs/limits";
import { Notice, Paper } from "../parts";
import "./scene.css";
import { SceneScreen, type SceneSaved } from "./SceneScreen";

/** 대본집이 없을 때(캐릭터 없이) 쓰는 값 */
const NOBODY: SceneContext = { name: "이방인", vars: {}, marks: new Set(), worldMarks: new Set(), clues: new Set(), quests: new Set(), talents: new Set(), numbers: {} };

/**
 * 장면 보기 (시험 환경에만): 대본집의 장면을 골라 본다. 캐릭터가 있으면 끝날 때 결과를 그 캐릭터에 기록한다.
 * 실제 화면에서는 퀘스트·장소가 장면을 연다(10단계).
 */
export function SceneBrowser(props: { fb: Firebase; session: Extract<Session, { status: "signedIn" }> | undefined; onExit: () => void }) {
  const parsed = useMemo(() => parseScriptBook(book), []);
  const [playing, setPlaying] = useState<{ id: string; round: number }>();
  const [filter, setFilter] = useState("");
  const character = props.session?.character;
  const characterId = props.session?.characterId;
  const ctx = character ? sceneContextOf(character) : NOBODY;

  if (parsed.issues.length > 0) {
    return <Notice title="대본집을 읽지 못했어요">{parsed.issues.map((i) => `${i.line}줄 ${i.scene}: ${i.message}`).join(" / ")}</Notice>;
  }
  const scene = playing ? parsed.scenes.find((s) => s.id === playing.id) : undefined;

  if (scene && playing) {
    const finish = async (results: Parameters<Parameters<typeof SceneScreen>[0]["onFinish"]>[0], choices: string[]): Promise<SceneSaved> => {
      if (!character || !characterId) return { kind: "none" };
      try {
        const result = await commitScene(firebasePort(props.fb.db), characterId, `scene-${scene.id}-${Date.now()}`.slice(0, 96), { id: scene.id, results, choices }, {
          limits: LimitsSchema.parse(rawLimits),
          items: new Map(ItemListSchema.parse(rawItems).items.map((item) => [item.id, item])),
          carryLimit: 100,
          now: Date.now(),
          resolve: (text) => renderText(text, ctx).map((s) => s.text).join(""),
        });
        if (result.status === "ok") return { kind: "ok", summary: result.summary };
        if (result.status === "seen") return { kind: "seen" };
        return { kind: "error", message: result.status === "rejected" ? result.detail : "잠시 뒤 다시 해 주세요" };
      } catch (error) {
        reportError(props.fb, error, "장면 결과 저장");
        return { kind: "error", message: "기록해 두었으니 GM에게 알려 주세요" };
      }
    };
    return (
      <SceneScreen
        key={`${playing.id}-${playing.round}`}
        scene={scene}
        ctx={ctx}
        onFinish={finish}
        onNext={(id) => setPlaying({ id, round: playing.round + 1 })}
        onClose={() => setPlaying(undefined)}
      />
    );
  }

  const shown = parsed.scenes.filter((s) => s.id.includes(filter));
  return (
    <main class="stage scenes">
      <Paper class="scenes__paper" label="장면 보기">
        <h1 class="paper__heading">장면 보기</h1>
        <p class="scenes__note">
          시험 환경에만 있는 목록이에요. 대본집의 장면 {parsed.scenes.length}개.{" "}
          {character ? `${character.profile.name}의 값으로 보고, 끝나면 결과를 기록해요(처음 볼 때 한 번만).` : "캐릭터가 없어 결과는 기록하지 않아요."}
        </p>
        <label class="scenes__filter">
          찾기 <input type="search" value={filter} onInput={(e) => setFilter((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <ul class="scenes__list">
          {shown.map((s) => (
            <li key={s.id}>
              <button class="scenes__item" type="button" onClick={() => setPlaying({ id: s.id, round: 0 })}>
                {s.id}
                {character?.scenes[s.id] ? <span class="scenes__seen"> · 봄</span> : null}
              </button>
            </li>
          ))}
        </ul>
        <button class="button" type="button" onClick={props.onExit}>
          돌아가기
        </button>
      </Paper>
    </main>
  );
}
