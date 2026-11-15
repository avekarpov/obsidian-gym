import { App } from "obsidian";

export type Value = string | number | null;

export type OpInput =
  | { op: "migrate"; id: string; sql: string }
  | { op: "put"; table: string; row: string; fields: Record<string, Value> }
  | { op: "delete"; table: string; row: string };

export interface LightDb {
  all(sql: string, params?: Value[]): Record<string, unknown>[];
  put(table: string, row: string, fields: Record<string, Value>): Promise<string>;
  migrate(id: string, sql: string): Promise<string | null>;
  transaction(ops: OpInput[]): Promise<string>;
  onChange(listener: () => void): () => void;
}

interface LightDbApi {
  version: 1;
  open(name: string): Promise<LightDb>;
}

export function lightDbApi(app: App): LightDbApi | null {
  const plugins = (app as unknown as { plugins: { getPlugin(id: string): { api?: LightDbApi } | null } }).plugins;
  return plugins.getPlugin("lightdb")?.api ?? null;
}
