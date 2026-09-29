import { runOperation, type OperationKind } from "../app/operations";
import { applySimulations, isSimulationId, SIMULATIONS, type SimulationId } from "../app/simulations";
import { takeSnapshot, type Snapshot } from "../app/snapshot";
import { deriveView } from "../app/view";
import { createCommandRunner } from "../core/commands";
import {
    DISCORD_DOWNLOAD_URL, HELPER_HELP_URL, HELPER_REPO_URL, HELPER_VERSION, VENCORD_INSTALLER_URL, WEBVIEW2_URL,
} from "../core/constants";
import { buildToolEnv, type ToolEnv } from "../core/env";
import { toHelperError } from "../core/errors";
import { createLogger, type LogEntry } from "../core/logger";
import { appPaths } from "../core/paths";
import { loadState, saveState } from "../core/state";
import { openFolder, openUrl, revealFile } from "../core/win32";
import { createDebugReport, redactionContextFromEnv } from "../services/debugReport";
import { checkDependency, DEPENDENCIES, installDependency, minNodeMajor, type DependencyId } from "../services/dependencies";
import { BRANCHES } from "../services/discord";
import { readVencordPackage } from "../services/vencord";
import { checkUpdates, type UpdateInfo } from "../services/updates";
import { SharedQueue } from "../shared/queue";
import type { BackendEvent, UiCommand, WorkerMessage, WorkerReply } from "../shared/protocol";

declare var self: Worker;

const localAppData = process.env.LOCALAPPDATA ?? "";
const paths = appPaths(localAppData);
// Log lines written before the queue exists are buffered, then flushed on init.
const pendingLogEntries: LogEntry[] = [];
const logger = createLogger(paths.logs, new Date(), undefined, entry => {
    if (queue) queue.push({ type: "log", entry } satisfies BackendEvent);
    else {
        pendingLogEntries.push(entry);
        if (pendingLogEntries.length > 500) pendingLogEntries.shift();
    }
});
const runner = createCommandRunner(logger);
const state = loadState(paths.state);

let queue: SharedQueue | undefined;
let env: ToolEnv = process.env as ToolEnv;
let snapshot: Snapshot | undefined;
let updates: UpdateInfo | null = null;
let current: AbortController | null = null;
const simulations = new Set<SimulationId>();
const installingDeps = new Set<DependencyId>();

const ALLOWED_URLS = new Set([
    ...Object.values(DEPENDENCIES).map(d => d.downloadUrl),
    VENCORD_INSTALLER_URL, DISCORD_DOWNLOAD_URL, HELPER_REPO_URL, HELPER_HELP_URL, WEBVIEW2_URL,
]);

const emit = (e: BackendEvent) => queue?.push(e);
const ctx = () => ({ runner, env });

function pushView() {
    if (!snapshot) return;
    const shown = applySimulations(snapshot, updates, simulations);
    emit({ type: "view", view: deriveView(shown.snapshot, shown.updates, [...simulations]), busy: current !== null });
}

// Lines produced by refresh (startup and "check again") are background noise in the activity panel.
let refreshDepth = 0;
const syncBackground = () => { logger.background = refreshDepth > 0 && current === null; };

function summarize(s: Snapshot): string {
    const deps = s.dependencies.map(d => {
        const name = DEPENDENCIES[d.id].name;
        return d.state === "ok" ? `${name} ${d.version ?? ""}`.trim() : `${name} ${d.state === "missing" ? "missing" : d.state === "outdated" ? "too old" : "not working"}`;
    });
    const discord = !s.discord.selected ? "Discord not found" : s.discord.running ? "Discord running" : "Discord not running";
    const solradar = s.solradar.state === "ready" ? `SolRadar installed${s.solradar.version ? ` ${s.solradar.version}` : ""}` : "SolRadar not installed";
    return `Checked: ${[...deps, discord, solradar].join(", ")}`;
}

async function refresh() {
    refreshDepth++;
    syncBackground();
    try {
        env = await buildToolEnv(runner);
        snapshot = await takeSnapshot(ctx(), paths, localAppData, state.branch);
        logger.log({ level: "info", kind: "msg", text: summarize(snapshot), background: false });
        pushView();
    } finally {
        refreshDepth--;
        syncBackground();
    }
}

