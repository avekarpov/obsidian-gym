import { Exercise } from "./workout";

export function formatKg(grams: number): string {
  return (grams / 1000).toFixed(1);
}

export function formatSets(exercise: Exercise): string {
  const { warmupSets, workSets, repsMin, repsMax } = exercise;
  const reps = repsMin === null ? "" : repsMax === null || repsMax === repsMin ? ` × ${repsMin}` : ` × ${repsMin}–${repsMax}`;
  const warmup = warmupSets > 0 ? `${warmupSets} warm-up + ` : "";
  return `${warmup}${workSets}${reps}`;
}
