import { isAbsolute, join } from "node:path";
import type { Logger } from "./logger";

export interface CommandSpec {
    cmd: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
}

export interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    notFound: boolean;
    timedOut: boolean;
    cancelled: boolean;
}

export interface RunOptions {
    signal?: AbortSignal;
    onLine?: (line: string) => void;
}

export interface CommandRunner {
    run(spec: CommandSpec, options?: RunOptions): Promise<CommandResult>;
}

export function system32(file: string, env: Record<string, string | undefined> = process.env): string {
    return join(env.SystemRoot ?? "C:\\Windows", "System32", file);
}

function describe(spec: CommandSpec): string {
    const quote = (s: string) => (/[\s"]/.test(s) ? JSON.stringify(s) : s);
    return [spec.cmd, ...spec.args].map(quote).join(" ") + (spec.cwd ? `  (in ${spec.cwd})` : "");
}

function pathOf(env: Record<string, string | undefined>): string {
    return Object.entries(env).find(([k]) => k.toLowerCase() === "path")?.[1] ?? "";
}

// Kill the whole tree: pnpm/node spawn children that proc.kill() would orphan.
function killTree(pid: number) {
    Bun.spawnSync([system32("taskkill.exe"), "/PID", String(pid), "/T", "/F"], {
        stdin: "ignore", stdout: "ignore", stderr: "ignore", windowsHide: true,
    });
}

async function collect(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<string> {
    const decoder = new TextDecoder();
    let all = "";
    let pending = "";
    for await (const chunk of stream) {
        const text = decoder.decode(chunk, { stream: true });
        all += text;
        pending += text;
        const lines = pending.split(/\r?\n|\r/);
        pending = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) onLine(line);
    }
    const rest = decoder.decode();
    all += rest;
    pending += rest;
    if (pending.trim()) onLine(pending);
    return all;
}

const EMPTY: Omit<CommandResult, "exitCode"> = { stdout: "", stderr: "", notFound: false, timedOut: false, cancelled: false };

export function createCommandRunner(logger: Logger): CommandRunner {
    return {
        async run(spec, options = {}) {
            const env = spec.env ?? (process.env as Record<string, string>);
            logger.info("exec", describe(spec));
            const exe = isAbsolute(spec.cmd) ? spec.cmd : Bun.which(spec.cmd, { PATH: pathOf(env) });
            if (!exe) {
                logger.warn("command not found", spec.cmd);
                return { ...EMPTY, exitCode: -1, stderr: `${spec.cmd} was not found`, notFound: true };
            }
            if (options.signal?.aborted) return { ...EMPTY, exitCode: -1, cancelled: true };

            let proc;
            try {
                proc = Bun.spawn([exe, ...spec.args], {
                    cwd: spec.cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", windowsHide: true,
                });
            } catch (e) {
                logger.error("spawn failed", String(e));
                return { ...EMPTY, exitCode: -1, stderr: String(e), notFound: true };
            }

            let timedOut = false;
            let cancelled = false;
            const onAbort = () => { cancelled = true; killTree(proc.pid); };
            options.signal?.addEventListener("abort", onAbort, { once: true });
            const timer = spec.timeoutMs ? setTimeout(() => { timedOut = true; killTree(proc.pid); }, spec.timeoutMs) : undefined;

            const onLine = (line: string) => { logger.info(`  | ${line}`); options.onLine?.(line); };
            const [stdout, stderr] = await Promise.all([collect(proc.stdout, onLine), collect(proc.stderr, onLine)]);
            const exitCode = await proc.exited;

            clearTimeout(timer);
            options.signal?.removeEventListener("abort", onAbort);
            logger.info("exit", { exitCode, timedOut, cancelled });
            return { exitCode, stdout, stderr, notFound: false, timedOut, cancelled };
        },
    };
}
