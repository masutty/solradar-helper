import type { CommandResult, CommandRunner } from "../core/commands";
import { DEFAULT_NODE_MIN_MAJOR } from "../core/constants";
import type { ToolEnv } from "../core/env";

export type DependencyId = "git" | "node";
export type DependencyState = "ok" | "missing" | "outdated" | "error";

export interface DependencyStatus {
    id: DependencyId;
    state: DependencyState;
    version?: string;
    detail?: string;
}

export interface DependencyInfo {
    id: DependencyId;
    name: string;
    why: string;
    downloadUrl: string;
    manualSteps: string[];
    wingetId: string;
}

export const DEPENDENCIES: Record<DependencyId, DependencyInfo> = {
    git: {
        id: "git",
        name: "Git",
        why: "Downloads Vencord and SolRadar and keeps them up to date.",
        downloadUrl: "https://git-scm.com/downloads/win",
        manualSteps: [
            "Open the download page and download Git for Windows (64-bit installer).",
            "Run the installer and keep every default option.",
            "Come back here and click Check again.",
        ],
        wingetId: "Git.Git",
    },
    node: {
        id: "node",
        name: "Node.js",
        why: "Builds Vencord together with SolRadar.",
        downloadUrl: "https://nodejs.org/en/download",
        manualSteps: [
            "Open the download page and download the Windows Installer (.msi) for the LTS version.",
            "Run the installer and keep every default option.",
            "Come back here and click Check again.",
        ],
        wingetId: "OpenJS.NodeJS.LTS",
    },
};

export function parseVersion(output: string): string | undefined {
    return output.match(/\d+\.\d+\.\d+/)?.[0];
}

export function minNodeMajor(enginesNode: string | undefined): number {
    const m = enginesNode?.match(/^\s*>=\s*(\d+)/);
    return m ? Number(m[1]) : DEFAULT_NODE_MIN_MAJOR;
}

export async function checkDependency(
    id: DependencyId, runner: CommandRunner, env: ToolEnv, nodeMinMajor: number,
): Promise<DependencyStatus> {
    const r = await runner.run({ cmd: id, args: ["--version"], env, timeoutMs: 15_000 });
    if (r.notFound) return { id, state: "missing" };
    if (r.exitCode !== 0) return { id, state: "error", detail: (r.stderr || r.stdout).trim().slice(0, 300) };
    const version = parseVersion(r.stdout);
    if (!version) return { id, state: "error", detail: `Unexpected output: ${r.stdout.trim().slice(0, 100)}` };
    if (id === "node" && Number(version.split(".")[0]) < nodeMinMajor) {
        return { id, state: "outdated", version, detail: `Version ${nodeMinMajor} or newer is required.` };
    }
    return { id, state: "ok", version };
}

export async function isWingetAvailable(runner: CommandRunner, env: ToolEnv): Promise<boolean> {
    const r = await runner.run({ cmd: "winget", args: ["--version"], env, timeoutMs: 15_000 });
    return !r.notFound && r.exitCode === 0;
}

export function wingetInstallArgs(id: DependencyId): string[] {
    return [
        "install", "--exact", "--id", DEPENDENCIES[id].wingetId,
        "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity",
    ];
}

// The exit code is informational only: callers must re-check the dependency.
export function installDependency(
    id: DependencyId, runner: CommandRunner, env: ToolEnv, signal?: AbortSignal,
): Promise<CommandResult> {
    return runner.run({ cmd: "winget", args: wingetInstallArgs(id), env, timeoutMs: 15 * 60_000 }, { signal });
}
