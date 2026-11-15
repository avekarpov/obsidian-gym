import { App } from "obsidian";
import { LightDb, lightDbApi } from "./lightdb";
import { EXERCISES, SCHEME_SEED } from "./program";

export const DB_NAME = "gym";

const SCHEMA = `CREATE TABLE exercises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  note TEXT,
  per_side INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE plan (
  id TEXT PRIMARY KEY,
  warmup_sets INTEGER NOT NULL DEFAULT 0,
  work_sets INTEGER NOT NULL,
  reps_min INTEGER,
  reps_max INTEGER,
  start_weight_g INTEGER
);
CREATE TABLE workouts (
  id TEXT PRIMARY KEY,
  schemes TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE sets (
  id TEXT PRIMARY KEY,
  workout_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  set_no INTEGER NOT NULL,
  kind TEXT NOT NULL,
  weight_g INTEGER NOT NULL,
  done_at TEXT NOT NULL
);
CREATE INDEX sets_by_workout ON sets (workout_id);
CREATE INDEX sets_by_exercise ON sets (exercise_id, kind, done_at);`;

function literal(value: string | number | null): string {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

function seed(): string {
  const exercises = EXERCISES.map((e) =>
    `(${[e.id, e.name, e.note, e.perSide ? 1 : 0].map(literal).join(", ")})`).join(",\n  ");
  const plan = EXERCISES.map((e) =>
    `(${[e.id, e.warmupSets, e.workSets, e.repsMin, e.repsMax, e.startWeightKg === null ? null : e.startWeightKg * 1000].map(literal).join(", ")})`).join(",\n  ");
  return `INSERT INTO exercises (id, name, note, per_side) VALUES\n  ${exercises};\n` +
    `INSERT INTO plan (id, warmup_sets, work_sets, reps_min, reps_max, start_weight_g) VALUES\n  ${plan};`;
}

function schemes(): string {
  const rows = SCHEME_SEED.map((s, i) => `(${[s.id, s.name, i + 1].map(literal).join(", ")})`).join(",\n  ");
  const items = SCHEME_SEED.flatMap((s) => s.exercises.map((exercise, i) =>
    `(${[`${s.id}:${exercise}`, s.id, exercise, i + 1].map(literal).join(", ")})`)).join(",\n  ");
  return `CREATE TABLE schemes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL
);
CREATE TABLE scheme_exercises (
  id TEXT PRIMARY KEY,
  scheme_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  position INTEGER NOT NULL
);
INSERT INTO schemes (id, name, position) VALUES\n  ${rows};
INSERT INTO scheme_exercises (id, scheme_id, exercise_id, position) VALUES\n  ${items};`;
}

export const MIGRATIONS: { id: string; sql: string }[] = [
  { id: "001_schema", sql: SCHEMA },
  { id: "002_seed", sql: seed() },
  { id: "003_schemes", sql: schemes() },
];

export async function openGymDb(app: App): Promise<LightDb> {
  const api = lightDbApi(app);
  if (!api) throw new Error("LightDB plugin is required. Enable it in Community plugins.");
  const db = await api.open(DB_NAME);
  for (const migration of MIGRATIONS) await db.migrate(migration.id, migration.sql);
  return db;
}
