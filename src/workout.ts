import { Group, PlanItem, SetRecord, Workout } from "./model";

export interface Step {
  item: PlanItem;
  setNo: number;
  exerciseIndex: number;
  exerciseCount: number;
}

export interface Start {
  grams: number;
  reps: number;
}

export interface PreviousSets {
  start: string;
  records: SetRecord[];
}

export function buildSteps(group: Group | undefined): Step[] {
  if (!group) return [];
  return group.items.flatMap((item, exerciseIndex) =>
    Array.from({ length: item.sets }, (_, i) => ({ item, setNo: i + 1, exerciseIndex, exerciseCount: group.items.length })));
}

export function setsTaken(workout: Workout, exercise: string): number {
  return workout.records
    .filter((record) => record.exercise === exercise)
    .reduce((sum, record) => sum + (record.skipped || 1), 0);
}

export function pickStep(steps: Step[], workout: Workout, prefer: string | null = workout.current): Step | null {
  const open = steps.filter((step) => step.setNo > setsTaken(workout, step.item.name));
  return open.find((step) => step.item.name === prefer) ?? open[0] ?? null;
}

export function doneRecords(workout: Workout, exercise: string): SetRecord[] {
  return workout.records.filter((record) => record.exercise === exercise && !record.skipped);
}

export function previousSets(diary: Workout[], exercise: string, exclude: Workout | null): PreviousSets | null {
  const workout = diary.find((w) => w !== exclude && doneRecords(w, exercise).length > 0);
  if (!workout) return null;
  return { start: workout.start, records: workout.records.filter((record) => record.exercise === exercise) };
}

export function previousBestKg(diary: Workout[], exercise: string, exclude: Workout | null): number | null {
  const previous = previousSets(diary, exercise, exclude);
  if (!previous) return null;
  return Math.max(...previous.records.filter((record) => !record.skipped).map((record) => record.weightKg ?? 0));
}

export function startValues(diary: Workout[], workout: Workout, item: PlanItem): Start {
  const current = doneRecords(workout, item.name).at(-1);
  if (current) return { grams: Math.round((current.weightKg ?? 0) * 1000), reps: current.reps ?? item.reps };
  return { grams: Math.round((previousBestKg(diary, item.name, workout) ?? 0) * 1000), reps: item.reps };
}

export function doneSetCount(workout: Workout): number {
  return workout.records.filter((record) => !record.skipped).length;
}
