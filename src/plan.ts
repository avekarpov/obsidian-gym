import { App, MarkdownRenderChild, Notice, TFile } from "obsidian";
import { onLanguageChange, t } from "./i18n";
import { Group, PlanItem } from "./model";
import { ExerciseNotes } from "./notes";
import { horizontalScroll } from "./scroll";
import { GymStore } from "./store";

interface Draft {
  group: string;
  exercise: string;
  name: string;
  sets: string;
  reps: string;
}

interface NewExercise {
  group: string;
  notePath: string;
  name: string;
  sets: string;
  reps: string;
}

export class PlanBlock extends MarkdownRenderChild {
  private draft: Draft | null = null;
  private adding: NewExercise | null = null;
  private newGroup: { name: string } | null = null;
  private saving = false;

  constructor(containerEl: HTMLElement, private app: App, private store: GymStore, private notes: ExerciseNotes) {
    super(containerEl);
  }

  onload(): void {
    this.containerEl.addClass("gym-plan");
    this.register(this.store.onChange(() => this.render()));
    this.register(this.notes.onChange(() => this.render()));
    this.register(onLanguageChange(() => this.render()));
    this.render();
  }

  private render(): void {
    const root = this.containerEl;
    root.empty();
    for (const line of this.store.planErrors) {
      root.createDiv({ cls: "gym-error", text: t("Invalid data: {error}", { error: line }) });
    }
    for (const group of this.store.plan) {
      root.createEl("h2", { text: group.name });
      const table = horizontalScroll(root).createEl("table");
      const head = table.createEl("thead").createEl("tr");
      for (const title of ["Exercise", "Sets", "Reps"]) head.createEl("th", { text: t(title) });
      const body = table.createEl("tbody");
      for (const item of group.items) {
        if (this.draft?.group === group.name && this.draft.exercise === item.name) this.renderEditor(body, group, item, this.draft);
        else this.renderRow(body, group, item);
      }
      if (this.adding?.group === group.name) {
        this.renderAdd(root, group, this.adding);
        continue;
      }
      root.createEl("button", { cls: "gym-plan-add", text: t("Add exercise") }).onclick = () => {
        this.draft = null;
        this.adding = { group: group.name, notePath: "", name: "", sets: "3", reps: "12" };
        this.render();
      };
      root.createEl("button", { cls: "gym-plan-add mod-warning", text: t("Delete workout") }).onclick = () => this.deleteGroup(group);
    }
    this.renderNewGroup(root);
  }

  private renderRow(body: HTMLElement, group: Group, item: PlanItem): void {
    const tr = body.createEl("tr", { cls: "gym-plan-row" });
    tr.onclick = () => {
      this.adding = null;
      this.draft = { group: group.name, exercise: item.name, name: item.name, sets: String(item.sets), reps: String(item.reps) };
      this.render();
    };
    this.renderName(tr.createEl("td"), item.name);
    tr.createEl("td", { cls: "gym-num", text: String(item.sets) });
    tr.createEl("td", { cls: "gym-num", text: String(item.reps) });
  }

