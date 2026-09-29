import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SOLRADAR_REPO, SOLRADAR_VERSION_URL } from "../core/constants";
import type { AppPaths } from "../core/paths";
import { inspectRepo, type RepoStatus, type ServiceCtx } from "./git";

export interface PluginStatus extends RepoStatus {
    version?: string;
}

export function readPluginVersion(dir: string): string | undefined {
    try {
        const v = JSON.parse(readFileSync(join(dir, "version.json"), "utf8")).currentVersion;
        return typeof v === "string" ? v : undefined;
    } catch {
        return undefined;
    }
}

export async function inspectPlugin(ctx: ServiceCtx, paths: AppPaths): Promise<PluginStatus> {
    const status = await inspectRepo(ctx, paths.plugin, SOLRADAR_REPO, "index.tsx");
    return { ...status, version: readPluginVersion(paths.plugin) };
}

export async function fetchRemotePluginVersion(fetchFn: typeof fetch = fetch): Promise<string | undefined> {
    try {
        const res = await fetchFn(SOLRADAR_VERSION_URL, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return undefined;
        const v = (await res.json() as any)?.currentVersion;
        return typeof v === "string" ? v : undefined;
    } catch {
        return undefined;
    }
}
