/**
 * 옛 사이트 데이터의 견본. 모양은 실제와 같고 내용은 전부 지어낸 것이다.
 * (실제 내보내기 파일은 이 저장소에 두지 않는다.)
 */
const j = (value: unknown) => JSON.stringify(value);
const k = (key: string) => encodeURIComponent(key);

/** 옛 사이트 소스에 박혀 있던 CHARS 목록 */
export const sampleChars = (): unknown[] => [
  {
    tab: "가람",
    name: "아린 벨로",
    age: 16,
    job: "기사",
    stage: "종자",
    loc: "북쪽 팔",
    place: "어느 성",
    stats: { 건강: 60, 정신력: 55, 재력: 50, 인맥: 50, 평판: 50 },
    talents: ["민첩", "강건", "직관"],
    skills: { 검술: 20 },
    people: ["벨로 경 (아버지)", "이름만 있는 사람"],
    marks: ["「평온한 출생」"],
  },
  {
    tab: "나루",
    gender: "여성",
    region: "어느 황도 근방",
    family: "장인·상인",
    name: "세라 온",
    age: 15,
    loc: "황도",
    place: "황도",
    stats: { 건강: 42, 정신력: 45, 재력: 54, 인맥: 60, 평판: 50 },
    talents: ["직관", "기억력", "예민한 감각"],
    skills: {},
    people: [],
    marks: [],
  },
];

