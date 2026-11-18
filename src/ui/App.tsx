import { Component, h, type ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Firebase } from "../data/firebase-app";
import { reportError, watchSession, type Session } from "../data/session";
import type { Limits } from "../schema/defs/limits";
import { LibraryHome } from "./LibraryHome";
import { LoginScreen } from "./LoginScreen";
import { Notice } from "./parts";

/** 화면을 그리다 난 오류를 잡는다. 하얗게 되지 않고 안내를 띄우며, 오류를 기록한다. */
class ErrorBoundary extends Component<
  { fb: Firebase; children: ComponentChildren },
  { failed: boolean }
> {
  override state = { failed: false };

  static override getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    reportError(this.props.fb, error, "화면 그리기");
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Notice title="책장이 잠시 흐트러졌어요">
        화면을 그리다 문제가 생겼어요. 기록해 두었으니, 새로 고쳐 다시 열어
        주세요.
        <br />
        <button
          class="button"
          type="button"
          onClick={() => window.location.reload()}
        >
          새로 고치기
        </button>
      </Notice>
    );
  }
}

/** 연습 전투는 시험 환경에만. 실제 환경 빌드에서는 이 갈래가 통째로 빠진다(`npm run check:build`가 확인) */
const PRACTICE = import.meta.env.VITE_GARDEN_ENV !== "prod";
type PracticeScreen = (props: {
  fb: Firebase;
  onExit: () => void;
}) => preact.JSX.Element;
type DungeonView = (props: {
  fb: Firebase;
  limits: Limits;
  session: Extract<Session, { status: "signedIn" }>;
  onExit: () => void;
}) => preact.JSX.Element;
type ScenesScreen = (props: {
  fb: Firebase;
  session: Extract<Session, { status: "signedIn" }> | undefined;
  onExit: () => void;
}) => preact.JSX.Element;

