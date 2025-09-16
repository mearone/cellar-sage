import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

export function loadYaml<T>(relPath: string): T {
  const p = path.join(process.cwd(), relPath);
  const raw = fs.readFileSync(p, "utf8");
  return yaml.load(raw) as T;
}
