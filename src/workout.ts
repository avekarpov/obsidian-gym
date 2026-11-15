import { LightDb } from "./lightdb";

export type SetKind = "warmup" | "work";

export interface Exercise {
  id: string;
  name: string;
  note: string | null;
  perSide: boolean;
  warmupSets: number;
  workSets: number;
  repsMin: number | null;
  repsMax: number | null;
  startWeightG: number | null;
}

export interface Scheme {
  id: string;
  name: string;
  exercises: string[];
}

export interface Step {
  exercise: Exercise;
  scheme: Scheme;
  setNo: number;
  setCount: number;
  kind: SetKind;
  exerciseIndex: number;
  exerciseCount: number;
}

export interface Workout {
  id: string;
  schemes: string[];
  startedAt: string;
  finishedAt: string | null;
}

export function loadExercises(db: LightDb): Map<string, Exercise> {
  const rows = db.all(`SELECT e.id, e.name, e.note, e.per_side, p.warmup_sets, p.work_sets, p.reps_min, p.reps_max, p.start_weight_g
    FROM exercises e JOIN plan p ON p.id = e.id`);
  return new Map(rows.map((r) => [r.id as string, {
    id: r.id as string,
    name: r.name as string,
    note: r.note as string | null,
    perSide: r.per_side === 1,
    warmupSets: r.warmup_sets as number,
    workSets: r.work_sets as number,
    repsMin: r.reps_min as number | null,
    repsMax: r.reps_max as number | null,
    startWeightG: r.start_weight_g as number | null,
  }]));
}

export function loadSchemes(db: LightDb): Scheme[] {
  const schemes = db.all("SELECT id, name FROM schemes ORDER BY position, id")
    .map((r) => ({ id: r.id as string, name: r.name as string, exercises: [] as string[] }));
  const byId = new Map(schemes.map((s) => [s.id, s]));
  for (const r of db.all("SELECT scheme_id, exercise_id FROM scheme_exercises ORDER BY position, id")) {
    byId.get(r.scheme_id as string)?.exercises.push(r.exercise_id as string);
  }
  return schemes;
}

export function activeWorkout(db: LightDb): Workout | null {
  const row = db.all("SELECT * FROM workouts WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1")[0];
  return row ? toWorkout(row) : null;
}

export function getWorkout(db: LightDb, id: string): Workout | null {
  const row = db.all("SELECT * FROM workouts WHERE id = ?", [id])[0];
  return row ? toWorkout(row) : null;
}

function toWorkout(row: Record<string, unknown>): Workout {
  return {
    id: row.id as string,
    schemes: (row.schemes as string).split(",").filter(Boolean),
    startedAt: row.started_at as string,
    finishedAt: row.finished_at as string | null,
  };
}

export function buildSteps(exercises: Map<string, Exercise>, schemes: Scheme[], selected: string[]): Step[] {
  const ordered = schemes.filter((s) => selected.includes(s.id)).flatMap((s) =>
    s.exercises.map((id) => ({ scheme: s, exercise: exercises.get(id) })).filter((e) => e.exercise));
  const steps: Step[] = [];
  ordered.forEach(({ scheme, exercise }, exerciseIndex) => {
    const ex = exercise!;
    const setCount = ex.warmupSets + ex.workSets;
    for (let setNo = 1; setNo <= setCount; setNo++) {
      steps.push({
        exercise: ex,
        scheme,
        setNo,
        setCount,
        kind: setNo <= ex.warmupSets ? "warmup" : "work",
        exerciseIndex,
        exerciseCount: ordered.length,
      });
    }
  });
  return steps;
}

export function doneKeys(db: LightDb, workoutId: string): Set<string> {
  return new Set(db.all("SELECT exercise_id, set_no FROM sets WHERE workout_id = ?", [workoutId])
    .map((r) => `${r.exercise_id}:${r.set_no}`));
}

export function stepKey(step: Step): string {
  return `${step.exercise.id}:${step.setNo}`;
}

export function defaultWeightG(db: LightDb, step: Step): number {
  const last = (kind: SetKind) =>
    db.all("SELECT weight_g FROM sets WHERE exercise_id = ? AND kind = ? ORDER BY done_at DESC LIMIT 1", [step.exercise.id, kind])[0]
      ?.weight_g as number | undefined;
  const work = last("work") ?? step.exercise.startWeightG ?? 0;
  if (step.kind === "work") return work;
  return last("warmup") ?? Math.round(work / 2 / 1000) * 1000;
}

export function lastWorkWeightG(db: LightDb, exercise: Exercise): number | null {
  const last = db.all("SELECT weight_g FROM sets WHERE exercise_id = ? AND kind = 'work' ORDER BY done_at DESC LIMIT 1", [exercise.id])[0];
  return (last?.weight_g as number | undefined) ?? exercise.startWeightG;
}

export function workSetCount(db: LightDb, workoutId: string): number {
  return db.all("SELECT count(*) AS n FROM sets WHERE workout_id = ? AND kind = 'work'", [workoutId])[0].n as number;
}
