import { App, normalizePath, TAbstractFile, TFile } from "obsidian";
import { structureNames, t } from "./i18n";
import {
  findBlock, Group, parseDiary, parsePlan, replaceBlock, serializeDiary, serializePlan, Workout,
} from "./model";

export const PLAN_BLOCK = "gym-plan";
export const LOG_BLOCK = "gym-log";

export class GymStore {
  plan: Group[] = [];
  diary: Workout[] = [];
  planErrors: string[] = [];
  diaryErrors: string[] = [];
  private listeners = new Set<() => void>();

  constructor(private app: App, private root: () => string | null) {}

  get planPath(): string | null {
    const root = this.root();
    return root ? normalizePath(`${root}/${structureNames().plan}`) : null;
  }

  get diaryPath(): string | null {
    const root = this.root();
    return root ? normalizePath(`${root}/${structureNames().log}`) : null;
  }

  isDataFile(file: TAbstractFile | string): boolean {
    const path = typeof file === "string" ? file : file.path;
    return path === this.planPath || path === this.diaryPath;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<void> {
    const plan = parsePlan(await this.readBlock(this.planPath, PLAN_BLOCK));
    const diary = parseDiary(await this.readBlock(this.diaryPath, LOG_BLOCK));
    this.plan = plan.value;
    this.planErrors = plan.errors;
    this.diary = diary.value;
    this.diaryErrors = diary.errors;
    for (const listener of this.listeners) listener();
  }

  activeWorkout(): Workout | null {
    return this.diary.find((workout) => !workout.end) ?? null;
  }

  async updatePlan(change: (plan: Group[]) => void): Promise<void> {
    await this.update(this.planPath, PLAN_BLOCK, (content) => {
      const plan = parsePlan(content);
      if (plan.errors.length) throw new Error(t("Fix the JSON in {path} first: {error}", { path: this.planPath ?? "", error: plan.errors[0] }));
      change(plan.value);
      return serializePlan(plan.value);
    });
  }

  async updateDiary(change: (diary: Workout[]) => void): Promise<void> {
    await this.update(this.diaryPath, LOG_BLOCK, (content) => {
      const diary = parseDiary(content);
      if (diary.errors.length) throw new Error(t("Fix the JSON in {path} first: {error}", { path: this.diaryPath ?? "", error: diary.errors[0] }));
      change(diary.value);
      return serializeDiary(diary.value);
    });
  }

  async renameExercise(from: string, to: string): Promise<void> {
    if (from === to) return;
    if (this.plan.some((group) => group.items.some((item) => item.name === from))) {
      await this.updatePlan((plan) => {
        for (const group of plan) for (const item of group.items) if (item.name === from) item.name = to;
      });
    }
    if (this.diary.some((workout) => workout.current === from || workout.records.some((record) => record.exercise === from))) {
      await this.updateDiary((diary) => {
        for (const workout of diary) {
          if (workout.current === from) workout.current = to;
          for (const record of workout.records) if (record.exercise === from) record.exercise = to;
        }
      });
    }
  }

  private async readBlock(path: string | null, language: string): Promise<string> {
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof TFile)) return "";
    return findBlock(await this.app.vault.read(file), language)?.content ?? "";
  }

  private async update(path: string | null, language: string, change: (content: string) => string): Promise<void> {
    if (!path) throw new Error("Set the Gym folder in settings first");
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) file = await this.app.vault.create(path, "```" + language + "\n```\n");
    await this.app.vault.process(file as TFile, (text) => {
      const content = findBlock(text, language)?.content ?? "";
      return replaceBlock(text, language, change(content));
    });
    await this.load();
  }
}
