import { useState } from "preact/hooks";
import type { Firebase } from "../data/firebase-app";
import { reportError, signOut, type Session } from "../data/session";
import { buildHomeView, type HomeView } from "../rules/home-view";
import { Paper } from "./parts";

type SignedIn = Extract<Session, { status: "signedIn" }>;
type Tab = "card" | "life";

export function LibraryHome(props: { fb: Firebase; session: SignedIn }) {
  const { session } = props;
  const [tab, setTab] = useState<Tab>("card");
  const view = session.character ? buildHomeView(session.character) : undefined;
  const leave = () => void signOut(props.fb).catch((error: unknown) => reportError(props.fb, error, "로그아웃"));

  return (
    <main class="stage home">
      <header class="bar">
        <div class="bar__inner">
          <h1 class="bar__title">세계수 도서관</h1>
          <div class="bar__side">
            {session.isGm && <span class="tag">GM</span>}
            <span class="bar__name">{session.displayName || "이름 없는 이방인"}</span>
            <button class="bar__button" type="button" onClick={leave}>
              나가기
            </button>
          </div>
        </div>
      </header>

      <div class="home__body">
        <div class="home__desk">
          <div class="speech">
            <span class="speech__who">사서</span>
            <p class="speech__text">{greeting(session, view)}</p>
          </div>
          <nav class="books" aria-label="도서관 서가">
            <button class={`book ${tab === "life" ? "book--open" : ""}`} type="button" disabled={!view} onClick={() => setTab(tab === "life" ? "card" : "life")}>
              <span>내 일생</span>
            </button>
            <button class="book book--soon" type="button" disabled title="준비 중">
              <span>열람실</span>
            </button>
            <button class="book book--soon" type="button" disabled title="준비 중">
              <span>월보</span>
            </button>
          </nav>
          <p class="home__soon">열람실과 월보는 아직 준비 중이에요.</p>
        </div>

        {view ? tab === "life" ? <LifeBook view={view} onClose={() => setTab("card")} /> : <ReaderCard view={view} /> : <Waiting problem={session.problem} />}
      </div>
    </main>
  );
}

function greeting(session: SignedIn, view: HomeView | undefined): string {
  if (session.problem !== undefined) return "책장이 조금 흐트러졌네요. 곧 바로잡을게요.";
  if (!view) return "어서 오세요. 열람증을 준비하고 있으니 조금만 기다려 주세요.";
  if (view.stageNote !== undefined) return "이 책은 지금 펼칠 수 없어요.";
  return "깨셨군요. 오늘은 어디서부터 읽을까요.";
}

function ReaderCard(props: { view: HomeView }) {
  const { view } = props;
  return (
    <Paper class="card" label="열람증">
      <div class="card__head">
        <h2 class="paper__heading">열람증</h2>
        {view.badge !== undefined && <span class="card__badge">{view.badge}</span>}
      </div>
      <div class="card__who">
        <div class="card__portrait" aria-hidden="true">
          <svg viewBox="0 0 132 176">
            <circle cx="66" cy="62" r="26" />
            <path d="M18 176 Q22 104 66 104 Q110 104 114 176 Z" />
          </svg>
        </div>
        <div class="card__text">
          <p class="card__name">
            {view.nameLines.map((line) => (
              <span>{line}</span>
            ))}
          </p>
          <p class="card__sub">
            {view.originLine}
            {view.jobLine !== undefined && (
              <>
                <br />
                {view.jobLine}
              </>
            )}
          </p>
          {view.stageNote !== undefined && <p class="card__stage">{view.stageNote}</p>}
        </div>
      </div>
      <dl class="card__facts">
        <dt>지금 있는 곳</dt>
        <dd>{view.location ?? "알 수 없음"}</dd>
        <dt>세계의 달</dt>
        <dd>{view.month}</dd>
        <dt>남은 행동</dt>
        <dd>
          {view.actions}
          {view.savedActions !== undefined && <span class="card__saved"> · {view.savedActions}</span>}
        </dd>
      </dl>
      <div class="card__story">
        <div>
          <p class="card__story-label">가문 이야기</p>
          <p class="card__story-title">아직 준비 중이에요</p>
        </div>
        <button class="button button--main" type="button" disabled title="준비 중">
          이어하기
        </button>
      </div>
    </Paper>
  );
}

function LifeBook(props: { view: HomeView; onClose: () => void }) {
  const { life } = props.view;
  return (
    <Paper class="card life" label="내 일생">
      <div class="card__head">
        <h2 class="paper__heading">내 일생</h2>
        <button class="button" type="button" onClick={props.onClose}>
          덮기
        </button>
      </div>
      {life.length === 0 ? (
        <p class="life__empty">아직 적힌 것이 없어요.</p>
      ) : (
        <ol class="life__list">
          {life.map((line) => (
            <li class="life__line">
              <span class="life__kind">{line.kind}</span>
              <span class="life__text">
                {line.when !== undefined && <span class="life__when">{line.when}</span>}
                {line.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Paper>
  );
}

function Waiting(props: { problem: string | undefined }) {
  return (
    <Paper class="card waiting" label="열람증">
      <div class="card__head">
        <h2 class="paper__heading">열람증</h2>
      </div>
      {props.problem !== undefined ? (
        <p class="waiting__text" role="alert">
          {props.problem}
        </p>
      ) : (
        <>
          <p class="waiting__text">사서가 열람증을 준비하고 있어요.</p>
          <p class="waiting__hint">준비가 끝나면 이 자리에 열람증이 놓입니다. 창을 열어 두면 저절로 바뀌어요.</p>
        </>
      )}
    </Paper>
  );
}
