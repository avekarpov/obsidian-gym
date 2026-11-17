import { App, normalizePath, TFile } from "obsidian";
import { structureNames, t } from "./i18n";
import { Exercise } from "./workout";

export const GYM_ID = "gym-id";

const FORBIDDEN = /[\\/:*?"<>|#^[\]]/g;

export class ExerciseNotes {
  private byId = new Map<string, TFile>();
  private listeners = new Set<() => void>();
  private signature = "";
  private assigning = new Set<string>();

  constructor(private app: App, private gymFolder: () => string) {}

  get folder(): string | null {
    const root = this.gymFolder().trim();
    return root ? normalizePath(`${root}/${structureNames().exercises}`) : null;
  }

  files(): TFile[] {
    const folder = this.folder;
    if (!folder) return [];
    return this.app.vault.getMarkdownFiles()
      .filter((file) => file.path.startsWith(`${folder}/`))
      .sort((a, b) => a.basename.localeCompare(b.basename));
  }

  idOf(file: TFile): string | null {
    const value: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.[GYM_ID];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  }

  file(id: string): TFile | null {
    return this.byId.get(id) ?? null;
  }

  rebuild(): void {
    const byId = new Map<string, TFile>();
    const files = this.files();
    for (const file of files) {
      const id = this.idOf(file);
      if (!id) continue;
      if (byId.has(id)) console.warn(`gym: ${file.path} repeats ${GYM_ID} ${id} of ${byId.get(id)!.path}`);
      else byId.set(id, file);
    }
    this.byId = byId;
    const signature = files.map((file) => `${file.path}=${this.idOf(file) ?? ""}`).join("\n");
    if (signature === this.signature) return;
    this.signature = signature;
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  decorate(exercises: Map<string, Exercise>): void {
    for (const exercise of exercises.values()) {
      const file = this.byId.get(exercise.id);
      exercise.note = file ? file.path : null;
      if (file) exercise.name = file.basename;
    }
  }

  async ensureId(file: TFile): Promise<string> {
    const existing = this.idOf(file);
    if (existing) return existing;
    const candidate = await this.idForPath(file.path);
    let id = candidate;
    await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      const current = frontmatter[GYM_ID];
      if (typeof current === "string" && current.trim()) id = current.trim();
      else frontmatter[GYM_ID] = candidate;
    });
    this.byId.set(id, file);
    return id;
  }

  async assignMissingIds(): Promise<void> {
    for (const file of this.files()) {
      if (this.idOf(file) || this.assigning.has(file.path)) continue;
      this.assigning.add(file.path);
      try {
        await this.ensureId(file);
      } catch (error) {
        console.error(`gym: cannot add ${GYM_ID} to ${file.path}`, error);
      } finally {
        this.assigning.delete(file.path);
      }
    }
  }

  async create(name: string): Promise<{ file: TFile; id: string }> {
    const folder = this.folder;
    if (!folder) throw new Error(t("Set the Gym folder in settings first"));
    const path = this.pathFor(name);
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error(t("{path} already exists", { path }));
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const id = await this.idForPath(path);
    const file = await this.app.vault.create(path, `---\n${GYM_ID}: ${id}\n---\n`);
    this.byId.set(id, file);
    return { file, id };
  }

  async rename(file: TFile, name: string): Promise<void> {
    const path = this.pathFor(name, file.parent?.path);
    if (path === file.path) return;
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error(t("{path} already exists", { path }));
    await this.app.fileManager.renameFile(file, path);
  }

  private async idForPath(path: string): Promise<string> {
    const folder = this.folder;
    const relative = folder && path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(relative));
    const hex = [...new Uint8Array(digest)].slice(0, 4).map((b) => b.toString(16).padStart(2, "0")).join("");
    return `ex_${hex}`;
  }

  private pathFor(name: string, folder = this.folder): string {
    const clean = name.replace(FORBIDDEN, " ").replace(/\s+/g, " ").trim();
    if (!clean) throw new Error(t("Exercise name is empty"));
    return normalizePath(`${folder}/${clean}.md`);
  }
}