// Update checks are background work too: their commands stay out of the default activity view.
async function refreshUpdates() {
    if (!snapshot) return;
    refreshDepth++;
    syncBackground();
    try {
        updates = await checkUpdates(ctx(), {
            vencordCommit: snapshot.vencord.commit,
            pluginCommit: snapshot.solradar.commit,
            pluginVersion: snapshot.solradar.version,
        });
        pushView();
    } finally {
        refreshDepth--;
        syncBackground();
    }
}

const short = (c?: string) => c?.slice(0, 7) ?? "unknown";

// Reads the real state (never the simulated one) and prints it as one clear block.
async function showVersions() {
    if (current) return;
    emit({ type: "show-activity" });
    await refresh();
    await refreshUpdates();
    const s = snapshot;
    if (!s) return;
    const dep = (id: string) => s.dependencies.find(d => d.id === id);
    const u = updates;
    const lines = [
        "Versions",
        `  Helper: ${HELPER_VERSION}${u?.helper.latest ? ` (latest ${u.helper.latest})` : " (latest unknown)"}`,
        `  Git: ${dep("git")?.version ?? "not found"}`,
        `  Node: ${dep("node")?.version ?? "not found"}`,
        `  Vencord: ${short(s.vencord.commit)} (latest ${short(u?.vencord.remote)})`,
        `  SolRadar: ${s.solradar.version ?? "unknown"} / ${short(s.solradar.commit)} (latest ${u?.solradar.remoteVersion ?? "unknown"} / ${short(u?.solradar.remoteCommit)})`,
        `  Discord: ${s.discord.selected?.label ?? "not found"}, ${s.discord.injection === "injected" ? "patched by SolRadar" : s.discord.injection === "injected-elsewhere" ? "using a different Vencord" : "not patched"}`,
    ];
    for (const text of lines) logger.log({ level: "info", kind: "msg", text, background: false });
}

function simulate(id: SimulationId, on: boolean) {
    if (on) simulations.add(id); else simulations.delete(id);
    const label = SIMULATIONS.find(x => x.id === id)!.label;
    logger.log({ level: "info", kind: "msg", text: `Simulation ${on ? "on" : "off"}: ${label}`, background: false });
    pushView();
}

let running: Promise<void> | null = null;

function run(op: OperationKind, closeDiscordFirst: boolean): Promise<void> {
    if (current) return Promise.resolve();
    const p = runInner(op, closeDiscordFirst);
    running = p;
    void p.finally(() => { if (running === p) running = null; });
    return p;
}

async function runInner(op: OperationKind, closeDiscordFirst: boolean) {
    current = new AbortController();
    syncBackground();
    pushView();
    const title = op[0]!.toUpperCase() + op.slice(1);
    logger.info(`${title} started`, { branch: state.branch, closeDiscordFirst });
    let ok = false;
    try {
        env = await buildToolEnv(runner);
        await runOperation(op, {
            runner, env, paths, localAppData, logger, signal: current.signal, emit,
            branch: snapshot?.discord.selected?.branch ?? state.branch, closeDiscordFirst,
        });
        ok = true;
        logger.info(`${title} finished successfully`);
        emit({ type: "operation-end", op, ok: true });
    } catch (e) {
        const err = toHelperError(e);
        if (err.kind === "cancelled") logger.warn(`${title} cancelled`);
        else logger.error(`${title} failed: ${err.message}`, err.technical === undefined ? { kind: err.kind } : `[${err.kind}]\n${err.technical}`);
        emit({ type: "operation-end", op, ok: false, error: { kind: err.kind, message: err.message } });
    } finally {
        state.lastOperation = { op, ok, at: new Date().toISOString() };
        saveState(paths.state, state);
        current = null;
        syncBackground();
        await refresh().catch(e => logger.error("refresh failed", String(e)));
        if (ok && (op === "install" || op === "update")) refreshUpdates().catch(() => {});
    }
}

