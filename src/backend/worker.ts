import { runOperation, type OperationKind } from "../app/operations";
import { takeSnapshot, type Snapshot } from "../app/snapshot";
import { deriveView } from "../app/view";
import { createCommandRunner } from "../core/commands";
import {
    DISCORD_DOWNLOAD_URL, HELPER_HELP_URL, HELPER_RELEASES_URL, HELPER_VERSION, VENCORD_INSTALLER_URL, WEBVIEW2_URL,
} from "../core/constants";
import { buildToolEnv, type ToolEnv } from "../core/env";
import { toHelperError } from "../core/errors";
import { createLogger } from "../core/logger";
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
const logger = createLogger(paths.logs);
const runner = createCommandRunner(logger);
const state = loadState(paths.state);

let queue: SharedQueue | undefined;
let env: ToolEnv = process.env as ToolEnv;
let snapshot: Snapshot | undefined;
let updates: UpdateInfo | null = null;
let current: AbortController | null = null;
const installingDeps = new Set<DependencyId>();

const ALLOWED_URLS = new Set([
    ...Object.values(DEPENDENCIES).map(d => d.downloadUrl),
    VENCORD_INSTALLER_URL, DISCORD_DOWNLOAD_URL, HELPER_RELEASES_URL, HELPER_HELP_URL, WEBVIEW2_URL,
]);

const emit = (e: BackendEvent) => queue?.push(e);
const ctx = () => ({ runner, env });

function pushView() {
    if (snapshot) emit({ type: "view", view: deriveView(snapshot, updates), busy: current !== null });
}

async function refresh() {
    env = await buildToolEnv(runner);
    snapshot = await takeSnapshot(ctx(), paths, localAppData, state.branch);
    pushView();
}

async function refreshUpdates() {
    if (!snapshot) return;
    updates = await checkUpdates(ctx(), {
        vencordCommit: snapshot.vencord.commit,
        pluginCommit: snapshot.solradar.commit,
        pluginVersion: snapshot.solradar.version,
    });
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
    pushView();
    logger.info(`operation ${op} started`, { branch: state.branch, closeDiscordFirst });
    let ok = false;
    try {
        env = await buildToolEnv(runner);
        await runOperation(op, {
            runner, env, paths, localAppData, logger, signal: current.signal, emit,
            branch: snapshot?.discord.selected?.branch ?? state.branch, closeDiscordFirst,
        });
        ok = true;
        emit({ type: "operation-end", op, ok: true });
    } catch (e) {
        const err = toHelperError(e);
        logger.error(`operation ${op} failed: ${err.kind}: ${err.message}`, err.technical);
        emit({ type: "operation-end", op, ok: false, error: { kind: err.kind, message: err.message } });
    } finally {
        state.lastOperation = { op, ok, at: new Date().toISOString() };
        saveState(paths.state, state);
        current = null;
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
        case "debug-report":
            return debugReport(command.redact);
    }
}

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data;
    if (msg.type === "init") {
        queue = new SharedQueue(msg.buffer);
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