export const sampleExport = (): { store: Record<string, unknown>; gm: Record<string, unknown> } => ({
  store: {
    [k("jpg-day-cal")]: j({ year: 514, month: 1 }),

    // 가람: 숙련도가 높고 물건·기록이 있는 캐릭터
    [k("jpg-home-char-가람")]: j({
      loc: "북쪽 팔",
      place: "어느 영주성",
      stats: { 건강: 100, 정신력: 91, 재력: 44, 인맥: 61, 평판: 50 },
      skills: { 검술: 96, 레이피어: 22, 펜싱: 5, 승마: 22, 사냥: 17, 백병술: 54, "없는 기술": 30 },
      age: 17,
      job: "기사",
      stage: "종자",
      workplace: "북쪽 팔",
      dead: null,
      evoFrom: { 검무: ["곡예", "검술"] },
    }),
    [k("jpg-home-people-가람")]: j([
      { id: "ab12cd", name: "벨로 경", rel: "아버지", intimacy: 65, note: "엄한 사람", hidden: false },
      { id: "ef34gh", name: "숨은 후견인", rel: "모름", intimacy: 10, note: "", hidden: true },
    ]),
    [k("jpg-home-story-가람")]: j({
      events: [{ age: "10세", title: "첫 검", text: "목검을 받았다.", sum: "" }],
      temper: "조용하다",
      look: "키가 크다",
      quote: "…",
      etc: "",
    }),
    [k("jpg-home-loadout-가람")]: j({ atk: ["검술/검풍"], def: ["검술/되받아치기"], weapon: "기사의 장검", armor: "평상복" }),
    [k("jpg-home-stand-가람")]: j({ img: "data:image/png;base64,AAAA", fx: 0.5, fy: 0.5, a: 1 }),
    [k("jpg-home-revealed-가람")]: j("검의 재능 (흔함)"),
    [k("jpg-town-char-가람")]: j({
      wallet: 154,
      bag: [
        { name: "토끼 고기", kind: "재료", value: 12, id: "x1", qty: 2 },
        { name: "토끼 고기", kind: "재료", value: 12, id: "x2", qty: 1 },
        { name: "기사의 장검", kind: "장비", value: 400, id: "x3", qty: 1 },
        { name: "수수께끼의 돌", kind: "귀중품", value: 99, id: "x4", qty: 3 },
      ],
      quests: [{ id: "q1", region: "소프레고" }],
    }),
    [k("jpg-day-sub-513-10-가람")]: j({
      ym: { year: 513, month: 10 },
      submitted: true,
      queue: [
        { n: "배우기", detail: "검술 · 아버지에게", res: "성공" },
        { n: "쉬기", detail: "", res: "" },
      ],
    }),
    [k("jpg-day-sub-513-9-가람")]: j({ ym: { year: 513, month: 9 }, submitted: true, queue: [{ n: "일하기", detail: "영주성", res: "보통" }] }),
    [k("jpg-home-pw-가람")]: j("SECRET-PASSWORD-HASH-1"),
    [k("jpg-home-chat-가람")]: j([{ tab: "가람", name: "아린", text: "비밀 채팅", t: 1 }]),

    // 나루: 사이트에서 성장기를 마친 캐릭터 (grown이 처음 값을 덮어쓴다)
    [k("jpg-home-char-나루")]: j({
      loc: "브라켄",
      place: "브라켄",
      stats: { 건강: 46, 정신력: 58, 재력: 42, 인맥: 61, 평판: 49 },
      skills: { 신학: 26 },
      age: 16,
      job: "",
      stage: "",
      dead: null,
      evoFrom: {},
    }),
    [k("jpg-home-grown-나루")]: j({
      name: "세라 온",
      gender: "여성",
      talents: ["직관", "기억력", "예민한 감각"],
      people: ["온 부인 (어머니)"],
      marks: ["「축복받은 아이」"],
      detail: { events: ["태어났다", "자랐다"], temper: "밝다", look: "", quote: "", etc: "" },
      growth: [
        { age: 0, title: "출생", text: "" },
        { age: 5, title: "", text: "" },
      ],
      region: "어느 황도 근방",
      family: "장인·상인",
    }),
    [k("jpg-town-char-나루")]: j({ wallet: 50, bag: [], quests: [] }),

    // 다온: 생성 요청으로 들어온 캐릭터 (정보는 extra에)
    [k("jpg-home-char-new-abc123")]: j({
      loc: "스카르하임",
      place: "스카르하임",
      stats: { 건강: 52, 정신력: 44, 재력: 27, 인맥: 47, 평판: 400 },
      skills: { 농사: 15 },
      age: 16,
      job: "",
      stage: "",
      dead: null,
      evoFrom: {},
    }),
    [k("jpg-home-extra")]: j([
      {
        tab: "new-abc123",
        player: "다온",
        name: "하루",
        gender: "남성",
        talents: ["학식", "매력", "목소리"],
        people: ["마루 (아버지)"],
        marks: [],
        detail: { events: [], temper: "", look: "", quote: "", etc: "" },
        growth: [],
        region: "스카르하임",
        family: "농가",
      },
    ]),

    // 전투와 이야기
    [k("jpg-btl-b001")]: j({ id: "b001", title: "훈련장 대련", region: "북쪽 팔", mode: "spar", phase: "over", result: "win", members: ["가람"] }),
    [k("jpg-btl-b002")]: j({ id: "b002", title: "늑대 무리", region: "북쪽 팔", mode: "quest", phase: "over", result: "lose", members: ["가람"] }),
    [k("jpg-btl-b003")]: j({ id: "b003", title: "끝나지 않은 싸움", region: "황도", mode: "solo", phase: "plan", result: null, members: ["가람"] }),
    [k("jpg-btl-b001-plan-가람")]: j({ turn: 1, card: "검술/검풍" }),
    [k("jpg-btl-calls")]: j([]),
    [k("jpg-story-s001")]: j({ sid: "s001", title: "늑대 토벌", region: "북쪽 팔", phase: "story", result: "lose", members: ["가람"], battleId: "b002" }),
    [k("jpg-story-s002")]: j({ sid: "s002", title: "서신 배달", region: "황도", phase: "done", members: ["나루"] }),

    // 버리는 것
    [k("jpg-home-presence")]: j({ 가람: { loc: "북쪽 팔", name: "아린 벨로", t: 1 } }),
    [k("jpg-req-list")]: j([{ id: "r1", player: "다온", pwHash: "SECRET-PASSWORD-HASH-2", status: "done", data: {} }]),
    [k("jpg-town-board-북쪽 팔")]: j({ ym: 6168, list: [] }),
    [k("jpg-home-skilldef")]: j({ families: {}, ladder: {}, evo: [], effects: {}, items: {} }),
    [k("jpg-mystery-key")]: j({ what: "?" }),
  },
  gm: {
    [k("jpg-home-gmhidden-가람")]: j("검의 재능 (흔함)"),
    [k("jpg-home-gmhidden-people-가람")]: j({ ab12cd: "사실은 원수의 친구" }),
    [k("jpg-home-gmhidden-나루")]: j("없음"),
    [k("jpg-home-gmhidden-new-abc123")]: j("약초의 코 (흔함)"),
    [k("jpg-home-gmhidden-req-r1")]: j("없음"),
  },
});
