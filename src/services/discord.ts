import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { system32, type CommandRunner } from "../core/commands";
import type { ToolEnv } from "../core/env";
import { HelperError } from "../core/errors";

export type DiscordBranch = "stable" | "ptb" | "canary";

// Same locations and precedence Vencord's installer uses (development branch is not supported by its CLI).
export const BRANCHES = [
    { branch: "stable", folder: "Discord", exe: "Discord.exe", label: "Discord" },
    { branch: "ptb", folder: "DiscordPTB", exe: "DiscordPTB.exe", label: "Discord PTB" },
    { branch: "canary", folder: "DiscordCanary", exe: "DiscordCanary.exe", label: "Discord Canary" },
] as const satisfies readonly { branch: DiscordBranch; folder: string; exe: string; label: string }[];

export interface DiscordInstall {
    branch: DiscordBranch;
    label: string;
    root: string;
    appDir: string;
    exe: string;
}

export function compareAppDirs(a: string, b: string): number {
    const nums = (s: string) => s.replace(/^app-/, "").split(".").map(Number);
    const x = nums(a), y = nums(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d) return d;
    }
    return 0;
}

export function findDiscordInstalls(localAppData: string): DiscordInstall[] {
    const out: DiscordInstall[] = [];
    for (const b of BRANCHES) {
        const root = join(localAppData, b.folder);
        let entries: string[];
        try { entries = readdirSync(root); } catch { continue; }
        const apps = entries
            .filter(e => /^app-\d+(\.\d+)*$/.test(e) && existsSync(join(root, e, "resources")))
            .sort(compareAppDirs);
        const latest = apps.at(-1);
        if (latest) out.push({ branch: b.branch, label: b.label, root, appDir: join(root, latest), exe: b.exe });
    }
    return out;
}

export function pickInstall(installs: DiscordInstall[], preferred?: string): DiscordInstall | undefined {
    return installs.find(i => i.branch === preferred) ?? installs.find(i => i.branch === "stable") ?? installs[0];
}

export type InjectionState = "not-injected" | "injected" | "injected-elsewhere" | "unknown";

export function pathMentioned(haystack: string, dir: string): boolean {
    const h = haystack.toLowerCase();
    const d = dir.toLowerCase().replace(/[\\/]+$/, "");
    return [d.replaceAll("\\", "\\\\"), d, d.replaceAll("\\", "/")].some(v => h.includes(v));
}

// Vencord's installer renames resources/app.asar to _app.asar and writes a stub
// app.asar that requires <VENCORD_USER_DATA_DIR>/dist/patcher.js.
export function readInjection(install: DiscordInstall, checkoutDir: string): InjectionState {
    const res = join(install.appDir, "resources");
    if (!existsSync(join(res, "_app.asar"))) return "not-injected";
    try {
        const stub = join(res, "app.asar");
        const file = statSync(stub).isDirectory() ? join(stub, "index.js") : stub;
        return pathMentioned(readFileSync(file, "utf8"), checkoutDir) ? "injected" : "injected-elsewhere";
    } catch {
        return "unknown";
    }
}

export interface DiscordProcess {
    pid: number;
    path: string;
}

const LIST_SCRIPT =
    "[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " +
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'Discord*' } | " +
    "Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress";

export function parseProcessJson(stdout: string): DiscordProcess[] {
    const text = stdout.trim();
    if (!text) return [];
    const data = JSON.parse(text);
    const list: any[] = Array.isArray(data) ? data : [data];
    return list
        .filter(p => typeof p?.ProcessId === "number" && typeof p?.ExecutablePath === "string")
        .map(p => ({ pid: p.ProcessId, path: p.ExecutablePath }));
}

export function processesOf(install: DiscordInstall, procs: DiscordProcess[]): DiscordProcess[] {
    const prefix = install.root.toLowerCase() + "\\";
    return procs.filter(p => p.path.toLowerCase().startsWith(prefix));
}

export async function listDiscordProcesses(runner: CommandRunner, env: ToolEnv): Promise<DiscordProcess[]> {
    const ps = system32("WindowsPowerShell\\v1.0\\powershell.exe", env);
    const r = await runner.run({ cmd: ps, args: ["-NoProfile", "-NonInteractive", "-Command", LIST_SCRIPT], env, timeoutMs: 30_000 });
    if (r.exitCode !== 0) throw new HelperError("unknown", "Could not check whether Discord is running.", r.stderr);
    return parseProcessJson(r.stdout);
}

export async function isDiscordRunning(install: DiscordInstall, runner: CommandRunner, env: ToolEnv): Promise<boolean> {
    return processesOf(install, await listDiscordProcesses(runner, env)).length > 0;
}

// Only ever kills processes whose executable lives inside this install's folder.
export async function closeDiscord(install: DiscordInstall, runner: CommandRunner, env: ToolEnv, timeoutMs = 15_000): Promise<boolean> {
    const taskkill = system32("taskkill.exe", env);
    for (const p of processesOf(install, await listDiscordProcesses(runner, env))) {
        await runner.run({ cmd: taskkill, args: ["/PID", String(p.pid), "/T", "/F"], env, timeoutMs: 10_000 });
    }
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!(await isDiscordRunning(install, runner, env))) return true;
        await Bun.sleep(500);
    }
    return false;
}

export function launchDiscord(install: DiscordInstall): void {
    const updater = join(install.root, "Update.exe");
    const cmd = existsSync(updater) ? [updater, "--processStart", install.exe] : [join(install.appDir, install.exe)];
    Bun.spawn(cmd, { cwd: install.root, stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
}
