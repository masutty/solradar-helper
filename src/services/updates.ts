import { HELPER_LATEST_RELEASE_API, HELPER_VERSION, SOLRADAR_REPO, VENCORD_REPO } from "../core/constants";
import { remoteHead, type ServiceCtx } from "./git";
import { fetchRemotePluginVersion } from "./solradar";

export interface UpdateInfo {
    vencord: { local?: string; remote?: string };
    solradar: { localCommit?: string; remoteCommit?: string; localVersion?: string; remoteVersion?: string };
    helper: { current: string; latest?: string };
    failed: boolean;
}

export function isNewerVersion(candidate: string, current: string): boolean {
    const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number);
    const a = parse(candidate), b = parse(current);
    if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const d = (a[i] ?? 0) - (b[i] ?? 0);
        if (d) return d > 0;
    }
    return false;
}

export function updateAvailable(u: UpdateInfo): boolean {
    const differs = (l?: string, r?: string) => !!l && !!r && l !== r;
    return differs(u.vencord.local, u.vencord.remote) || differs(u.solradar.localCommit, u.solradar.remoteCommit);
}

async function fetchLatestHelperVersion(fetchFn: typeof fetch): Promise<string | undefined> {
    try {
        const res = await fetchFn(HELPER_LATEST_RELEASE_API, { headers: { accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return undefined;
        const tag = (await res.json() as any)?.tag_name;
        return typeof tag === "string" ? tag.replace(/^v/, "") : undefined;
    } catch {
        return undefined;
    }
}

// Never throws: update checks must not block the Helper's main functions.
export async function checkUpdates(
    ctx: ServiceCtx,
    local: { vencordCommit?: string; pluginCommit?: string; pluginVersion?: string },
    fetchFn: typeof fetch = fetch,
): Promise<UpdateInfo> {
    const [vencordRemote, pluginRemote, pluginVersion, helperLatest] = await Promise.all([
        remoteHead(ctx, VENCORD_REPO).catch(() => undefined),
        remoteHead(ctx, SOLRADAR_REPO).catch(() => undefined),
        fetchRemotePluginVersion(fetchFn),
        fetchLatestHelperVersion(fetchFn),
    ]);
    return {
        vencord: { local: local.vencordCommit, remote: vencordRemote },
        solradar: { localCommit: local.pluginCommit, remoteCommit: pluginRemote, localVersion: local.pluginVersion, remoteVersion: pluginVersion },
        helper: { current: HELPER_VERSION, latest: helperLatest },
        failed: !vencordRemote || !pluginRemote,
    };
}
