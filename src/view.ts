import { App, MarkdownRenderChild } from "obsidian";
import { formatKg } from "./format";
import { LightDb } from "./lightdb";
import { EXERCISE_NOTES_DIR } from "./program";
import { openGymDb } from "./schema";
import {
  activeWorkout, buildSteps, defaultWeightG, doneKeys, Exercise, getWorkout,
  loadExercises, loadSchemes, Scheme, Step, stepKey, workSetCount,
} from "./workout";

const STEP_G = 1000;
const DRAG_RANGE_G = 20000;
const DRAG_STEP_G = 500;
const DRAG_PX_PER_STEP = 8;
const SCALE_LABEL_EVERY_G = 2500;
const LONG_PRESS_MS = 350;

type Mode = { kind: "idle" } | { kind: "choose"; chosen: Set<string> } | { kind: "finished"; workoutId: string };

export class GymBlock extends MarkdownRenderChild {
  private db: LightDb | null = null;
  private exercises = new Map<string, Exercise>();
  private schemes: Scheme[] = [];
  private mode: Mode = { kind: "idle" };
  private weight: { key: string; grams: number } | null = null;
  private scale: HTMLElement | null = null;
  private dragging = false;
  private renderPending = false;
  private busy = false;

  constructor(containerEl: HTMLElement, private app: App) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    this.containerEl.addClass("gym");
    this.register(() => this.closeScale());
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
      void this.run((db) => db.put("workouts", workoutId, { finished_at: new Date().toISOString() }));
      return;
    }
    const step = steps[index];
    const key = stepKey(step);
    if (this.weight?.key !== key) this.weight = { key, grams: defaultWeightG(db, step) };
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
    const minus = row.createEl("button", { cls: "gym-round", text: "−" });
    const value = row.createDiv({ cls: "gym-weight" });
    const plus = row.createEl("button", { cls: "gym-round", text: "+" });
    const showWeight = () => {
      value.empty();
      value.createSpan({ cls: "gym-weight-number", text: formatKg(weight.grams) });
      value.createSpan({ cls: "gym-weight-unit", text: step.exercise.perSide ? "kg per side" : "kg" });
    };
    showWeight();
    this.bindHold(minus, weight, -STEP_G, showWeight);
    this.bindHold(plus, weight, STEP_G, showWeight);

    const doneButton = root.createEl("button", { cls: "gym-primary gym-big", text: "Done" });
    doneButton.onclick = () => this.run(async (db) => {
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

  private bindHold(button: HTMLButtonElement, weight: { grams: number }, delta: number, show: () => void): void {
    let pointerId: number | null = null;
    let timer: number | null = null;
    let drag: { startY: number; startG: number; update: (grams: number) => void } | null = null;

    const finish = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      drag = null;
      pointerId = null;
      this.closeScale();
      this.dragging = false;
      if (this.renderPending) {
        this.renderPending = false;
        this.render();
      }
    };

    button.addClass("gym-hold");
    button.onpointerdown = (event) => {
      if (pointerId !== null) return;
      event.preventDefault();
      pointerId = event.pointerId;
      button.setPointerCapture(event.pointerId);
      this.dragging = true;
      const { clientX, clientY } = event;
      timer = window.setTimeout(() => {
        timer = null;
        const startG = weight.grams;
        drag = { startY: clientY, startG, update: this.openScale(clientX, clientY, startG) };
        vibrate();
      }, LONG_PRESS_MS);
    };
    button.onpointermove = (event) => {
      if (event.pointerId !== pointerId || !drag) return;
      event.preventDefault();
      const steps = Math.round((drag.startY - event.clientY) / DRAG_PX_PER_STEP);
      const minG = Math.max(0, drag.startG - DRAG_RANGE_G);
      const grams = Math.min(drag.startG + DRAG_RANGE_G, Math.max(minG, drag.startG + steps * DRAG_STEP_G));
      if (grams === weight.grams) return;
      weight.grams = grams;
      drag.update(grams);
      show();
      vibrate();
    };
    button.onpointerup = (event) => {
      if (event.pointerId !== pointerId) return;
      const tap = timer !== null;
      if (tap) {
        weight.grams = Math.max(0, weight.grams + delta);
        show();
      }
      finish();
    };
    button.onpointercancel = (event) => {
      if (event.pointerId === pointerId) finish();
    };
    button.oncontextmenu = (event) => event.preventDefault();
  }

  private openScale(x: number, y: number, startG: number): (grams: number) => void {
    this.closeScale();
    const minG = Math.max(0, startG - DRAG_RANGE_G);
    const maxG = startG + DRAG_RANGE_G;
    const top = (grams: number) => y - ((grams - startG) / DRAG_STEP_G) * DRAG_PX_PER_STEP;
    const scale = document.body.createDiv({ cls: "gym-scale" });
    if (x < 140) scale.addClass("gym-scale-right");
    scale.style.left = `${x}px`;
    const track = scale.createDiv({ cls: "gym-scale-track" });
    track.style.top = `${top(maxG)}px`;
    track.style.height = `${top(minG) - top(maxG)}px`;
    for (let grams = Math.ceil(minG / SCALE_LABEL_EVERY_G) * SCALE_LABEL_EVERY_G; grams <= maxG; grams += SCALE_LABEL_EVERY_G) {
      const tick = scale.createDiv({ cls: "gym-scale-tick", text: formatKg(grams) });
      tick.style.top = `${top(grams)}px`;
    }
    const bubble = scale.createDiv({ cls: "gym-scale-bubble" });
    this.scale = scale;
    const update = (grams: number) => {
      bubble.style.top = `${top(grams)}px`;
      bubble.setText(formatKg(grams));
    };
    update(startG);
    return update;
  }

  private closeScale(): void {
    this.scale?.remove();
    this.scale = null;
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

function vibrate(): void {
  if (typeof navigator.vibrate === "function") navigator.vibrate(8);
}

function setLabel(step: Step): string {
  if (step.kind === "warmup") return `Set ${step.setNo} of ${step.setCount} · warm-up`;
  const { repsMin, repsMax } = step.exercise;
  const reps = repsMin === null ? "" : repsMin === repsMax || repsMax === null ? ` · ${repsMin} reps` : ` · ${repsMin}–${repsMax} reps`;
  return `Set ${step.setNo} of ${step.setCount}${reps}`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
