import { HELPER_REPO_URL } from "../core/constants";
import { DEPENDENCIES, type DependencyId, type DependencyState } from "../services/dependencies";
import type { DiscordBranch } from "../services/discord";
import { isNewerVersion, updateAvailable, type UpdateInfo } from "../services/updates";
import type { SimulationId } from "./simulations";
import type { Snapshot } from "./snapshot";

export type Tone = "ok" | "warn" | "error" | "neutral";

export interface DependencyView {
    id: DependencyId;
    name: string;
    why: string;
    state: DependencyState;
    version?: string;
    detail?: string;
    downloadUrl: string;
    manualSteps: string[];
    canAutoInstall: boolean;
}

export interface ViewModel {
    headline: string;
    subline?: string;
    tone: Tone;
    installed: boolean;
    discord: {
        label: string;
        tone: Tone;
        running: boolean;
        injected: boolean;
        branches: { branch: DiscordBranch; label: string }[];
        selected?: DiscordBranch;
    };
    dependencies: DependencyView[];
    /** `short` is a compact value for the status strip, for example "abc1234" or "not yet". */
    vencord: { label: string; tone: Tone; short: string };
    /** `latest` is set only when a newer SolRadar version is known. */
    solradar: { label: string; tone: Tone; short: string; latest?: string };
    updateText?: string;
    /** "Reinstall" when installed and the update check succeeded with nothing new; otherwise "Update". */
    updateLabel: "Update" | "Reinstall";
    helperUpdate?: { latest: string; url: string };
    actions: { install: boolean; update: boolean; uninstall: boolean; repair: boolean };
    advanced: { build: boolean; inject: boolean };
    /** Active test scenarios (display-only overrides). */
    simulations: SimulationId[];
}

export function deriveView(s: Snapshot, u: UpdateInfo | null, simulations: SimulationId[] = []): ViewModel {
    const { discord, vencord, solradar } = s;
    const depsOk = s.dependencies.every(d => d.state === "ok");
    const hasDiscord = !!discord.selected;
    const ours = discord.injection === "injected";
    const modified = vencord.state === "modified" || solradar.state === "modified";
    const installed = ours && vencord.state === "ready" && vencord.built && solradar.state === "ready";
    const anyTrace = vencord.state !== "absent" || solradar.state !== "absent" || ours;
    const hasUpdate = !!u && updateAvailable(u);

    let headline: string, tone: Tone, subline: string | undefined;
    if (!hasDiscord) {
        [headline, tone, subline] = ["Discord was not found", "error", "Install Discord first, then click Check again."];
    } else if (modified) {
        [headline, tone, subline] = ["SolRadar needs a repair", "warn", "The Helper's copy of Vencord or SolRadar was changed. Repair restores the original files."];
    } else if (installed && hasUpdate) {
        [headline, tone] = ["An update is available", "warn"];
    } else if (installed) {
        [headline, tone] = ["SolRadar is installed", "ok"];
    } else if (discord.injection === "injected-elsewhere") {
        [headline, tone, subline] = ["Discord is using a different Vencord", "neutral", "Installing SolRadar replaces it with a Vencord build that includes SolRadar."];
    } else if (anyTrace) {
        [headline, tone, subline] = ["SolRadar is not fully installed", "warn", "Click Install to finish."];
    } else {
        [headline, tone] = ["SolRadar is not installed", "neutral"];
    }
    if (hasDiscord && !depsOk && !installed) subline = "Some requirements are missing. Install them below first.";
    if (installed && u?.failed) subline = "Couldn't check for updates.";

    const selectedLabel = discord.selected?.label ?? "Discord";
    const dependencies: DependencyView[] = s.dependencies.map(d => ({
        ...d,
        name: DEPENDENCIES[d.id].name,
        why: DEPENDENCIES[d.id].why,
        downloadUrl: DEPENDENCIES[d.id].downloadUrl,
        manualSteps: DEPENDENCIES[d.id].manualSteps,
        canAutoInstall: s.wingetAvailable && d.state !== "ok",
    }));

    let updateText: string | undefined;
    if (hasUpdate && u) {
        const { localVersion, remoteVersion } = u.solradar;
        updateText = localVersion && remoteVersion && localVersion !== remoteVersion
            ? `SolRadar ${localVersion} → ${remoteVersion}`
            : "New Vencord or SolRadar changes are available.";
    }

    const remote = u?.solradar.remoteVersion;
    const latestVersion = hasUpdate && remote && remote !== u?.solradar.localVersion ? remote : undefined;
    const helperLatest = u?.helper.latest;
    return {
        headline, subline, tone, installed,
        discord: {
            label: !hasDiscord ? "Not found" : discord.running ? `${selectedLabel} is running` : `${selectedLabel} found`,
            tone: hasDiscord ? "ok" : "error",
            running: discord.running,
            injected: ours,
            branches: discord.installs.map(i => ({ branch: i.branch, label: i.label })),
            selected: discord.selected?.branch,
        },
        dependencies,
        vencord: {
            label: vencord.state === "ready" && vencord.built ? `Built from ${vencord.commit?.slice(0, 7) ?? "source"}`
                : vencord.state === "modified" ? "Has unexpected changes"
                : vencord.state === "absent" ? "Not downloaded"
                : vencord.state === "unknown" ? "Can't check (Git is missing)"
                : "Incomplete",
            tone: vencord.state === "ready" && vencord.built ? "ok" : vencord.state === "modified" ? "warn" : "neutral",
            short: vencord.state === "ready" && vencord.built ? (vencord.commit?.slice(0, 7) ?? "built")
                : vencord.state === "modified" ? "changed"
                : vencord.state === "absent" ? "not yet"
                : vencord.state === "unknown" ? "unknown"
                : "incomplete",
        },
        solradar: {
            label: solradar.state === "ready" ? `Version ${solradar.version ?? "unknown"}`
                : solradar.state === "modified" ? "Has unexpected changes"
                : solradar.state === "absent" ? "Not installed"
                : solradar.state === "unknown" ? "Can't check (Git is missing)"
                : "Incomplete",
            tone: solradar.state === "ready" ? (latestVersion ? "warn" : "ok") : solradar.state === "modified" ? "warn" : "neutral",
            short: solradar.state === "ready" ? (latestVersion ? `${solradar.version ?? "?"} → ${latestVersion}` : (solradar.version ?? "unknown"))
                : solradar.state === "modified" ? "changed"
                : solradar.state === "absent" ? "not yet"
                : solradar.state === "unknown" ? "unknown"
                : "incomplete",
            latest: latestVersion,
        },
        updateText,
        updateLabel: installed && u && !u.failed && !hasUpdate ? "Reinstall" : "Update",
        helperUpdate: helperLatest && u && isNewerVersion(helperLatest, u.helper.current) ? { latest: helperLatest, url: HELPER_REPO_URL } : undefined,
        actions: {
            install: hasDiscord && depsOk && !installed && !modified,
            update: hasDiscord && depsOk && installed && !modified,
            uninstall: hasDiscord && ours,
            repair: modified,
        },
        simulations,
        advanced: {
            build: depsOk && (vencord.state === "ready" || vencord.state === "modified") && (solradar.state === "ready" || solradar.state === "modified"),
            inject: hasDiscord && vencord.built,
        },
    };
}
