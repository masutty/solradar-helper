import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Only hints; the real state is always re-derived from the filesystem.
export interface PersistedState {
    branch?: string;
    lastOperation?: { op: string; ok: boolean; at: string };
}

export function loadState(file: string): PersistedState {
    try {
        const data = JSON.parse(readFileSync(file, "utf8"));
        return data && typeof data === "object" ? data : {};
    } catch {
        return {};
    }
}

export function saveState(file: string, state: PersistedState): void {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
}
