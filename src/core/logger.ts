import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LOG_RETENTION } from "./constants";

export interface Logger {
    readonly file: string;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
}

export function timestamp(d: Date): string {
    return d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

const LOG_NAME = /^helper-\d{8}-\d{6}\.log$/;

export function pruneLogs(dir: string, keep: number): void {
    const logs = readdirSync(dir).filter(f => LOG_NAME.test(f)).sort();
    for (const f of logs.slice(0, Math.max(0, logs.length - keep))) rmSync(join(dir, f), { force: true });
}

export function createLogger(dir: string, now: Date = new Date(), keep = LOG_RETENTION, onLine?: (line: string) => void): Logger {
    mkdirSync(dir, { recursive: true });
    pruneLogs(dir, keep - 1);
    const file = join(dir, `helper-${timestamp(now)}.log`);
    const write = (level: string, message: string, data?: unknown) => {
        const extra = data === undefined ? "" : " " + (typeof data === "string" ? data : JSON.stringify(data));
        const line = `${new Date().toISOString()} [${level}] ${message}${extra}`;
        appendFileSync(file, line + "\n");
        try { onLine?.(line); } catch { /* a broken listener must not break logging */ }
    };
    return {
        file,
        info: (m, d) => write("INFO", m, d),
        warn: (m, d) => write("WARN", m, d),
        error: (m, d) => write("ERROR", m, d),
    };
}
