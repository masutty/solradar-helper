import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { LOG_RETENTION } from "./constants";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogKind = "cmd" | "out" | "step" | "msg";

/** One structured line for the activity panel. The log file keeps its own text format. */
export interface LogEntry {
    ts: string; // HH:MM:SS, local time
    level: LogLevel;
    kind: LogKind;
    text: string;
    background: boolean;
}

export interface LogInput {
    level: LogLevel;
    kind: LogKind;
    text: string;
    data?: unknown;
    /** Overrides the logger's current `background` flag for this line. */
    background?: boolean;
    /** Appended to the log file line only, never shown in the activity panel. */
    fileSuffix?: string;
}

export interface Logger {
    readonly file: string;
    /** Lines logged while this is true are marked as background (startup and refresh checks). */
    background: boolean;
    log(input: LogInput): void;
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    /** Operation step transition: info level, kind "step". */
    step(text: string): void;
}

export function timestamp(d: Date): string {
    return d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

export function clockTime(d: Date): string {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const LOG_NAME = /^helper-\d{8}-\d{6}\.log$/;
const ENTRY_DETAIL_LINES = 6;

export function pruneLogs(dir: string, keep: number): void {
    const logs = readdirSync(dir).filter(f => LOG_NAME.test(f)).sort();
    for (const f of logs.slice(0, Math.max(0, logs.length - keep))) rmSync(join(dir, f), { force: true });
}

function extraText(data: unknown): string {
    return data === undefined ? "" : typeof data === "string" ? data : JSON.stringify(data);
}

export function createLogger(dir: string, now: Date = new Date(), keep = LOG_RETENTION, onLine?: (entry: LogEntry) => void): Logger {
    mkdirSync(dir, { recursive: true });
    pruneLogs(dir, keep - 1);
    const file = join(dir, `helper-${timestamp(now)}.log`);
    const logger: Logger = {
        file,
        background: false,
        log({ level, kind, text, data, background, fileSuffix }) {
            const extra = extraText(data);
            const filePrefix = kind === "cmd" ? "exec " : kind === "out" ? "  | " : "";
            const fileLine = `${new Date().toISOString()} [${level.toUpperCase()}] ${filePrefix}${text}${fileSuffix ?? ""}${extra ? " " + extra : ""}`;
            appendFileSync(file, fileLine + "\n");
            // The panel gets only the first lines of long technical detail; the file keeps everything.
            const shown = extra && (level === "error" || level === "warn") ? extra.split(/\r?\n/).filter(l => l.trim()).slice(0, ENTRY_DETAIL_LINES).join("\n") : "";
            const entry: LogEntry = {
                ts: clockTime(new Date()), level, kind,
                text: shown ? `${text}\n${shown}` : text,
                background: background ?? logger.background,
            };
            try { onLine?.(entry); } catch { /* a broken listener must not break logging */ }
        },
        debug: (m, d) => logger.log({ level: "debug", kind: "msg", text: m, data: d }),
        info: (m, d) => logger.log({ level: "info", kind: "msg", text: m, data: d }),
        warn: (m, d) => logger.log({ level: "warn", kind: "msg", text: m, data: d }),
        error: (m, d) => logger.log({ level: "error", kind: "msg", text: m, data: d }),
        step: text => logger.log({ level: "info", kind: "step", text }),
    };
    return logger;
}
