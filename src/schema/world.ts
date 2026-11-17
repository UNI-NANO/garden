import { z } from "zod";

/** 현실 날짜 키 (하루 경계 기준). 예: "2026-12-01" */
export const DateKeySchema = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);

/** 하루 계산의 단계 (명세서 「하루 계산」). 새 시스템이 생기면 그 단계가 여기 더해진다 */
export const DAILY_STEPS = ["백업", "달 넘어감", "마무리"] as const;
export const DailyStepSchema = z.enum(DAILY_STEPS);
export type DailyStep = z.infer<typeof DailyStepSchema>;

/**
 * 세계 시계 (`/world/clock`). 쓰는 것은 하루 계산(관리자 키)과 GM뿐.
 * 명세서 「세계 시계와 달 행동」·「하루 계산」.
 */
export const WorldClockSchema = z.strictObject({
  /** 성력 연도 */
  year: z.number().int().min(1),
  /** 0~10은 열한 달, 11은 이름 없는 다섯 날 */
  monthIndex: z.number().int().min(0).max(11),
  /** 이번 달 키 "연도-달 순번". year·monthIndex와 늘 같다(보안 규칙이 캐릭터의 달 키와 바로 비교한다) */
  monthKey: z.string().regex(/^[0-9]+-(?:[0-9]|1[01])$/),
  /** 마지막으로 처리를 끝낸 날짜 */
  lastDateKey: DateKeySchema,
  /** 계산 중: 이 동안 달 행동 요청을 받지 않는다 */
  computing: z.boolean(),
  /** 진행 중인 하루 계산: 어느 날짜를 어느 단계까지 끝냈는지. 실패 뒤 다음 실행이 이어서 한다 */
  progress: z.strictObject({ dateKey: DateKeySchema, done: z.array(DailyStepSchema) }).optional(),
});
export type WorldClock = z.infer<typeof WorldClockSchema>;

/** 세계 시계의 자리 */
export const WORLD_CLOCK_PATH = "world/clock";

/** 하루 계산 실행 기록 (`/world/runs/{runId}`) */
export const DailyRunSchema = z.strictObject({
  startedAt: z.number().int().min(0),
  finishedAt: z.number().int().min(0),
  ok: z.boolean(),
  /** 처리한 날짜들 */
  days: z.array(DateKeySchema),
  /** 단계별 메모 (건너뜀, 처리 수 등) */
  notes: z.array(z.string()).default([]),
  error: z.string().optional(),
});
export type DailyRun = z.infer<typeof DailyRunSchema>;
