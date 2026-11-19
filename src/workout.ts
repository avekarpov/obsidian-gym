import { LightDb } from "./lightdb";

export interface Exercise {
  id: string;
  name: string;
  note: string | null;
  sets: number;
  reps: number | null;
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

export function loadExercises(db: LightDb): Map<string, Exercise> {
  const rows = db.all(`SELECT e.id, e.name, e.note, p.sets, p.reps
    FROM exercises e JOIN plan p ON p.id = e.id`);
  return new Map(rows.map((r) => [r.id as string, {
    id: r.id as string,
    name: r.name as string,
    note: r.note as string | null,
    sets: r.sets as number,
    reps: r.reps as number | null,
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
  reps: number | null;
}

export function lastAction(db: LightDb, workoutId: string): LastAction | null {
  const rows = db.all(
    `SELECT id, exercise_id, set_no, weight_g, reps FROM sets
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
    reps: rows[0].reps as number | null,
  };
}

export function pickStep(steps: Step[], done: Set<string>, preferExercise: string | null): Step | null {
  const open = steps.filter((s) => !done.has(stepKey(s)));
  return open.find((s) => s.exercise.id === preferExercise) ?? open[0] ?? null;
}

export interface Start {
  grams: number;
  reps: number;
}

export function previousBest(db: LightDb, exerciseId: string, excludeWorkout: string): { grams: number; reps: number | null } | null {
  const row = db.all(
    `SELECT s.weight_g, s.reps FROM sets s
     WHERE s.exercise_id = ? AND s.skipped = 0 AND s.workout_id = (
       SELECT s2.workout_id FROM sets s2 JOIN workouts w ON w.id = s2.workout_id
       WHERE s2.exercise_id = ? AND s2.skipped = 0 AND s2.workout_id != ?
       ORDER BY w.started_at DESC LIMIT 1)
     ORDER BY s.weight_g DESC, s.reps DESC LIMIT 1`,
    [exerciseId, exerciseId, excludeWorkout],
  )[0];
  return row ? { grams: row.weight_g as number, reps: row.reps as number | null } : null;
}

export interface PreviousSets {
  startedAt: string;
  sets: { grams: number; reps: number | null; skipped: boolean }[];
}

export function previousSets(db: LightDb, exerciseId: string, excludeWorkout: string): PreviousSets | null {
  const workout = db.all(
    `SELECT w.id, w.started_at FROM workouts w
     WHERE w.id != ? AND EXISTS (SELECT 1 FROM sets s WHERE s.workout_id = w.id AND s.exercise_id = ? AND s.skipped = 0)
     ORDER BY w.started_at DESC LIMIT 1`,
    [excludeWorkout, exerciseId],
  )[0];
  if (!workout) return null;
  const sets = db.all(
    "SELECT weight_g, reps, skipped FROM sets WHERE workout_id = ? AND exercise_id = ? ORDER BY done_at, set_no",
    [workout.id as string, exerciseId],
  ).map((r) => ({ grams: r.weight_g as number, reps: r.reps as number | null, skipped: r.skipped === 1 }));
  return { startedAt: workout.started_at as string, sets };
}

export function startValues(db: LightDb, workoutId: string, exercise: Exercise): Start {
  const target = exercise.reps ?? 10;
  const current = db.all(
    "SELECT weight_g, reps FROM sets WHERE workout_id = ? AND exercise_id = ? AND skipped = 0 ORDER BY done_at DESC LIMIT 1",
    [workoutId, exercise.id],
  )[0];
  if (current) return { grams: current.weight_g as number, reps: (current.reps as number | null) ?? target };
  return { grams: previousBest(db, exercise.id, workoutId)?.grams ?? 0, reps: target };
}

export function workSetCount(db: LightDb, workoutId: string): number {
  return db.all("SELECT count(*) AS n FROM sets WHERE workout_id = ? AND skipped = 0", [workoutId])[0].n as number;
}
