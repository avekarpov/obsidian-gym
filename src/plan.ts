import { App, MarkdownRenderChild, Notice, TFile } from "obsidian";
import { LightDb } from "./lightdb";
import { ExerciseNotes } from "./notes";
import { openGymDb } from "./schema";
import { horizontalScroll } from "./scroll";
import { Exercise, loadExercises, loadSchemes, Scheme } from "./workout";

interface Draft {
  schemeId: string;
  exerciseId: string;
  name: string;
  sets: string;
  reps: string;
}

interface NewExercise {
  schemeId: string;
  notePath: string;
  name: string;
  sets: string;
  reps: string;
}

export class PlanBlock extends MarkdownRenderChild {
  private db: LightDb | null = null;
  private draft: Draft | null = null;
  private adding: NewExercise | null = null;
  private saving = false;

  constructor(containerEl: HTMLElement, private app: App, private notes: ExerciseNotes) {
    super(containerEl);
  }

  async onload(): Promise<void> {
    this.containerEl.addClass("gym-plan");
    try {
      const db = await openGymDb(this.app);
      this.db = db;
      this.register(db.onChange(() => this.render()));
      this.register(this.notes.onChange(() => this.render()));
      this.render();
    } catch (error) {
      this.error(error);
    }
  }

  private error(error: unknown): void {
    this.containerEl.empty();
    this.containerEl.createDiv({ cls: "gym-error", text: error instanceof Error ? error.message : String(error) });
  }

  private render(): void {
    const db = this.db;
    if (!db) return;
    const root = this.containerEl;
    try {
      const exercises = loadExercises(db);
      this.notes.decorate(exercises);
      const schemes = loadSchemes(db);
      root.empty();
      for (const scheme of schemes) {
        root.createEl("h2", { text: scheme.name });
        const table = horizontalScroll(root).createEl("table");
        const head = table.createEl("thead").createEl("tr");
        for (const title of ["Exercise", "Sets", "Reps"]) head.createEl("th", { text: title });
        const body = table.createEl("tbody");
        for (const id of scheme.exercises) {
          const exercise = exercises.get(id);
          if (!exercise) continue;
          if (this.draft?.schemeId === scheme.id && this.draft.exerciseId === id) this.renderEditor(body, db, scheme, exercise, this.draft);
          else this.renderRow(body, scheme, exercise);
        }
        if (this.adding?.schemeId === scheme.id) this.renderAdd(root, db, scheme, this.adding);
        else {
          root.createEl("button", { cls: "gym-plan-add", text: "Add exercise" }).onclick = () => {
            this.draft = null;
            this.adding = {
              schemeId: scheme.id, notePath: "", name: "",
              sets: "3", reps: "12",
            };
            this.render();
          };
        }
      }
    } catch (error) {
      this.error(error);
    }
  }

  private renderRow(body: HTMLElement, scheme: Scheme, exercise: Exercise): void {
    const tr = body.createEl("tr", { cls: "gym-plan-row" });
    tr.onclick = () => {
      this.adding = null;
      this.draft = {
        schemeId: scheme.id,
        exerciseId: exercise.id,
        name: exercise.name,
        sets: String(exercise.sets),
        reps: exercise.reps === null ? "" : String(exercise.reps),
      };
      this.render();
    };
    this.renderName(tr.createEl("td"), exercise);
    tr.createEl("td", { cls: "gym-num", text: String(exercise.sets) });
    tr.createEl("td", { cls: "gym-num", text: exercise.reps === null ? "—" : String(exercise.reps) });
  }

  private renderEditor(body: HTMLElement, db: LightDb, scheme: Scheme, exercise: Exercise, draft: Draft): void {
    const cell = body.createEl("tr", { cls: "gym-plan-edit" }).createEl("td", { attr: { colspan: "3" } });
    this.renderName(cell.createDiv({ cls: "gym-plan-edit-name" }), exercise);
    const nameField = cell.createEl("label", { cls: "gym-plan-field" });
    nameField.createSpan({ text: "Name" });
    const name = nameField.createEl("input", { cls: "gym-plan-name", type: "text" });
    name.value = draft.name;
    name.oninput = () => (draft.name = name.value);
    const fields = cell.createDiv({ cls: "gym-plan-fields" });
    this.planFields(fields, draft);

    const actions = cell.createDiv({ cls: "gym-plan-actions" });
    const index = scheme.exercises.indexOf(exercise.id);
    const up = actions.createEl("button", { text: "↑" });
    up.disabled = index <= 0;
    up.onclick = () => void this.act(() => this.move(db, scheme, exercise.id, -1));
    const down = actions.createEl("button", { text: "↓" });
    down.disabled = index >= scheme.exercises.length - 1;
    down.onclick = () => void this.act(() => this.move(db, scheme, exercise.id, 1));
    actions.createEl("button", { cls: "mod-warning", text: "Remove from group" }).onclick = () => {
      if (!window.confirm(`Remove "${exercise.name}" from ${scheme.name}? History is kept.`)) return;
      void this.act(async () => {
        await db.delete("scheme_exercises", `${scheme.id}:${exercise.id}`);
        this.draft = null;
      });
    };
    actions.createDiv({ cls: "gym-plan-spacer" });
    actions.createEl("button", { text: "Cancel" }).onclick = () => {
      this.draft = null;
      this.render();
    };
    actions.createEl("button", { cls: "gym-primary", text: "Save" }).onclick = () => {
      const plan = parsePlan(draft);
      if (!plan) return;
      const newName = draft.name.trim();
      if (!newName) {
        new Notice("Gym: enter a name");
        return;
      }
      void this.act(async () => {
        const note = exercise.note;
        const file = note ? this.app.vault.getAbstractFileByPath(note) : null;
        if (file instanceof TFile) await this.notes.rename(file, newName);
        await db.transaction([
          { op: "put", table: "exercises", row: draft.exerciseId, fields: { name: newName } },
          { op: "put", table: "plan", row: draft.exerciseId, fields: plan },
        ]);
        this.draft = null;
      });
    };
  }

