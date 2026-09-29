import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CommandResult, CommandRunner } from "../core/commands";
import type { ToolEnv } from "../core/env";

export interface ServiceCtx {
    runner: CommandRunner;
    env: ToolEnv;
    signal?: AbortSignal;
    onLine?: (line: string) => void;
}

export type RepoState = "absent" | "invalid" | "modified" | "ready" | "unknown";

export interface RepoStatus {
    state: RepoState;
    commit?: string;
    detail?: string;
}

const TEN_MINUTES = 10 * 60_000;

export function git(ctx: ServiceCtx, cwd: string, args: string[], timeoutMs = TEN_MINUTES): Promise<CommandResult> {
    return ctx.runner.run(
        { cmd: "git", args, cwd, env: { ...ctx.env, GIT_TERMINAL_PROMPT: "0" }, timeoutMs },
        { signal: ctx.signal, onLine: ctx.onLine },
    );
}

export function normalizeRemote(url: string): string {
    return url.trim().toLowerCase().replaceAll("\\", "/").replace(/\/+$/, "").replace(/\.git$/, "");
}

export async function inspectRepo(ctx: ServiceCtx, dir: string, expectedRemote: string, markerFile: string): Promise<RepoStatus> {
    if (!existsSync(dir)) return { state: "absent" };
    // Without its own .git, git would walk up and answer for a parent repo.
    if (!existsSync(join(dir, ".git"))) return { state: "invalid", detail: ".git missing" };
    if (!existsSync(join(dir, markerFile))) return { state: "invalid", detail: `${markerFile} missing` };

    const head = await git(ctx, dir, ["rev-parse", "HEAD"], 30_000);
    if (head.notFound) return { state: "unknown", detail: "git not available" };
    if (head.exitCode !== 0) return { state: "invalid", detail: head.stderr.trim() };

    const remote = await git(ctx, dir, ["remote", "get-url", "origin"], 30_000);
    if (remote.exitCode !== 0 || normalizeRemote(remote.stdout) !== normalizeRemote(expectedRemote)) {
        return { state: "invalid", detail: `unexpected remote: ${remote.stdout.trim() || remote.stderr.trim()}` };
    }

    const status = await git(ctx, dir, ["status", "--porcelain"], 60_000);
    if (status.exitCode !== 0) return { state: "invalid", detail: status.stderr.trim() };
    const commit = head.stdout.trim();
    return status.stdout.trim()
        ? { state: "modified", commit, detail: status.stdout.trim().slice(0, 500) }
        : { state: "ready", commit };
}

// Clone next to the target and rename on success, so an interrupted download
// never leaves a half-valid repo at the real location.
export async function cloneRepo(ctx: ServiceCtx, url: string, dir: string): Promise<CommandResult> {
    const partial = `${dir}.partial`;
    rmSync(partial, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    const r = await git(ctx, dirname(dir), ["clone", "--branch", "main", "--single-branch", url, basename(partial)]);
    if (r.exitCode !== 0 || r.cancelled || r.timedOut) {
        rmSync(partial, { recursive: true, force: true });
        return r;
    }
    rmSync(dir, { recursive: true, force: true });
    renameSync(partial, dir);
    return r;
}

// Works for fast-forwards and for rewritten (force-pushed) history alike.
export async function fetchAndReset(ctx: ServiceCtx, dir: string): Promise<CommandResult> {
    const fetched = await git(ctx, dir, ["fetch", "--prune", "origin", "main"]);
    if (fetched.exitCode !== 0 || fetched.cancelled || fetched.timedOut) return fetched;
    return git(ctx, dir, ["reset", "--hard", "FETCH_HEAD"], 60_000);
}

export function resetTo(ctx: ServiceCtx, dir: string, commit: string): Promise<CommandResult> {
    return git(ctx, dir, ["reset", "--hard", commit], 60_000);
}

// Ignored paths (node_modules, dist, src/userplugins) are untouched by `clean -fd`.
export async function discardChanges(ctx: ServiceCtx, dir: string): Promise<CommandResult> {
    const reset = await git(ctx, dir, ["reset", "--hard", "HEAD"], 60_000);
    if (reset.exitCode !== 0) return reset;
    return git(ctx, dir, ["clean", "-fd"], 60_000);
}

export async function remoteHead(ctx: ServiceCtx, url: string): Promise<string | undefined> {
    const r = await git(ctx, process.cwd(), ["ls-remote", url, "refs/heads/main"], 20_000);
    if (r.exitCode !== 0) return undefined;
    return r.stdout.trim().split(/\s+/)[0] || undefined;
}
