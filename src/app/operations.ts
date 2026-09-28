import { mkdirSync } from "node:fs";
import type { CommandResult, CommandRunner } from "../core/commands";
import { SOLRADAR_REPO, VENCORD_REPO } from "../core/constants";
import type { ToolEnv } from "../core/env";
import { HelperError, toHelperError, type ErrorKind } from "../core/errors";
import type { Logger } from "../core/logger";
import type { AppPaths } from "../core/paths";
import { checkDependency, DEPENDENCIES, minNodeMajor } from "../services/dependencies";
import {
    closeDiscord, findDiscordInstalls, isDiscordRunning, launchDiscord, pickInstall, readInjection, type DiscordInstall,
} from "../services/discord";
import { cloneRepo, discardChanges, fetchAndReset, inspectRepo, resetTo, type ServiceCtx } from "../services/git";
import {
    backupDist, buildVencord, inject, installPackages, isBuilt, readVencordPackage, restoreDist, uninject,
} from "../services/vencord";

export type OperationKind = "install" | "update" | "uninstall" | "repair";
export type StepId =
    | "requirements" | "discord" | "vencord" | "solradar" | "packages" | "build"
    | "inject" | "uninject" | "verify" | "launch" | "repair";
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StepInfo {
    id: StepId;
    label: string;
    status: StepStatus;
    detail?: string;
}

export type OperationEvent =
    | { type: "steps"; op: OperationKind; steps: StepInfo[] }
    | { type: "step"; id: StepId; status: StepStatus; detail?: string; cancellable: boolean }
    | { type: "output"; line: string };

export interface OperationDeps {
    runner: CommandRunner;
    env: ToolEnv;
    paths: AppPaths;
    localAppData: string;
    logger: Logger;
    signal: AbortSignal;
    emit(e: OperationEvent): void;
    branch?: string;
    closeDiscordFirst: boolean;
    launch?: (install: DiscordInstall) => void;
}

const LABELS: Record<StepId, string> = {
    requirements: "Checking requirements",
    discord: "Checking Discord",
    vencord: "Downloading Vencord",
    solradar: "Downloading SolRadar",
    packages: "Installing Vencord's packages",
    build: "Building Vencord with SolRadar",
    inject: "Patching Discord",
    uninject: "Removing Vencord from Discord",
    verify: "Verifying",
    launch: "Starting Discord",
    repair: "Repairing files",
};

const PLAN: Record<OperationKind, StepId[]> = {
    install: ["requirements", "discord", "vencord", "solradar", "packages", "build", "inject", "verify", "launch"],
    update: ["requirements", "discord", "vencord", "solradar", "packages", "build", "inject", "verify", "launch"],
    uninstall: ["discord", "uninject", "verify", "launch"],
    repair: ["repair"],
};

const NOT_CANCELLABLE = new Set<StepId>(["inject", "uninject"]);

export function commandError(kind: ErrorKind, message: string, r: CommandResult): HelperError {
    if (r.cancelled) return new HelperError("cancelled", "Cancelled.");
    const technical = `exit ${r.exitCode}${r.timedOut ? " (timed out)" : ""}\n${(r.stderr || r.stdout).slice(-4000)}`;
    return new HelperError(kind, message, technical);
}

function ensureOk(r: CommandResult, kind: ErrorKind, message: string): void {
    if (r.exitCode !== 0 || r.cancelled || r.timedOut) throw commandError(kind, message, r);
}

