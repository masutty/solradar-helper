import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CommandResult } from "../core/commands";
import { HelperError } from "../core/errors";
import type { AppPaths } from "../core/paths";
import type { DiscordBranch } from "./discord";
import type { ServiceCtx } from "./git";

export interface VencordPackage {
    packageManager?: string;
    engines?: { node?: string };
}

export function readVencordPackage(checkout: string): VencordPackage | undefined {
    try {
        return JSON.parse(readFileSync(join(checkout, "package.json"), "utf8"));
    } catch {
        return undefined;
    }
}

export function pnpmSpec(pkg: VencordPackage | undefined): string {
    const m = pkg?.packageManager?.match(/^pnpm@([^+]+)/);
    return m ? `pnpm@${m[1]}` : "pnpm@latest";
}

// Run npx through node.exe directly: spawning .cmd shims without a shell is not possible.
export async function resolveNpxCli(ctx: ServiceCtx): Promise<{ node: string; npxCli: string }> {
    const r = await ctx.runner.run({ cmd: "node", args: ["-p", "process.execPath"], env: ctx.env, timeoutMs: 15_000 });
    const node = r.stdout.trim();
    const npxCli = join(dirname(node), "node_modules", "npm", "bin", "npx-cli.js");
    if (r.exitCode !== 0 || !node || !existsSync(npxCli)) {
        throw new HelperError("missing-dependency", "Node.js is installed but incomplete (npm is missing). Reinstall Node.js.", r.stderr || `npx-cli not found at ${npxCli}`);
    }
    return { node, npxCli };
}

export async function pnpm(ctx: ServiceCtx, checkout: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    const { node, npxCli } = await resolveNpxCli(ctx);
    const spec = pnpmSpec(readVencordPackage(checkout));
    return ctx.runner.run(
        { cmd: node, args: [npxCli, "--yes", spec, ...args], cwd: checkout, env: { ...ctx.env, CI: "true" }, timeoutMs },
        { signal: ctx.signal, onLine: ctx.onLine },
    );
}

const MINUTES = 60_000;

export function installPackages(ctx: ServiceCtx, paths: AppPaths) {
    return pnpm(ctx, paths.checkout, ["install", "--frozen-lockfile"], 15 * MINUTES);
}

export function buildVencord(ctx: ServiceCtx, paths: AppPaths) {
    return pnpm(ctx, paths.checkout, ["build"], 10 * MINUTES);
}

export function inject(ctx: ServiceCtx, paths: AppPaths, branch: DiscordBranch) {
    return pnpm(ctx, paths.checkout, ["inject", "--branch", branch], 5 * MINUTES);
}

export function uninject(ctx: ServiceCtx, paths: AppPaths, branch: DiscordBranch) {
    return pnpm(ctx, paths.checkout, ["uninject", "--branch", branch], 5 * MINUTES);
}

const distOf = (paths: AppPaths) => join(paths.checkout, "dist");

export function isBuilt(paths: AppPaths): boolean {
    return existsSync(join(distOf(paths), "patcher.js"));
}

// Discord loads Vencord straight from dist/, so a failed build must never leave it broken.
export function backupDist(paths: AppPaths): boolean {
    if (!isBuilt(paths)) return false;
    rmSync(paths.distBackup, { recursive: true, force: true });
    cpSync(distOf(paths), paths.distBackup, { recursive: true });
    return true;
}

export function restoreDist(paths: AppPaths): void {
    rmSync(distOf(paths), { recursive: true, force: true });
    cpSync(paths.distBackup, distOf(paths), { recursive: true });
}
