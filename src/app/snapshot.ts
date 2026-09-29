import type { AppPaths } from "../core/paths";
import { checkDependency, isWingetAvailable, minNodeMajor, type DependencyStatus } from "../services/dependencies";
import {
    findDiscordInstalls, isDiscordRunning, pickInstall, readInjection, type DiscordInstall, type InjectionState,
} from "../services/discord";
import { inspectRepo, type RepoStatus, type ServiceCtx } from "../services/git";
import { inspectPlugin, type PluginStatus } from "../services/solradar";
import { isBuilt, readVencordPackage } from "../services/vencord";
import { VENCORD_REPO } from "../core/constants";

export interface Snapshot {
    dependencies: DependencyStatus[];
    wingetAvailable: boolean;
    discord: { installs: DiscordInstall[]; selected?: DiscordInstall; running: boolean; injection: InjectionState };
    vencord: RepoStatus & { built: boolean };
    solradar: PluginStatus;
}

// Always rebuilt from the machine; persisted state is only a hint (preferred branch).
export async function takeSnapshot(ctx: ServiceCtx, paths: AppPaths, localAppData: string, preferredBranch?: string): Promise<Snapshot> {
    const min = minNodeMajor(readVencordPackage(paths.checkout)?.engines?.node);
    const [git, node, wingetAvailable] = await Promise.all([
        checkDependency("git", ctx.runner, ctx.env, min),
        checkDependency("node", ctx.runner, ctx.env, min),
        isWingetAvailable(ctx.runner, ctx.env),
    ]);

    const installs = findDiscordInstalls(localAppData);
    const selected = pickInstall(installs, preferredBranch);
    let running = false;
    let injection: InjectionState = "not-injected";
    if (selected) {
        injection = readInjection(selected, paths.checkout);
        running = await isDiscordRunning(selected, ctx.runner, ctx.env).catch(() => false);
    }

    const [vencord, solradar] = await Promise.all([
        inspectRepo(ctx, paths.checkout, VENCORD_REPO, "package.json"),
        inspectPlugin(ctx, paths),
    ]);

    return {
        dependencies: [git, node],
        wingetAvailable,
        discord: { installs, selected, running, injection },
        vencord: { ...vencord, built: isBuilt(paths) },
        solradar,
    };
}
