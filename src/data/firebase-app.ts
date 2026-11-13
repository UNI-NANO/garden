import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";
import { connectDatabaseEmulator, getDatabase, type Database } from "firebase/database";
import type { EnvConfig } from "../schema/env";

export interface Firebase {
  env: EnvConfig;
  auth: Auth;
  db: Database;
}

/** 고른 환경으로 Firebase를 연다. emulator 환경이면 로컬 에뮬레이터에 붙는다. */
export function openFirebase(env: EnvConfig): Firebase {
  const app = initializeApp(env.firebase);
  const auth = getAuth(app);
  const db = getDatabase(app);
  if (env.emulator !== undefined) {
    connectAuthEmulator(auth, `http://${env.emulator.host}:${env.emulator.authPort}`, { disableWarnings: true });
    connectDatabaseEmulator(db, env.emulator.host, env.emulator.databasePort);
  }
  return { env, auth, db };
}