export async function runOperation(kind: OperationKind, deps: OperationDeps): Promise<void> {
    const { paths, signal, emit } = deps;
    const ctx: ServiceCtx = { runner: deps.runner, env: deps.env, signal, onLine: line => emit({ type: "output", line }) };
    const labels: Partial<Record<StepId, string>> = kind === "update" ? { vencord: "Updating Vencord", solradar: "Updating SolRadar" } : {};
    emit({ type: "steps", op: kind, steps: PLAN[kind].map(id => ({ id, label: labels[id] ?? LABELS[id], status: "pending" })) });

    let skipped = false;
    const step = async <T>(id: StepId, fn: () => Promise<T>): Promise<T> => {
        const cancellable = !NOT_CANCELLABLE.has(id);
        if (signal.aborted) throw new HelperError("cancelled", "Cancelled.");
        emit({ type: "step", id, status: "running", cancellable });
        skipped = false;
        try {
            const result = await fn();
            if (!skipped) emit({ type: "step", id, status: "done", cancellable });
            return result;
        } catch (e) {
            const err = toHelperError(e);
            emit({ type: "step", id, status: "failed", detail: err.message, cancellable });
            throw err;
        }
    };
    const skip = (id: StepId, detail: string) => {
        skipped = true;
        emit({ type: "step", id, status: "skipped", detail, cancellable: !NOT_CANCELLABLE.has(id) });
    };

    if (kind === "repair") {
        await step("repair", async () => {
            for (const [dir, url, marker] of [[paths.checkout, VENCORD_REPO, "package.json"], [paths.plugin, SOLRADAR_REPO, "index.tsx"]] as const) {
                if ((await inspectRepo(ctx, dir, url, marker)).state === "modified") {
                    ensureOk(await discardChanges(ctx, dir), "unknown", "The files could not be repaired. Open the log for details.");
                }
            }
        });
        return;
    }

    if (kind !== "uninstall") {
        await step("requirements", async () => {
            const min = minNodeMajor(readVencordPackage(paths.checkout)?.engines?.node);
            const results = await Promise.all((["git", "node"] as const).map(id => checkDependency(id, deps.runner, deps.env, min)));
            const bad = results.filter(r => r.state !== "ok").map(r => DEPENDENCIES[r.id].name);
            if (bad.length) throw new HelperError("missing-dependency", `${bad.join(" and ")} ${bad.length > 1 ? "are" : "is"} missing or too old. Install ${bad.length > 1 ? "them" : "it"} from the main screen first.`);
        });
    }

    const { install, wasRunning, needsInject } = await step("discord", async () => {
        const install = pickInstall(findDiscordInstalls(deps.localAppData), deps.branch);
        if (!install) throw new HelperError("discord-not-found", "Discord was not found. Install Discord first, then try again.");
        const injection = readInjection(install, paths.checkout);
        const needsInject = kind === "uninstall" || injection !== "injected";
        const wasRunning = await isDiscordRunning(install, deps.runner, deps.env);
        if (wasRunning && needsInject) {
            if (!deps.closeDiscordFirst) throw new HelperError("discord-running", "Please close Discord before continuing.");
            if (!(await closeDiscord(install, deps.runner, deps.env))) throw new HelperError("discord-running", "Discord could not be closed. Close it manually and try again.");
        }
        return { install, wasRunning, needsInject };
    });

    if (kind === "uninstall") {
        await step("uninject", async () => {
            if (!readVencordPackage(paths.checkout)) {
                throw new HelperError("unknown", "The Helper's copy of Vencord is missing, so it can't remove Vencord. Click Install first and then Uninstall, or use the official Vencord Installer.");
            }
            ensureOk(await uninject({ ...ctx, signal: undefined }, paths, install.branch), "inject", "Discord could not be restored. Open the log for details.");
        });
        await step("verify", async () => {
            if (readInjection(install, paths.checkout) !== "not-injected") throw new HelperError("inject", "Discord still appears to be patched. Open the log for details.");
        });
        await step("launch", async () => (deps.launch ?? launchDiscord)(install));
        return;
    }

    const previous: { vencord?: string; plugin?: string } = {};
    const syncRepo = async (id: "vencord" | "solradar", dir: string, url: string, marker: string, name: string) => {
        await step(id, async () => {
            const st = await inspectRepo(ctx, dir, url, marker);
            if (st.state === "modified") {
                throw new HelperError("checkout-modified", `The Helper's copy of ${name} has unexpected changes. Use Repair on the main screen, then try again.`, st.detail);
            }
            if (st.state === "ready") {
                if (kind === "install") return skip(id, "Already downloaded");
                if (id === "vencord") previous.vencord = st.commit; else previous.plugin = st.commit;
                ensureOk(await fetchAndReset(ctx, dir), "network", `${name} could not be updated. Check your internet connection and try again.`);
                return;
            }
            ensureOk(await cloneRepo(ctx, url, dir), "network", `${name} could not be downloaded. Check your internet connection and try again.`);
        });
    };

    await syncRepo("vencord", paths.checkout, VENCORD_REPO, "package.json", "Vencord");
    mkdirSync(paths.userplugins, { recursive: true });
    await syncRepo("solradar", paths.plugin, SOLRADAR_REPO, "index.tsx", "SolRadar");

    await step("packages", async () => {
        ensureOk(await installPackages(ctx, paths), "network", "Vencord's packages could not be downloaded. Check your internet connection and try again.");
    });

    await step("build", async () => {
        const hadBackup = backupDist(paths);
        const r = await buildVencord(ctx, paths);
        if (r.exitCode === 0 && !r.cancelled && !r.timedOut && isBuilt(paths)) return;
        // Roll back so Discord keeps loading the last working build.
        const rollbackCtx = { ...ctx, signal: undefined };
        if (hadBackup) restoreDist(paths);
        if (previous.vencord) await resetTo(rollbackCtx, paths.checkout, previous.vencord);
        if (previous.plugin) await resetTo(rollbackCtx, paths.plugin, previous.plugin);
        throw commandError("build", hadBackup
            ? "Vencord could not be built. Your previous version was kept. Open the detailed log for more information."
            : "Vencord could not be built. Open the detailed log for more information.", r);
    });

    await step("inject", async () => {
        if (!needsInject) return skip("inject", "Discord is already patched");
        if (await isDiscordRunning(install, deps.runner, deps.env)) {
            if (!deps.closeDiscordFirst || !(await closeDiscord(install, deps.runner, deps.env))) {
                throw new HelperError("discord-running", "Please close Discord before continuing.");
            }
        }
        ensureOk(await inject({ ...ctx, signal: undefined }, paths, install.branch), "inject", "Vencord was built successfully, but Discord could not be patched.");
    });

    await step("verify", async () => {
        if (readInjection(install, paths.checkout) !== "injected") {
            throw new HelperError("inject", "Vencord was built successfully, but Discord could not be patched.");
        }
    });

    await step("launch", async () => {
        if (wasRunning && !needsInject) await closeDiscord(install, deps.runner, deps.env);
        (deps.launch ?? launchDiscord)(install);
    });
}
