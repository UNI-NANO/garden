import type { Character } from "../schema/character";
import { monthLabel } from "./calendar";

/** 도서관 홈이 보여줄 값. 화면은 이 값을 그대로 그리기만 한다. */
export interface HomeView {
  /** 열람증의 꼬리표 (예: "창립") */
  badge: string | undefined;
  /** 이름을 줄마다 (성과 이름을 나눠 적는다) */
  nameLines: string[];
  /** "소프레고 출신 · 15세" */
  originLine: string;
  /** "카르텔 조직원 · 시카리오" */
  jobLine: string | undefined;
  location: string | undefined;
  month: string;
  actions: string;
  savedActions: string | undefined;
  life: { when: string | undefined; kind: string; text: string }[];
  /** 살아 있지 않으면 그 상태 (예: "죽음", "승인 대기") */
  stageNote: string | undefined;
}

export function buildHomeView(character: Character): HomeView {
  const { profile, meta, month } = character;
  const origin = profile.origin ? `${profile.origin.region} 출신` : undefined;
  const job = profile.job;
  const location = profile.location;

  return {
    badge: meta.founder ? "창립" : undefined,
    nameLines: profile.name.split(/\s+/).filter((part) => part !== ""),
    originLine: [origin, `${profile.age}세`].filter((part) => part !== undefined).join(" · "),
    jobLine: job ? [job.name, job.stage].filter((part) => part !== "").join(" · ") : undefined,
    location: location ? (location.region === location.place ? location.region : `${location.region} — ${location.place}`) : undefined,
    month: monthLabel(month.key),
    actions: `주 행동 ${month.mainActions} · 작은 행동 ${month.minorActions}`,
    savedActions: month.savedActions > 0 ? `저장 행동 ${month.savedActions}` : undefined,
    // 가장 최근 것이 위로 오게
    life: [...character.life].reverse().map((line) => ({
      when: line.when !== undefined ? monthLabel(line.when) : undefined,
      kind: line.kind,
      text: line.text,
    })),
    stageNote: meta.stage === "살아 있음" ? undefined : meta.stage,
  };
}