  private renderEditor(body: HTMLElement, group: Group, item: PlanItem, draft: Draft): void {
    const cell = body.createEl("tr", { cls: "gym-plan-edit" }).createEl("td", { attr: { colspan: "3" } });
    this.renderName(cell.createDiv({ cls: "gym-plan-edit-name" }), item.name);
    const nameField = cell.createEl("label", { cls: "gym-plan-field" });
    nameField.createSpan({ text: t("Name") });
    const name = nameField.createEl("input", { cls: "gym-plan-name", type: "text" });
    name.value = draft.name;
    name.oninput = () => (draft.name = name.value);
    this.planFields(cell.createDiv({ cls: "gym-plan-fields" }), draft);

    const actions = cell.createDiv({ cls: "gym-plan-actions" });
    const index = group.items.indexOf(item);
    const up = actions.createEl("button", { text: "↑" });
    up.disabled = index <= 0;
    up.onclick = () => void this.act(() => this.move(group, item, -1));
    const down = actions.createEl("button", { text: "↓" });
    down.disabled = index >= group.items.length - 1;
    down.onclick = () => void this.act(() => this.move(group, item, 1));
    actions.createEl("button", { cls: "mod-warning", text: t("Remove from group") }).onclick = () => {
      if (!window.confirm(t("Remove \"{name}\" from {group}? History is kept.", { name: item.name, group: group.name }))) return;
      void this.act(async () => {
        await this.store.updatePlan((plan) => {
          const target = plan.find((g) => g.name === group.name);
          if (target) target.items = target.items.filter((i) => i.name !== item.name);
        });
        this.draft = null;
      });
    };
    actions.createDiv({ cls: "gym-plan-spacer" });
    actions.createEl("button", { text: t("Cancel") }).onclick = () => {
      this.draft = null;
      this.render();
    };
    actions.createEl("button", { cls: "gym-primary", text: t("Save") }).onclick = () => {
      const numbers = parseNumbers(draft);
      if (!numbers) return;
      void this.act(async () => {
        const newName = this.notes.cleanName(draft.name);
        if (newName !== item.name) {
          await this.store.renameExercise(item.name, newName);
          const path = this.notes.pathOf(item.name);
          const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
          if (file instanceof TFile) await this.notes.rename(file, newName);
        }
        await this.store.updatePlan((plan) => {
          const target = plan.find((g) => g.name === group.name)?.items.find((i) => i.name === newName);
          if (target) Object.assign(target, numbers);
        });
        this.draft = null;
      });
    };
  }

  private renderAdd(root: HTMLElement, group: Group, form: NewExercise): void {
    const box = root.createDiv({ cls: "gym-plan-new" });
    box.createDiv({ cls: "gym-plan-edit-name", text: t("Add exercise to {group}", { group: group.name }) });

    const pickField = box.createEl("label", { cls: "gym-plan-field" });
    pickField.createSpan({ text: t("Exercise") });
    const pick = pickField.createEl("select", { cls: "dropdown" });
    pick.createEl("option", { text: t("New exercise"), value: "" });
    const inGroup = new Set(group.items.map((i) => i.name));
    for (const file of this.notes.files()) {
      if (!inGroup.has(file.basename)) pick.createEl("option", { text: file.basename, value: file.path });
    }
    pick.value = form.notePath;
    pick.onchange = () => {
      form.notePath = pick.value;
      this.render();
    };

    if (!form.notePath) {
      const nameField = box.createEl("label", { cls: "gym-plan-field" });
      nameField.createSpan({ text: t("Name") });
      const name = nameField.createEl("input", { type: "text", attr: { placeholder: t("Pull-ups") } });
      name.value = form.name;
      name.oninput = () => (form.name = name.value);
    }
    this.planFields(box.createDiv({ cls: "gym-plan-fields" }), form);

    const actions = box.createDiv({ cls: "gym-plan-actions" });
    actions.createDiv({ cls: "gym-plan-spacer" });
    actions.createEl("button", { text: t("Cancel") }).onclick = () => {
      this.adding = null;
      this.render();
    };
    actions.createEl("button", { cls: "gym-primary", text: t("Add") }).onclick = () => {
      const numbers = parseNumbers(form);
      if (!numbers) return;
      if (!form.notePath && !form.name.trim()) {
        new Notice(t("Gym: enter a name"));
        return;
      }
      void this.act(async () => {
        const file = form.notePath ? this.app.vault.getAbstractFileByPath(form.notePath) : await this.notes.create(form.name);
        if (!(file instanceof TFile)) throw new Error(t("{path} not found", { path: form.notePath }));
        await this.store.updatePlan((plan) => {
          const target = plan.find((g) => g.name === group.name);
          if (target && !target.items.some((i) => i.name === file.basename)) target.items.push({ name: file.basename, ...numbers });
        });
        this.adding = null;
      });
    };
  }

