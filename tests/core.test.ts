import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appPaths } from "../src/core/paths";
import { loadState, saveState } from "../src/core/state";
import { createLogger, timestamp } from "../src/core/logger";
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

test("toHelperError keeps HelperErrors and wraps anything else", () => {
    const e = new HelperError("build", "Build failed", "stderr tail");
    expect(toHelperError(e)).toBe(e);
    const wrapped = toHelperError(new Error("boom"));
    expect(wrapped.kind).toBe("unknown");
    expect(wrapped.technical).toContain("boom");
});