async function installDep(id: DependencyId) {
    if (installingDeps.has(id) || current) return;
    installingDeps.add(id);
    emit({ type: "dependency-install", id, status: "running" });
    try {
        const r = await installDependency(id, runner, env);
        env = await buildToolEnv(runner);
        const status = await checkDependency(id, runner, env, minNodeMajor(readVencordPackage(paths.checkout)?.engines?.node));
        if (status.state === "ok") {
            emit({ type: "dependency-install", id, status: "done" });
        } else {
            logger.warn(`winget install of ${id} did not result in a working install`, { exitCode: r.exitCode, status });
            emit({ type: "dependency-install", id, status: "failed", message: "The automatic installation didn't finish. Try the manual steps instead." });
        }
    } catch (e) {
        const err = toHelperError(e);
        logger.error(`install of dependency ${id} failed: ${err.kind}: ${err.message}`, err.technical);
        emit({ type: "dependency-install", id, status: "failed", message: "The automatic installation didn't finish. Try the manual steps instead." });
    } finally {
        installingDeps.delete(id);
        await refresh();
    }
}

async function debugReport(redact: boolean) {
    const file = await createDebugReport({
        paths, redact, ctx: redactionContextFromEnv(),
        summary: { snapshot, updates, lastOperation: state.lastOperation },
    });
    logger.info("debug report created", file);
    emit({ type: "report-ready", path: file });
    revealFile(file);
}

// Safety net: the same UI error repeating within 10 s is only counted, not logged again.
const UI_ERROR_WINDOW_MS = 10_000;
const recentUiErrors = new Map<string, { at: number; suppressed: number }>();

function logUiError(message: string, stack?: string) {
    const now = Date.now();
    const seen = recentUiErrors.get(message);
    if (seen && now - seen.at < UI_ERROR_WINDOW_MS) { seen.suppressed++; return; }
    if (seen && seen.suppressed > 0) logger.warn(`ui error repeated ${seen.suppressed} more time(s): ${message}`);
    recentUiErrors.set(message, { at: now, suppressed: 0 });
    if (recentUiErrors.size > 50) recentUiErrors.delete(recentUiErrors.keys().next().value!);
    logger.error("ui error", { message, stack });
}

async function handle(command: UiCommand) {
    switch (command.type) {
        case "refresh":
            await refresh();
            refreshUpdates().catch(() => {});
            return;
        case "select-branch":
            if (current) return;
            if (BRANCHES.some(b => b.branch === command.branch)) {
                state.branch = command.branch;
                saveState(paths.state, state);
                await refresh();
            }
            return;
        case "run":
            return run(command.op, command.closeDiscord);
        case "cancel":
            current?.abort();
            return;
        case "install-dependency":
            return installDep(command.id);
        case "open-url":
            if (ALLOWED_URLS.has(command.url)) openUrl(command.url);
            else logger.warn("blocked url", command.url);
            return;
        case "open-logs":
            openFolder(paths.logs);
            return;
        case "open-root":
            openFolder(paths.root);
            return;
        case "show-versions":
            return showVersions();
        case "simulate":
            if (isSimulationId(command.id)) simulate(command.id, !!command.on);
            return;
        case "simulate-clear":
            simulations.clear();
            logger.log({ level: "info", kind: "msg", text: "Simulations cleared", background: false });
            pushView();
            return;
        case "simulate-error":
            logger.log({ level: "error", kind: "msg", text: "Simulated error: this is what an error looks like", background: false });
            return;
        case "debug-report":
            return debugReport(command.redact);
        case "ui-error":
            logUiError(command.message, command.stack);
            return;
    }
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data;
    if (msg.type === "init") {
        queue = new SharedQueue(msg.buffer);
        for (const entry of pendingLogEntries.splice(0)) queue.push({ type: "log", entry } satisfies BackendEvent);
        logger.info(`SolRadar Helper ${HELPER_VERSION} starting`, { paths });
        refresh()
            .then(() => refreshUpdates())
            .catch(e => {
                const err = toHelperError(e);
                logger.error("startup failed", err.technical);
                emit({ type: "fatal", message: err.message });
            });
        return;
    }
    if (msg.type === "shutdown") {
        // Let the running operation finish its rollback and Discord relaunch before the process exits.
        current?.abort();
        (running ?? Promise.resolve())
            .catch(() => {})
            .finally(() => self.postMessage({ type: "shutdown-done" } satisfies WorkerReply));
        return;
    }
    handle(msg.command).catch(e => {
        const err = toHelperError(e);
        logger.error(`command ${msg.command.type} failed`, err.technical);
        emit({ type: "fatal", message: err.message });
    });
};