export function App(props: { fb: Firebase; limits: Limits }) {
  const [session, setSession] = useState<Session>({ status: "loading" });
  const [practice, setPractice] = useState<PracticeScreen | "loading">();
  const [scenes, setScenes] = useState<ScenesScreen | "loading">();
  const [dungeon, setDungeon] = useState<DungeonView | "loading">();
  const [fishing, setFishing] = useState<DungeonView | "loading">();
  const [gathering, setGathering] = useState<DungeonView | "loading">();
  const [hunting, setHunting] = useState<DungeonView | "loading">();
  const [craftingView, setCrafting] = useState<DungeonView | "loading">();
  const [training, setTraining] = useState<DungeonView | "loading">();
  const [arenaView, setArena] = useState<DungeonView | "loading">();
  const [raidView, setRaid] = useState<DungeonView | "loading">();
  const [codexView, setCodex] = useState<DungeonView | "loading">();
  useEffect(
    () => watchSession(props.fb, props.limits, setSession),
    [props.fb, props.limits],
  );
  // 시험 환경에서는 주소 끝에 #practice를 붙이면 로그인 없이 연습장이 바로 열린다 (숫자를 직접 쳐 보는 용도)
  useEffect(() => {
    if (PRACTICE && window.location.hash === "#practice") openPractice();
  }, []);

  const openPractice = () => {
    if (!PRACTICE) return;
    setPractice("loading");
    import("./battle/Practice")
      .then((module) => setPractice(() => module.Practice))
      .catch((error: unknown) => {
        reportError(props.fb, error, "연습 전투 열기");
        setPractice(undefined);
      });
  };

  const openScenes = () => {
    if (!PRACTICE) return;
    setScenes("loading");
    import("./scene/SceneBrowser")
      .then((module) => setScenes(() => module.SceneBrowser))
      .catch((error: unknown) => {
        reportError(props.fb, error, "장면 보기 열기");
        setScenes(undefined);
      });
  };

  // 던전 입구는 지도(9단계)가 생기기 전까지 시험 환경에서만
  const openDungeon = () => {
    if (!PRACTICE) return;
    setDungeon("loading");
    import("./dungeon/DungeonScreen")
      .then((module) => setDungeon(() => module.DungeonScreen))
      .catch((error: unknown) => {
        reportError(props.fb, error, "던전 열기");
        setDungeon(undefined);
      });
  };

  // 낚시도 지도(9단계)가 생기기 전까지 시험 환경에서만
  const openFishing = () => {
    if (!PRACTICE) return;
    setFishing("loading");
    import("./fishing/FishingScreen")
      .then((module) => setFishing(() => module.FishingScreen))
      .catch((error: unknown) => {
        reportError(props.fb, error, "낚시 열기");
        setFishing(undefined);
      });
  };

  // 채집도 지도(9단계)가 생기기 전까지 시험 환경에서만
  const openGathering = () => {
    if (!PRACTICE) return;
    setGathering("loading");
    import("./gathering/GatheringScreen")
      .then((module) => setGathering(() => module.GatheringScreen))
      .catch((error: unknown) => {
        reportError(props.fb, error, "채집 열기");
        setGathering(undefined);
      });
  };

  // 사냥도 지도(9단계)가 생기기 전까지 시험 환경에서만
  const openHunting = () => {
    if (!PRACTICE) return;
    setHunting("loading");
    import("./hunting/HuntingScreen")
      .then((module) => setHunting(() => module.HuntingScreen))
      .catch((error: unknown) => {
        reportError(props.fb, error, "사냥 열기");
        setHunting(undefined);
      });
  };

  // 제작도 지도(9단계)가 생기기 전까지 시험 환경에서만 (작업장이 있는 장소에서 열 수 있게 된다)
  const openCrafting = () => {
    if (!PRACTICE) return;
    setCrafting("loading");
    import("./crafting/CraftingScreen")
      .then((module) => setCrafting(() => module.CraftingScreen))
      .catch((error: unknown) => {
        reportError(props.fb, error, "제작 열기");
        setCrafting(undefined);
      });
  };

  // 훈련장도 지도(9단계)가 생기기 전까지 시험 환경에서만
  const openTraining = () => {
    if (!PRACTICE) return;
    setTraining("loading");
    import("./training/TrainingScreen")
      .then((module) => setTraining(() => module.TrainingScreen))
      .catch((error: unknown) => {
        reportError(props.fb, error, "훈련장 열기");
        setTraining(undefined);
      });
  };

  // 투기장도 지도(9단계)가 생기기 전까지 시험 환경에서만
  const openArena = () => {
    if (!PRACTICE) return;
    setArena("loading");
    import("./arena/ArenaScreen")
      .then((module) => setArena(() => module.ArenaScreen))
      .catch((error: unknown) => {
        reportError(props.fb, error, "투기장 열기");
        setArena(undefined);
      });
  };

  // 반복 레이드도 지도(9단계)가 생기기 전까지 시험 환경에서만
  const openRaid = () => {
    if (!PRACTICE) return;
    setRaid("loading");
    import("./raid/RaidScreen")
      .then((module) => setRaid(() => module.RaidScreen))
      .catch((error: unknown) => {
        reportError(props.fb, error, "반복 레이드 열기");
        setRaid(undefined);
      });
  };

  // 도감은 실제 기능 (시험 환경 전용이 아님)
  const openCodex = () => {
    setCodex("loading");
    import("./codex/CodexScreen")
      .then((module) => setCodex(() => module.CodexScreen))
      .catch((error: unknown) => {
        reportError(props.fb, error, "도감 열기");
        setCodex(undefined);
      });
  };

  const closePractice = () => {
    setPractice(undefined);
    if (window.location.hash === "#practice")
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
  };

  return (
    <ErrorBoundary fb={props.fb}>
      {PRACTICE && practice === "loading" ? (
        <Notice title="연습 전투">연습장을 여는 중…</Notice>
      ) : PRACTICE && practice ? (
        h(practice, { fb: props.fb, onExit: closePractice })
      ) : PRACTICE && scenes === "loading" ? (
        <Notice title="장면 보기">대본집을 펼치는 중…</Notice>
      ) : PRACTICE && scenes ? (
        h(scenes, {
          fb: props.fb,
          session: session.status === "signedIn" ? session : undefined,
          onExit: () => setScenes(undefined),
        })
      ) : codexView === "loading" ? (
        <Notice title="도감">도감을 펼치는 중…</Notice>
      ) : codexView && session.status === "signedIn" ? (
        h(codexView, {
          fb: props.fb,
          limits: props.limits,
          session,
          onExit: () => setCodex(undefined),
        })
      ) : PRACTICE && raidView === "loading" ? (
        <Notice title="반복 레이드">레이드 집결지로 가는 중…</Notice>
      ) : PRACTICE && raidView && session.status === "signedIn" ? (
        h(raidView, {
          fb: props.fb,
          limits: props.limits,
          session,
          onExit: () => setRaid(undefined),
        })
      ) : PRACTICE && arenaView === "loading" ? (
        <Notice title="투기장">투기장으로 가는 중…</Notice>
      ) : PRACTICE && arenaView && session.status === "signedIn" ? (
        h(arenaView, {
          fb: props.fb,
          limits: props.limits,
          session,
          onExit: () => setArena(undefined),
        })
      ) : PRACTICE && training === "loading" ? (
        <Notice title="훈련장">훈련장으로 가는 중…</Notice>
      ) : PRACTICE && training && session.status === "signedIn" ? (
        h(training, {
          fb: props.fb,
          limits: props.limits,
          session,
          onExit: () => setTraining(undefined),
        })
      ) : PRACTICE && craftingView === "loading" ? (
        <Notice title="제작">작업장으로 가는 중…</Notice>
      ) : PRACTICE && craftingView && session.status === "signedIn" ? (
        h(craftingView, {
          fb: props.fb,
          limits: props.limits,
          session,
          onExit: () => setCrafting(undefined),
        })
      ) : PRACTICE && hunting === "loading" ? (
        <Notice title="사냥">초원으로 가는 중…</Notice>
      ) : PRACTICE && hunting && session.status === "signedIn" ? (
        h(hunting, {
          fb: props.fb,
          limits: props.limits,
          session,
          onExit: () => setHunting(undefined),
        })
      ) : PRACTICE && gathering === "loading" ? (
        <Notice title="채집">산비탈로 가는 중…</Notice>
      ) : PRACTICE && gathering && session.status === "signedIn" ? (
        h(gathering, {
          fb: props.fb,
          limits: props.limits,
          session,
          onExit: () => setGathering(undefined),
        })
      ) : PRACTICE && fishing === "loading" ? (
        <Notice title="낚시">물가로 가는 중…</Notice>
      ) : PRACTICE && fishing && session.status === "signedIn" ? (
        h(fishing, {
          fb: props.fb,
          limits: props.limits,
          session,
          onExit: () => setFishing(undefined),
        })
      ) : PRACTICE && dungeon === "loading" ? (
        <Notice title="던전">입구로 가는 중…</Notice>
      ) : PRACTICE && dungeon && session.status === "signedIn" ? (
        h(dungeon, {
          fb: props.fb,
          limits: props.limits,
          session,
          onExit: () => setDungeon(undefined),
        })
      ) : session.status === "loading" ? (
        <Notice title="저편의 정원">문을 여는 중…</Notice>
      ) : session.status === "signedOut" ? (
        <LoginScreen fb={props.fb} />
      ) : (
        <LibraryHome
          fb={props.fb}
          limits={props.limits}
          session={session}
          onCodex={openCodex}
          {...(PRACTICE
            ? {
                onPractice: openPractice,
                onScenes: openScenes,
                onDungeon: openDungeon,
                onFishing: openFishing,
                onGathering: openGathering,
                onHunting: openHunting,
                onCrafting: openCrafting,
                onTraining: openTraining,
                onArena: openArena,
                onRaid: openRaid,
              }
            : {})}
        />
      )}
    </ErrorBoundary>
  );
}
