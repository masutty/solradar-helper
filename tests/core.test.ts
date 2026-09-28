import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appPaths } from "../src/core/paths";
import { loadState, saveState } from "../src/core/state";
import { createLogger, timestamp, type LogEntry } from "../src/core/logger";
import { HelperError, toHelperError } from "../src/core/errors";
import { tempDir } from "./helpers";

test("appPaths derives every location from LOCALAPPDATA", () => {
    const p = appPaths("C:\\Users\\A B\\AppData\\Local");
    expect(p.root).toBe("C:\\Users\\A B\\AppData\\Local\\SolRadarHelper");
    expect(p.checkout).toBe(join(p.root, "Vencord"));
    expect(p.plugin).toBe(join(p.checkout, "src", "userplugins", "solradar"));
    expect(p.logs).toBe(join(p.root, "logs"));
});

test("state round-trips and tolerates a corrupt file", () => {
    const file = join(tempDir(), "sub", "state.json");
    expect(loadState(file)).toEqual({});
    saveState(file, { branch: "ptb" });
    expect(loadState(file)).toEqual({ branch: "ptb" });
    writeFileSync(file, "{not json");
    expect(loadState(file)).toEqual({});
});

test("timestamp is YYYYMMDD-HHMMSS in UTC", () => {
    expect(timestamp(new Date("2026-09-28T20:15:07.123Z"))).toBe("20260928-201507");
});

test("logger writes lines and keeps only the newest logs", () => {
    const dir = tempDir();
    for (let i = 0; i < 12; i++) writeFileSync(join(dir, `helper-202601${String(i + 10)}-000000.log`), "old");
    const log = createLogger(dir, new Date("2026-09-28T20:15:07Z"), 10);
    log.info("hello", { a: 1 });
    const text = readFileSync(log.file, "utf8");
    expect(text).toContain("[INFO] hello {\"a\":1}");
    expect(readdirSync(dir).filter(f => f.endsWith(".log")).length).toBe(10);
    expect(existsSync(join(dir, "helper-20260110-000000.log"))).toBe(false);
});

test("createLogger emits structured entries and keeps the file complete", () => {
    const dir = tempDir();
    const entries: LogEntry[] = [];
    const log = createLogger(dir, new Date("2026-09-28T20:15:07Z"), 10, e => entries.push(e));
    log.info("hello", { a: 1 });
    log.error("bad", "line1\nline2");
    log.log({ level: "debug", kind: "cmd", text: "git status" });
    log.log({ level: "debug", kind: "out", text: "clean" });
    log.step("▶ Building");
    log.background = true;
    log.debug("quiet");
    log.log({ level: "info", kind: "msg", text: "summary", background: false });
    expect(entries.map(e => [e.level, e.kind])).toEqual([
        ["info", "msg"], ["error", "msg"], ["debug", "cmd"], ["debug", "out"], ["info", "step"], ["debug", "msg"], ["info", "msg"],
    ]);
    expect(entries[0]!.text).toBe("hello");
    expect(entries[1]!.text).toBe("bad\nline1\nline2");
    expect(entries[0]!.ts).toMatch(/^\d\d:\d\d:\d\d$/);
    expect(entries.map(e => e.background)).toEqual([false, false, false, false, false, true, false]);
    const file = readFileSync(log.file, "utf8");
    expect(file).toContain("[INFO] hello {\"a\":1}");
    expect(file).toContain("[ERROR] bad line1\nline2");
    expect(file).toContain("[DEBUG] exec git status");
    expect(file).toContain("[DEBUG]   | clean");
});

test("toHelperError keeps HelperErrors and wraps anything else", () => {
    const e = new HelperError("build", "Build failed", "stderr tail");
    expect(toHelperError(e)).toBe(e);
    const wrapped = toHelperError(new Error("boom"));
    expect(wrapped.kind).toBe("unknown");
    expect(wrapped.technical).toContain("boom");
});
