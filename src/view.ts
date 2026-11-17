import { App, MarkdownRenderChild } from "obsidian";
import { formatKg } from "./format";
import { LightDb } from "./lightdb";
import { EXERCISE_NOTES_DIR } from "./program";
import { bindWeightDrag, closeScale } from "./scale";
import { openGymDb } from "./schema";
import {
  activeWorkout, buildSteps, defaultReps, defaultWeightG, doneKeys, Exercise, getWorkout,
  lastAction, loadExercises, loadSchemes, pickStep, planWeightUpdates, Scheme, Step, stepKey, Workout, workSetCount,
} from "./workout";

type Mode = { kind: "idle" } | { kind: "choose" } | { kind: "finished"; workoutId: string };

export class GymBlock extends MarkdownRenderChild {
  private db: LightDb | null = null;
  private exercises = new Map<string, Exercise>();
  private schemes: Scheme[] = [];
  private mode: Mode = { kind: "idle" };
  private weight: { key: string; grams: number; reps: number } | null = null;
  private dragging = false;
  private renderPending = false;
  private busy = false;
  private switching = false;

  constructor(containerEl: HTMLElement, private app: App) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    this.containerEl.addClass("gym");
    this.register(closeScale);
    try {
      const db = await openGymDb(this.app);
      this.db = db;
      this.register(db.onChange(() => this.render()));
      this.render();
    } catch (error) {
      this.message(error instanceof Error ? error.message : String(error));
    }
  }

  private message(text: string): void {
    this.containerEl.empty();
    this.containerEl.createDiv({ cls: "gym-error", text });
  }

  private render(): void {
    const db = this.db;
    if (!db) return;
    if (this.dragging) {
      this.renderPending = true;
      return;
    }
    const root = this.containerEl;
    try {
      this.exercises = loadExercises(db);
      this.schemes = loadSchemes(db);
    } catch (error) {
      this.message(error instanceof Error ? error.message : String(error));
      return;
    }
    root.empty();
    const active = activeWorkout(db);
    if (active) return this.renderStep(root, db, active);
    this.switching = false;
    if (this.mode.kind === "finished") return this.renderFinished(root, db, this.mode.workoutId);
    if (this.mode.kind === "choose") return this.renderChoose(root);
    this.renderIdle(root);
  }

  private renderIdle(root: HTMLElement): void {
    const start = root.createEl("button", { cls: "gym-primary gym-big", text: "Start workout" });
    start.onclick = () => {
      this.mode = { kind: "choose" };
      this.render();
    };
  }

  private renderChoose(root: HTMLElement): void {
    root.createDiv({ cls: "gym-title", text: "What are we training?" });
    const list = root.createDiv({ cls: "gym-schemes" });
    for (const scheme of this.schemes) {
      list.createEl("button", { cls: "gym-primary gym-big", text: scheme.name }).onclick = () => this.run(async (db) => {
        this.mode = { kind: "idle" };
        await db.put("workouts", crypto.randomUUID(), {
          schemes: scheme.id,
          started_at: new Date().toISOString(),
          finished_at: null,
        });
      });
    }
    root.createEl("button", { text: "Cancel" }).onclick = () => {
      this.mode = { kind: "idle" };
      this.render();
    };
  }

  private renderStep(root: HTMLElement, db: LightDb, workout: Workout): void {
    const { id: workoutId, startedAt } = workout;
    const steps = buildSteps(this.exercises, this.schemes, workout.schemes);
    const done = doneKeys(db, workoutId);
    const step = pickStep(steps, done, workout.currentExercise);
    if (!step) {
      void this.run((db) => db.transaction([
        { op: "put", table: "workouts", row: workoutId, fields: { finished_at: new Date().toISOString() } },
        ...planWeightUpdates(db, workoutId, []),
      ]));
      return;
    }
    if (this.switching) return this.renderSwitch(root, steps, done, step, workoutId);
    const key = stepKey(step);
    if (this.weight?.key !== key) {
      this.weight = { key, grams: defaultWeightG(db, workoutId, step.exercise), reps: defaultReps(db, workoutId, step.exercise) };
    }
    const weight = this.weight;

    const header = root.createDiv({ cls: "gym-header" });
    header.createSpan({ text: `${step.scheme.name} · exercise ${step.exerciseIndex + 1} of ${step.exerciseCount}` });
    header.createSpan({ text: `started ${formatTime(startedAt)}` });

    const name = root.createDiv({ cls: "gym-exercise", text: step.exercise.name });
    if (step.exercise.note) {
      name.addClass("gym-link");
      name.onclick = () => void this.app.workspace.openLinkText(`${EXERCISE_NOTES_DIR}/${step.exercise.note}`, "", false);
    }
    root.createDiv({ cls: "gym-set", text: setLabel(step) });

    const row = root.createDiv({ cls: "gym-weight-row" });
    const value = row.createDiv({ cls: "gym-weight" });
    const showWeight = () => {
      value.empty();
      value.createSpan({ cls: "gym-weight-number", text: formatKg(weight.grams) });
      value.createSpan({ cls: "gym-weight-unit", text: "kg" });
    };
    showWeight();
    bindWeightDrag(value, weight, showWeight, {
      onStart: () => (this.dragging = true),
      onEnd: () => {
        this.dragging = false;
        if (this.renderPending) {
          this.renderPending = false;
          this.render();
        }
      },
    });

    const repsRow = root.createDiv({ cls: "gym-reps-row" });
    const minus = repsRow.createEl("button", { cls: "gym-reps-button", text: "−" });
    const repsValue = repsRow.createDiv({ cls: "gym-reps" });
    const plus = repsRow.createEl("button", { cls: "gym-reps-button", text: "+" });
    const showReps = () => {
      repsValue.empty();
      repsValue.createSpan({ cls: "gym-reps-number", text: String(weight.reps) });
      repsValue.createSpan({ cls: "gym-weight-unit", text: "reps" });
      minus.disabled = weight.reps <= 1;
    };
    showReps();
    minus.onclick = () => {
      weight.reps = Math.max(1, weight.reps - 1);
      showReps();
    };
    plus.onclick = () => {
      weight.reps += 1;
      showReps();
    };

    const doneButton = root.createEl("button", { cls: "gym-primary gym-big", text: "Done" });
    const record = (toRecord: Step[], skipped: boolean) => this.run(async (db) => {
      const recorded = new Set(toRecord.map(stepKey));
      const finished = steps.every((s) => done.has(stepKey(s)) || recorded.has(stepKey(s)));
      const now = new Date().toISOString();
      const pending = toRecord.map((s) => ({ exerciseId: s.exercise.id, grams: weight.grams, skipped }));
      await db.transaction([
        ...toRecord.map((s) => ({
          op: "put" as const, table: "sets", row: crypto.randomUUID(), fields: {
            workout_id: workoutId, exercise_id: s.exercise.id, set_no: s.setNo,
            kind: "work", weight_g: weight.grams, reps: skipped ? null : weight.reps, done_at: now, skipped: skipped ? 1 : 0,
          },
        })),
        ...(finished ? [
          { op: "put" as const, table: "workouts", row: workoutId, fields: { finished_at: now } },
          ...planWeightUpdates(db, workoutId, pending),
        ] : []),
      ]);
      if (finished) this.mode = { kind: "finished", workoutId };
    });
    doneButton.onclick = () => record([step], false);

    const skips = root.createDiv({ cls: "gym-skips" });
    skips.createEl("button", { text: "Skip set" }).onclick = () => record([step], true);
    skips.createEl("button", { text: "Skip exercise" }).onclick = () => record(
      steps.filter((s) => s.exercise.id === step.exercise.id && !done.has(stepKey(s))),
      true,
    );

    const extra = root.createDiv({ cls: "gym-skips" });
    const undo = extra.createEl("button", { text: "Undo last set" });
    const last = lastAction(db, workoutId);
    undo.disabled = !last;
    undo.onclick = () => {
      if (!last) return;
      void this.run(async (db) => {
        await db.transaction([
          ...last.setIds.map((id) => ({ op: "delete" as const, table: "sets", row: id })),
          { op: "put" as const, table: "workouts", row: workoutId, fields: { current_exercise: last.exerciseId } },
        ]);
        this.weight = {
          key: `${last.exerciseId}:${last.setNo}`,
          grams: last.grams,
          reps: last.reps ?? defaultReps(db, workoutId, this.exercises.get(last.exerciseId)!),
        };
      });
    };
    extra.createEl("button", { text: "Change exercise" }).onclick = () => {
      this.switching = true;
      this.render();
    };

    const next = pickStep(steps, new Set([...done, key]), step.exercise.id);
    if (next) {
      root.createDiv({
        cls: "gym-next",
        text: next.exercise.id === step.exercise.id ? `Next: set ${next.setNo}` : `Next: ${next.exercise.name}`,
      });
    }

    const end = root.createEl("button", { cls: "gym-end", text: "End workout" });
    end.onclick = () => {
      if (!window.confirm("End the workout now?")) return;
      void this.run(async (db) => {
        this.mode = { kind: "finished", workoutId };
        await db.transaction([
          { op: "put", table: "workouts", row: workoutId, fields: { finished_at: new Date().toISOString() } },
          ...planWeightUpdates(db, workoutId, []),
        ]);
      });
    };
  }

  private renderSwitch(root: HTMLElement, steps: Step[], done: Set<string>, current: Step, workoutId: string): void {
    root.createDiv({ cls: "gym-title", text: "Change exercise" });
    const list = root.createDiv({ cls: "gym-switch-list" });
    const seen = new Set<string>();
    for (const step of steps) {
      if (seen.has(step.exercise.id)) continue;
      seen.add(step.exercise.id);
      const own = steps.filter((s) => s.exercise.id === step.exercise.id);
      const finished = own.filter((s) => done.has(stepKey(s))).length;
      const item = list.createEl("button", { cls: "gym-switch-item" });
      if (step.exercise.id === current.exercise.id) item.addClass("is-current");
      item.createSpan({ text: step.exercise.name });
      item.createSpan({ cls: "gym-switch-progress", text: finished === own.length ? "done" : `${finished}/${own.length}` });
      item.disabled = finished === own.length;
      item.onclick = () => {
        this.switching = false;
        if (step.exercise.id === current.exercise.id) {
          this.render();
          return;
        }
        void this.run((db) => db.put("workouts", workoutId, { current_exercise: step.exercise.id }));
      };
    }
    root.createEl("button", { text: "Back" }).onclick = () => {
      this.switching = false;
      this.render();
    };
  }

  private renderFinished(root: HTMLElement, db: LightDb, workoutId: string): void {
    const workout = getWorkout(db, workoutId);
    root.createDiv({ cls: "gym-title", text: "Workout complete" });
    if (workout?.finishedAt) {
      const minutes = Math.round((Date.parse(workout.finishedAt) - Date.parse(workout.startedAt)) / 60000);
      root.createDiv({ cls: "gym-set", text: `${workSetCount(db, workoutId)} sets · ${minutes} min` });
    }
    const ok = root.createEl("button", { cls: "gym-primary gym-big", text: "OK" });
    ok.onclick = () => {
      this.mode = { kind: "idle" };
      this.render();
    };
  }

  private async run(action: (db: LightDb) => Promise<unknown>): Promise<void> {
    if (!this.db || this.busy) return;
    this.busy = true;
    try {
      await action(this.db);
    } catch (error) {
      this.message(error instanceof Error ? error.message : String(error));
      return;
    } finally {
      this.busy = false;
    }
    this.render();
  }
}

function setLabel(step: Step): string {
  const reps = step.exercise.reps === null ? "" : ` · target ${step.exercise.reps} reps`;
  return `Set ${step.setNo} of ${step.exercise.sets}${reps}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
