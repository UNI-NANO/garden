import { z } from "zod";

/** 환경 이름. 시험용 프로젝트는 Vitest의 "test" 모드와 헷갈리지 않게 staging이라 부른다. */
export const EnvNameSchema = z.enum(["emulator", "staging", "prod"]);
export type EnvName = z.infer<typeof EnvNameSchema>;

export const FirebaseConfigSchema = z.strictObject({
  apiKey: z.string().min(1),
  authDomain: z.string().min(1),
  databaseURL: z.url(),
  projectId: z.string().min(1),
  storageBucket: z.string().min(1),
  messagingSenderId: z.string().min(1),
  appId: z.string().min(1),
});
export type FirebaseConfig = z.infer<typeof FirebaseConfigSchema>;

export const EnvConfigSchema = z
  .strictObject({
    name: EnvNameSchema,
    firebase: FirebaseConfigSchema,
    /** 에뮬레이터 주소. emulator 환경에서만 있고, 다른 환경에는 없어야 한다. */
    emulator: z
      .strictObject({
        host: z.enum(["127.0.0.1", "localhost"]),
        databasePort: z.number().int().min(1).max(65535),
        authPort: z.number().int().min(1).max(65535),
      })
      .optional(),
  })
  .refine((env) => (env.name === "emulator") === (env.emulator !== undefined), {
    message: "emulator 칸은 emulator 환경에만 있어야 한다",
  })
  .refine((env) => env.name !== "emulator" || env.firebase.projectId.startsWith("demo-"), {
    message: "emulator 환경의 projectId는 demo-로 시작해야 한다 (실제 프로젝트에 닿지 않게)",
  });
export type EnvConfig = z.infer<typeof EnvConfigSchema>;
