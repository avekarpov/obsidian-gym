import { LightDb, OpInput } from "./lightdb";

export interface Exercise {
  id: string;
  name: string;
  note: string | null;
  sets: number;
  reps: number | null;
  weightG: number | null;
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
  exerciseIndex: number;
  exerciseCount: number;
}

export interface Workout {
  id: string;
  schemes: string[];
  startedAt: string;
  finishedAt: string | null;
  currentExercise: string | null;
}

export interface RecordedSet {
  exerciseId: string;
  grams: number;
  skipped: boolean;
}

export function loadExercises(db: LightDb): Map<string, Exercise> {
  const rows = db.all(`SELECT e.id, e.name, e.note, p.sets, p.reps, p.weight_g
    FROM exercises e JOIN plan p ON p.id = e.id`);
  return new Map(rows.map((r) => [r.id as string, {
    id: r.id as string,
    name: r.name as string,
    note: r.note as string | null,
    sets: r.sets as number,
    reps: r.reps as number | null,
    weightG: r.weight_g as number | null,
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
    currentExercise: (row.current_exercise as string | null | undefined) ?? null,
  };
}

export function buildSteps(exercises: Map<string, Exercise>, schemes: Scheme[], selected: string[]): Step[] {
  const ordered = schemes.filter((s) => selected.includes(s.id)).flatMap((s) =>
    s.exercises.map((id) => ({ scheme: s, exercise: exercises.get(id) })).filter((e) => e.exercise));
  const steps: Step[] = [];
  ordered.forEach(({ scheme, exercise }, exerciseIndex) => {
    for (let setNo = 1; setNo <= exercise!.sets; setNo++) {
      steps.push({ exercise: exercise!, scheme, setNo, exerciseIndex, exerciseCount: ordered.length });
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

export interface LastAction {
  setIds: string[];
  exerciseId: string;
  setNo: number;
  grams: number;
}

export function lastAction(db: LightDb, workoutId: string): LastAction | null {
  const rows = db.all(
    `SELECT id, exercise_id, set_no, weight_g FROM sets
     WHERE workout_id = ? AND done_at = (SELECT max(done_at) FROM sets WHERE workout_id = ?)
     ORDER BY set_no`,
    [workoutId, workoutId],
  );
  if (!rows.length) return null;
  return {
    setIds: rows.map((r) => r.id as string),
    exerciseId: rows[0].exercise_id as string,
    setNo: rows[0].set_no as number,
    grams: rows[0].weight_g as number,
  };
}

export function pickStep(steps: Step[], done: Set<string>, preferExercise: string | null): Step | null {
  const open = steps.filter((s) => !done.has(stepKey(s)));
  return open.find((s) => s.exercise.id === preferExercise) ?? open[0] ?? null;
}

export function defaultWeightG(db: LightDb, workoutId: string, exercise: Exercise): number {
  const last = db.all(
    "SELECT weight_g FROM sets WHERE workout_id = ? AND exercise_id = ? AND skipped = 0 ORDER BY done_at DESC LIMIT 1",
    [workoutId, exercise.id],
  )[0];
  return (last?.weight_g as number | undefined) ?? exercise.weightG ?? 0;
}

export function planWeightUpdates(db: LightDb, workoutId: string, pending: RecordedSet[]): OpInput[] {
  const last = new Map<string, number>();
  for (const r of db.all("SELECT exercise_id, weight_g FROM sets WHERE workout_id = ? AND skipped = 0 ORDER BY done_at", [workoutId])) {
    last.set(r.exercise_id as string, r.weight_g as number);
  }
  for (const set of pending) if (!set.skipped) last.set(set.exerciseId, set.grams);
  return [...last].map(([exerciseId, grams]) => ({ op: "put", table: "plan", row: exerciseId, fields: { weight_g: grams } }));
}

export function workSetCount(db: LightDb, workoutId: string): number {
  return db.all("SELECT count(*) AS n FROM sets WHERE workout_id = ? AND skipped = 0", [workoutId])[0].n as number;
}
