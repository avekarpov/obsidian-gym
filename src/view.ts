import { App, MarkdownRenderChild } from "obsidian";
import { LightDb, lightDbApi } from "./lightdb";
import { EXERCISE_NOTES_DIR, SCHEMES, SchemeId } from "./program";
import { DB_NAME, MIGRATIONS } from "./schema";
import {
  activeWorkout, buildSteps, defaultWeightG, doneKeys, Exercise, getWorkout,
  loadExercises, Step, stepKey, workSetCount,
} from "./workout";

const STEP_G = 1000;
const SLIDER_RANGE_G = 20000;
const SLIDER_STEP_G = 500;
const LONG_PRESS_MS = 450;

type Mode = { kind: "idle" } | { kind: "choose"; chosen: Set<SchemeId> } | { kind: "finished"; workoutId: string };

export class GymBlock extends MarkdownRenderChild {
  private db: LightDb | null = null;
  private exercises = new Map<string, Exercise>();
  private mode: Mode = { kind: "idle" };
  private weight: { key: string; grams: number } | null = null;
  private slider: { key: string; centerG: number } | null = null;
  private busy = false;

  constructor(containerEl: HTMLElement, private app: App) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    this.containerEl.addClass("gym");
    const api = lightDbApi(this.app);
    if (!api) {
      this.message("LightDB plugin is required. Enable it in Community plugins.");
      return;
    }
    try {
      const db = await api.open(DB_NAME);
      for (const migration of MIGRATIONS) await db.migrate(migration.id, migration.sql);
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
    this.exercises = loadExercises(db);
    const root = this.containerEl;
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

  private renderChoose(root: HTMLElement, chosen: Set<SchemeId>): void {
    root.createDiv({ cls: "gym-title", text: "What are we training?" });
    const list = root.createDiv({ cls: "gym-schemes" });
    for (const scheme of SCHEMES) {
      const label = list.createEl("label", { cls: "gym-scheme" });
      const box = label.createEl("input", { type: "checkbox" });
      box.checked = chosen.has(scheme.id);
      box.onchange = () => {
        if (box.checked) chosen.add(scheme.id);
        else chosen.delete(scheme.id);
        start.disabled = chosen.size === 0;
      };
      label.createSpan({ text: scheme.label });
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
      const schemes = SCHEMES.map((s) => s.id).filter((id) => chosen.has(id));
      this.mode = { kind: "idle" };
      await db.put("workouts", crypto.randomUUID(), {
        schemes: schemes.join(","),
        started_at: new Date().toISOString(),
        finished_at: null,
      });
    });
  }