  private renderAdd(root: HTMLElement, db: LightDb, scheme: Scheme, form: NewExercise): void {
    const box = root.createDiv({ cls: "gym-plan-new" });
    box.createDiv({ cls: "gym-plan-edit-name", text: `Add exercise to ${scheme.name}` });

    const pickField = box.createEl("label", { cls: "gym-plan-field" });
    pickField.createSpan({ text: "Exercise" });
    const pick = pickField.createEl("select", { cls: "dropdown" });
    pick.createEl("option", { text: "New exercise", value: "" });
    for (const file of this.notes.files()) {
      const id = this.notes.idOf(file);
      if (id && scheme.exercises.includes(id)) continue;
      pick.createEl("option", { text: file.basename, value: file.path });
    }
    pick.value = form.notePath;
    pick.onchange = () => {
      form.notePath = pick.value;
      this.render();
    };

    if (!form.notePath) {
      const nameField = box.createEl("label", { cls: "gym-plan-field" });
      nameField.createSpan({ text: "Name" });
      const name = nameField.createEl("input", { type: "text", attr: { placeholder: "Pull-ups" } });
      name.value = form.name;
      name.oninput = () => (form.name = name.value);
    }
    this.planFields(box.createDiv({ cls: "gym-plan-fields" }), form);

    const actions = box.createDiv({ cls: "gym-plan-actions" });
    actions.createDiv({ cls: "gym-plan-spacer" });
    actions.createEl("button", { text: "Cancel" }).onclick = () => {
      this.adding = null;
      this.render();
    };
    actions.createEl("button", { cls: "gym-primary", text: "Add" }).onclick = () => {
      const plan = parsePlan(form);
      if (!plan) return;
      const name = form.name.trim();
      if (!form.notePath && !name) {
        new Notice("Gym: enter a name");
        return;
      }
      void this.act(async () => {
        let id: string;
        let title: string;
        if (form.notePath) {
          const file = this.app.vault.getAbstractFileByPath(form.notePath);
          if (!(file instanceof TFile)) throw new Error(`${form.notePath} not found`);
          id = await this.notes.ensureId(file);
          title = file.basename;
        } else {
          const created = await this.notes.create(name);
          id = created.id;
          title = created.file.basename;
        }
        const known = db.all("SELECT 1 FROM exercises WHERE id = ?", [id]).length > 0;
        await db.transaction([
          ...(known ? [] : [{ op: "put" as const, table: "exercises", row: id, fields: { name: title, note: null, per_side: 0 } }]),
          { op: "put", table: "plan", row: id, fields: plan },
          { op: "put", table: "scheme_exercises", row: `${scheme.id}:${id}`, fields: { scheme_id: scheme.id, exercise_id: id, position: nextPosition(db, scheme.id) } },
        ]);
        this.adding = null;
      });
    };
  }

  private planFields(fields: HTMLElement, draft: { sets: string; reps: string }): void {
    const number = (label: string, value: string, set: (v: string) => void) => {
      const field = fields.createEl("label", { cls: "gym-plan-field" });
      field.createSpan({ text: label });
      const input = field.createEl("input", { type: "number", attr: { min: "1", step: "1", inputmode: "numeric" } });
      input.value = value;
      input.oninput = () => set(input.value);
    };
    number("Sets", draft.sets, (v) => (draft.sets = v));
    number("Reps", draft.reps, (v) => (draft.reps = v));
  }

  private async move(db: LightDb, scheme: Scheme, exerciseId: string, shift: number): Promise<void> {
    const order = [...scheme.exercises];
    const from = order.indexOf(exerciseId);
    const to = from + shift;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    const current = new Map(db.all("SELECT exercise_id, position FROM scheme_exercises WHERE scheme_id = ?", [scheme.id])
      .map((r) => [r.exercise_id as string, r.position as number]));
    const ops = order
      .map((id, i) => ({ id, position: i + 1 }))
      .filter(({ id, position }) => current.get(id) !== position)
      .map(({ id, position }) => ({ op: "put" as const, table: "scheme_exercises", row: `${scheme.id}:${id}`, fields: { position } }));
    if (ops.length) await db.transaction(ops);
  }

  private async act(action: () => Promise<void>): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      await action();
      this.render();
    } catch (error) {
      new Notice(`Gym: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.saving = false;
    }
  }

  private renderName(el: HTMLElement, exercise: Exercise): void {
    if (!exercise.note) {
      el.setText(exercise.name);
      return;
    }
    const target = exercise.note;
    const link = el.createEl("a", { cls: "internal-link", text: exercise.name, attr: { "data-href": target, href: target } });
    link.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.app.workspace.openLinkText(target, "", false);
    };
  }
}

function parsePlan(draft: { sets: string; reps: string }): { sets: number; reps: number } | null {
  const sets = Number(draft.sets);
  const reps = Number(draft.reps);
  if (!Number.isInteger(sets) || sets < 1 || !Number.isInteger(reps) || reps < 1) {
    new Notice("Gym: sets and reps must be whole numbers from 1");
    return null;
  }
  return { sets, reps };
}

function nextPosition(db: LightDb, schemeId: string): number {
  const row = db.all("SELECT coalesce(max(position), 0) AS p FROM scheme_exercises WHERE scheme_id = ?", [schemeId])[0];
  return (row.p as number) + 1;
}
