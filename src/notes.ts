import { App, normalizePath, TFile } from "obsidian";
import { structureNames, t } from "./i18n";

const FORBIDDEN = /[\\/:*?"<>|#^[\]]/g;

export class ExerciseNotes {
  private listeners = new Set<() => void>();
  private signature = "";

  constructor(private app: App, private gymFolder: () => string) {}

  get folder(): string | null {
    const root = this.gymFolder().trim();
    return root ? normalizePath(`${root}/${structureNames().exercises}`) : null;
  }

  contains(path: string): boolean {
    const folder = this.folder;
    return !!folder && path.startsWith(`${folder}/`) && path.endsWith(".md");
  }

  files(): TFile[] {
    return this.app.vault.getMarkdownFiles()
      .filter((file) => this.contains(file.path))
      .sort((a, b) => a.basename.localeCompare(b.basename));
  }

  pathOf(name: string): string | null {
    return this.files().find((file) => file.basename === name)?.path ?? null;
  }

  rebuild(): void {
    const signature = this.files().map((file) => file.path).join("\n");
    if (signature === this.signature) return;
    this.signature = signature;
    for (const listener of this.listeners) listener();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  cleanName(name: string): string {
    const clean = name.replace(FORBIDDEN, " ").replace(/\s+/g, " ").trim();
    if (!clean) throw new Error(t("Exercise name is empty"));
    return clean;
  }

  async create(name: string): Promise<TFile> {
    const folder = this.folder;
    if (!folder) throw new Error(t("Set the Gym folder in settings first"));
    const path = normalizePath(`${folder}/${this.cleanName(name)}.md`);
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error(t("{path} already exists", { path }));
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    return this.app.vault.create(path, "");
  }

  async rename(file: TFile, name: string): Promise<void> {
    const path = normalizePath(`${file.parent?.path ?? ""}/${this.cleanName(name)}.md`);
    if (path === file.path) return;
    if (this.app.vault.getAbstractFileByPath(path)) throw new Error(t("{path} already exists", { path }));
    await this.app.fileManager.renameFile(file, path);
  }
}