  private renderStep(root: HTMLElement, db: LightDb, workoutId: string, schemes: SchemeId[], startedAt: string): void {
    const steps = buildSteps(this.exercises, schemes);
    const done = doneKeys(db, workoutId);
    const index = steps.findIndex((s) => !done.has(stepKey(s)));
    if (index < 0) {
      void this.run((db) => db.put("workouts", workoutId, { finished_at: new Date().toISOString() }));
      return;
    }
    const step = steps[index];
    const key = stepKey(step);
    if (this.weight?.key !== key) this.weight = { key, grams: defaultWeightG(db, step) };
    const weight = this.weight;

    const header = root.createDiv({ cls: "gym-header" });
    const scheme = SCHEMES.find((s) => s.id === step.scheme)?.label ?? step.scheme;
    header.createSpan({ text: `${scheme} · exercise ${step.exerciseIndex + 1} of ${step.exerciseCount}` });
    header.createSpan({ text: `started ${formatTime(startedAt)}` });

    const name = root.createDiv({ cls: "gym-exercise", text: step.exercise.name });
    if (step.exercise.note) {
      name.addClass("gym-link");
      name.onclick = () => void this.app.workspace.openLinkText(`${EXERCISE_NOTES_DIR}/${step.exercise.note}`, "", false);
    }
    root.createDiv({ cls: "gym-set", text: setLabel(step) });

    const row = root.createDiv({ cls: "gym-weight-row" });
    const minus = row.createEl("button", { cls: "gym-round", text: "−" });
    const value = row.createDiv({ cls: "gym-weight" });
    const plus = row.createEl("button", { cls: "gym-round", text: "+" });
    const showWeight = () => {
      value.empty();
      value.createSpan({ cls: "gym-weight-number", text: formatKg(weight.grams) });
      value.createSpan({ cls: "gym-weight-unit", text: step.exercise.perSide ? "kg per side" : "kg" });
    };
    showWeight();
    this.bindHold(minus, key, weight, -STEP_G, showWeight);
    this.bindHold(plus, key, weight, STEP_G, showWeight);

    if (this.slider?.key === key) {
      const { centerG } = this.slider;
      const slider = root.createEl("input", { cls: "gym-slider", type: "range" });
      slider.min = String(Math.max(0, centerG - SLIDER_RANGE_G));
      slider.max = String(centerG + SLIDER_RANGE_G);
      slider.step = String(SLIDER_STEP_G);
      slider.value = String(weight.grams);
      slider.oninput = () => {
        weight.grams = Number(slider.value);
        showWeight();
      };
      const scale = root.createDiv({ cls: "gym-slider-scale" });
      scale.createSpan({ text: formatKg(Number(slider.min)) });
      scale.createSpan({ text: formatKg(Number(slider.max)) });
      value.onclick = () => {
        this.slider = null;
        this.render();
      };
    }

    const doneButton = root.createEl("button", { cls: "gym-primary gym-big", text: "Done" });
    doneButton.onclick = () => this.run(async (db) => {
      this.slider = null;
      const last = index === steps.length - 1;
      const now = new Date().toISOString();
      await db.transaction([
        {
          op: "put", table: "sets", row: crypto.randomUUID(), fields: {
            workout_id: workoutId, exercise_id: step.exercise.id, set_no: step.setNo,
            kind: step.kind, weight_g: weight.grams, done_at: now,
          },
        },
        ...(last ? [{ op: "put" as const, table: "workouts", row: workoutId, fields: { finished_at: now } }] : []),
      ]);
      if (last) this.mode = { kind: "finished", workoutId };
    });

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
        await db.put("workouts", workoutId, { finished_at: new Date().toISOString() });
      });
    };
  }

  private renderFinished(root: HTMLElement, db: LightDb, workoutId: string): void {
    const workout = getWorkout(db, workoutId);
    root.createDiv({ cls: "gym-title", text: "Workout complete" });
    if (workout?.finishedAt) {
      const minutes = Math.round((Date.parse(workout.finishedAt) - Date.parse(workout.startedAt)) / 60000);
      root.createDiv({ cls: "gym-set", text: `${workSetCount(db, workoutId)} work sets · ${minutes} min` });
    }
    const ok = root.createEl("button", { cls: "gym-primary gym-big", text: "OK" });
    ok.onclick = () => {
      this.mode = { kind: "idle" };
      this.render();
    };
  }

  private bindHold(button: HTMLButtonElement, key: string, weight: { grams: number }, delta: number, show: () => void): void {
    let timer: number | null = null;
    let long = false;
    const clear = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    button.onpointerdown = () => {
      long = false;
      clear();
      timer = window.setTimeout(() => {
        long = true;
        timer = null;
        this.slider = { key, centerG: weight.grams };
        this.render();
      }, LONG_PRESS_MS);
    };
    button.onpointerup = () => {
      const wasPending = timer !== null;
      clear();
      if (wasPending && !long) {
        weight.grams = Math.max(0, weight.grams + delta);
        show();
      }
    };
    button.onpointerleave = clear;
    button.onpointercancel = clear;
    button.oncontextmenu = (event) => event.preventDefault();
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
  if (step.kind === "warmup") return `Set ${step.setNo} of ${step.setCount} · warm-up`;
  const { repsMin, repsMax } = step.exercise;
  const reps = repsMin === null ? "" : repsMin === repsMax || repsMax === null ? ` · ${repsMin} reps` : ` · ${repsMin}–${repsMax} reps`;
  return `Set ${step.setNo} of ${step.setCount}${reps}`;
}

function formatKg(grams: number): string {
  return (grams / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