  private renderNewGroup(root: HTMLElement): void {
    const form = this.newGroup;
    if (!form) {
      root.createEl("button", { cls: "gym-plan-add gym-plan-add-group", text: t("Add workout") }).onclick = () => {
        this.newGroup = { name: "" };
        this.render();
      };
      return;
    }
    const box = root.createDiv({ cls: "gym-plan-new" });
    box.createDiv({ cls: "gym-plan-edit-name", text: t("Add workout") });
    const field = box.createEl("label", { cls: "gym-plan-field" });
    field.createSpan({ text: t("Name") });
    const input = field.createEl("input", { type: "text" });
    input.value = form.name;
    input.oninput = () => (form.name = input.value);
    const actions = box.createDiv({ cls: "gym-plan-actions" });
    actions.createDiv({ cls: "gym-plan-spacer" });
    actions.createEl("button", { text: t("Cancel") }).onclick = () => {
      this.newGroup = null;
      this.render();
    };
    actions.createEl("button", { cls: "gym-primary", text: t("Add") }).onclick = () => {
      const name = form.name.trim();
      if (!name) {
        new Notice(t("Gym: enter a name"));
        return;
      }
      if (this.store.plan.some((g) => g.name === name)) {
        new Notice(t("Gym: a workout with this name already exists"));
        return;
      }
      void this.act(async () => {
        await this.store.updatePlan((plan) => {
          plan.push({ name, items: [] });
        });
        this.newGroup = null;
      });
    };
    window.setTimeout(() => input.focus(), 0);
  }

  private deleteGroup(group: Group): void {
    if (this.store.activeWorkout()?.group === group.name) {
      new Notice(t("Gym: finish the workout in progress first"));
      return;
    }
    if (!window.confirm(t("Delete workout \"{name}\"? Exercises and past workouts are kept.", { name: group.name }))) return;
    void this.act(async () => {
      await this.store.updatePlan((plan) => {
        const index = plan.findIndex((g) => g.name === group.name);
        if (index >= 0) plan.splice(index, 1);
      });
      if (this.draft?.group === group.name) this.draft = null;
    });
  }

  private planFields(fields: HTMLElement, draft: { sets: string; reps: string }): void {
    const number = (label: string, value: string, set: (v: string) => void) => {
      const field = fields.createEl("label", { cls: "gym-plan-field" });
      field.createSpan({ text: label });
      const input = field.createEl("input", { type: "number", attr: { min: "1", step: "1", inputmode: "numeric" } });
      input.value = value;
      input.oninput = () => set(input.value);
    };
    number(t("Sets"), draft.sets, (v) => (draft.sets = v));
    number(t("Reps"), draft.reps, (v) => (draft.reps = v));
  }

  private async move(group: Group, item: PlanItem, shift: number): Promise<void> {
    await this.store.updatePlan((plan) => {
      const items = plan.find((g) => g.name === group.name)?.items;
      if (!items) return;
      const from = items.findIndex((i) => i.name === item.name);
      const to = from + shift;
      if (from < 0 || to < 0 || to >= items.length) return;
      [items[from], items[to]] = [items[to], items[from]];
    });
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

  private renderName(el: HTMLElement, name: string): void {
    const target = this.notes.pathOf(name);
    if (!target) {
      el.setText(name);
      return;
    }
    const link = el.createEl("a", { cls: "internal-link", text: name, attr: { "data-href": target, href: target } });
    link.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.app.workspace.openLinkText(target, "", false);
    };
  }
}

function parseNumbers(draft: { sets: string; reps: string }): { sets: number; reps: number } | null {
  const sets = Number(draft.sets);
  const reps = Number(draft.reps);
  if (!Number.isInteger(sets) || sets < 1 || !Number.isInteger(reps) || reps < 1) {
    new Notice(t("Gym: sets and reps must be whole numbers from 1"));
    return null;
  }
  return { sets, reps };
}
