import { App, MarkdownRenderChild } from "obsidian";
import { formatKg } from "./format";
import { LightDb } from "./lightdb";
import { EXERCISE_NOTES_DIR } from "./program";
import { bindWeightDrag, closeScale } from "./scale";
import { openGymDb } from "./schema";
import {
  activeWorkout, buildSteps, defaultWeightG, doneKeys, Exercise, getWorkout,
  loadExercises, loadSchemes, planWeightUpdates, Scheme, Step, stepKey, workSetCount,
} from "./workout";

type Mode = { kind: "idle" } | { kind: "choose"; chosen: Set<string> } | { kind: "finished"; workoutId: string };

export class GymBlock extends MarkdownRenderChild {
  private db: LightDb | null = null;
  private exercises = new Map<string, Exercise>();
  private schemes: Scheme[] = [];
  private mode: Mode = { kind: "idle" };
  private weight: { key: string; grams: number } | null = null;
  private dragging = false;
  private renderPending = false;
  private busy = false;

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
    if (active) return this.renderStep(root, db, active.id, active.schemes, active.startedAt);
    if (this.mode.kind === "finished") return this.renderFinished(root, db, this.mode.workoutId);
    if (this.mode.kind === "choose") return this.renderChoose(root, this.mode.chosen);
    this.renderIdle(root);
  }

  private renderIdle(root: HTMLElement): void {
    const start = root.createEl("button", { cls: "gym-primary gym-big", text: "Start workout" });
    start.onclick = () => {
      this.mode = { kind: "choose", chosen: new Set() };
      this.render();
    };
  }

  private renderChoose(root: HTMLElement, chosen: Set<string>): void {
    root.createDiv({ cls: "gym-title", text: "What are we training?" });
    const list = root.createDiv({ cls: "gym-schemes" });
    for (const scheme of this.schemes) {
      const label = list.createEl("label", { cls: "gym-scheme" });
      const box = label.createEl("input", { type: "checkbox" });
      box.checked = chosen.has(scheme.id);
      box.onchange = () => {
        if (box.checked) chosen.add(scheme.id);
        else chosen.delete(scheme.id);
        start.disabled = chosen.size === 0;
      };
      label.createSpan({ text: scheme.name });
    }
    const actions = root.createDiv({ cls: "gym-actions" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.onclick = () => {
      this.mode = { kind: "idle" };
      this.render();
    };
    const start = actions.createEl("button", { cls: "gym-primary", text: "Start" });
    start.disabled = chosen.size === 0;
    start.onclick = () => this.run(async (db) => {
      const schemes = this.schemes.map((s) => s.id).filter((id) => chosen.has(id));
      this.mode = { kind: "idle" };
      await db.put("workouts", crypto.randomUUID(), {
        schemes: schemes.join(","),
        started_at: new Date().toISOString(),
        finished_at: null,
      });
    });
  }

  private renderStep(root: HTMLElement, db: LightDb, workoutId: string, selected: string[], startedAt: string): void {
    const steps = buildSteps(this.exercises, this.schemes, selected);
    const done = doneKeys(db, workoutId);
    const index = steps.findIndex((s) => !done.has(stepKey(s)));
    if (index < 0) {
      void this.run((db) => db.transaction([
        { op: "put", table: "workouts", row: workoutId, fields: { finished_at: new Date().toISOString() } },
        ...planWeightUpdates(db, workoutId, []),
      ]));
      return;
    }
    const step = steps[index];
    const key = stepKey(step);
    if (this.weight?.key !== key) this.weight = { key, grams: defaultWeightG(db, workoutId, step.exercise) };
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
      value.createSpan({ cls: "gym-weight-unit", text: step.exercise.perSide ? "kg per side" : "kg" });
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
            kind: "work", weight_g: weight.grams, done_at: now, skipped: skipped ? 1 : 0,
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

    const next = steps[index + 1];
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
  const reps = step.exercise.reps === null ? "" : ` · ${step.exercise.reps} reps`;
  return `Set ${step.setNo} of ${step.exercise.sets}${reps}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
