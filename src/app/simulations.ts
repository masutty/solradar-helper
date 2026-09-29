import { HELPER_VERSION } from "../core/constants";
import type { UpdateInfo } from "../services/updates";
import type { Snapshot } from "./snapshot";

export const SIMULATIONS = [
    { id: "solradar-update", label: "SolRadar update available" },
    { id: "vencord-update", label: "Vencord update available" },
    { id: "helper-update", label: "New Helper version available" },
    { id: "update-failed", label: "Update check failed" },
    { id: "git-missing", label: "Git missing" },
    { id: "node-missing", label: "Node.js missing" },
    { id: "node-old", label: "Node.js too old" },
    { id: "discord-missing", label: "Discord not found" },
    { id: "discord-running", label: "Discord running" },
] as const;

export type SimulationId = (typeof SIMULATIONS)[number]["id"];

export const isSimulationId = (id: unknown): id is SimulationId => SIMULATIONS.some(s => s.id === id);

/** "1.3.6" -> "1.3.7", "v2.0.0" -> "2.0.1". Unknown or unparseable input -> "999.999.999". */
export function bumpPatch(version?: string): string {
    const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec((version ?? "").trim());
    return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : "999.999.999";
}

/**
 * Pure display overrides for testing how the window reacts. Nothing is written anywhere:
 * the real snapshot and update info are copied, never mutated.
 */
export function applySimulations(
    snapshot: Snapshot, updates: UpdateInfo | null, sims: ReadonlySet<SimulationId>,
): { snapshot: Snapshot; updates: UpdateInfo | null } {
    if (sims.size === 0) return { snapshot, updates };

    let s: Snapshot = { ...snapshot, dependencies: [...snapshot.dependencies], discord: { ...snapshot.discord } };
    const setDep = (id: "git" | "node", status: Snapshot["dependencies"][number]) => {
        s.dependencies = s.dependencies.map(d => (d.id === id ? status : d));
    };
    if (sims.has("git-missing")) setDep("git", { id: "git", state: "missing" });
    if (sims.has("node-missing")) setDep("node", { id: "node", state: "missing" });
    else if (sims.has("node-old")) setDep("node", { id: "node", state: "outdated", version: "18.0.0", detail: "Simulated: version too old." });
    if (sims.has("discord-missing")) s.discord = { installs: [], selected: undefined, running: false, injection: "not-injected" };
    else if (sims.has("discord-running") && s.discord.selected) s.discord.running = true;

    const wantsUpdates = ["solradar-update", "vencord-update", "helper-update", "update-failed"].some(id => sims.has(id as SimulationId));
    let u: UpdateInfo | null = updates;
    if (wantsUpdates) {
        const base: UpdateInfo = updates ?? {
            vencord: { local: s.vencord.commit, remote: s.vencord.commit },
            solradar: { localCommit: s.solradar.commit, remoteCommit: s.solradar.commit, localVersion: s.solradar.version, remoteVersion: s.solradar.version },
            helper: { current: HELPER_VERSION },
            failed: false,
        };
        u = { ...base, vencord: { ...base.vencord }, solradar: { ...base.solradar }, helper: { ...base.helper } };
        if (sims.has("vencord-update")) u.vencord.remote = "simulated-remote";
        if (sims.has("solradar-update")) {
            u.solradar.remoteCommit = "simulated";
            u.solradar.remoteVersion = bumpPatch(u.solradar.localVersion);
        }
        if (sims.has("helper-update")) u.helper.latest = bumpPatch(u.helper.current);
        if (sims.has("update-failed")) {
            u.failed = true;
            u.vencord.remote = undefined;
            u.solradar.remoteCommit = undefined;
            u.solradar.remoteVersion = undefined;
        }
    }
    return { snapshot: s, updates: u };
}
