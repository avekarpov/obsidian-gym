import { App, TFile } from "obsidian";
import { LightDb } from "./lightdb";
import { ExerciseNotes } from "./notes";
import { loadSchemes } from "./workout";

export const PLAN_LINKS = "gym-exercises";
export const PLAN_LINK = "gym-plan";

const DEBOUNCE_MS = 1000;

export class PlanLinks {
  private timer: number | null = null;

  constructor(
    private app: App,
    private db: LightDb,
    private notes: ExerciseNotes,
    private planPath: () => string | null,
    private linkedNotes: () => string[],
  ) {}

  schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.run();
    }, DEBOUNCE_MS);
  }

  cancel(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  async run(): Promise<void> {
    try {
      const path = this.planPath();
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      if (!(file instanceof TFile)) return;
      const wanted = this.links();
      const current: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[PLAN_LINKS];
      if (!sameList(current, wanted)) {
        await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
          if (wanted.length) frontmatter[PLAN_LINKS] = wanted;
          else delete frontmatter[PLAN_LINKS];
        });
      }
      const planLink = link(file);
      for (const notePath of this.linkedNotes()) {
        const note = this.app.vault.getAbstractFileByPath(notePath);
        if (!(note instanceof TFile)) continue;
        if (this.app.metadataCache.getFileCache(note)?.frontmatter?.[PLAN_LINK] === planLink) continue;
        await this.app.fileManager.processFrontMatter(note, (frontmatter: Record<string, unknown>) => {
          frontmatter[PLAN_LINK] = planLink;
        });
      }
    } catch (error) {
      console.error("gym: cannot update plan links", error);
    }
  }

  private links(): string[] {
    const links: string[] = [];
    for (const scheme of loadSchemes(this.db)) {
      for (const id of scheme.exercises) {
        const note = this.notes.file(id);
        if (!note) continue;
        const noteLink = link(note);
        if (!links.includes(noteLink)) links.push(noteLink);
      }
    }
    return links;
  }
}

function link(file: TFile): string {
  return `[[${file.path.replace(/\.md$/, "")}|${file.basename}]]`;
}

function sameList(current: unknown, wanted: string[]): boolean {
  if (!wanted.length) return current === undefined;
  return Array.isArray(current) && current.length === wanted.length && current.every((item, i) => item === wanted[i]);
}
