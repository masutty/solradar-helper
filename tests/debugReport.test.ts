import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { appPaths } from "../src/core/paths";
import { createDebugReport, redact } from "../src/services/debugReport";
import { tempDir } from "./helpers";

const ctx = { userProfile: "C:\\Users\\João Silva", userName: "João Silva", computerName: "DESKTOP-ABC123" };

test("redacts profile paths in every escaping, names, emails and tokens", () => {
    const text = [
        "cwd C:\\Users\\João Silva\\AppData\\Local",
        "json \"C:\\\\Users\\\\João Silva\\\\AppData\"",
        "fwd c:/users/joão silva/x",
        "hello João Silva on DESKTOP-ABC123",
        "mail someone@example.com",
        "tok MTIzNDU2Nzg5MDEyMzQ1Njc4.GAbcde.abcdefghijklmnopqrstuvwxyz0123",
        "git version 2.55.0.5",
    ].join("\n");
    const out = redact(text, ctx);
    expect(out).not.toMatch(/João|joão|DESKTOP-ABC123|someone@|MTIzNDU2/);
    expect(out).toContain("%USERPROFILE%\\AppData\\Local");
    expect(out).toContain("<user>");
    expect(out).toContain("<computer>");
    expect(out).toContain("git version 2.55.0.5");
});

test("short user names are not blindly replaced", () => {
    expect(redact("Using bun", { userName: "bu" })).toBe("Using bun");
});

test("report bundles summary and logs, honours the redaction toggle", async () => {
    const p = appPaths(tempDir());
    mkdirSync(p.logs, { recursive: true });
    writeFileSync(join(p.logs, "helper-20260928-200000.log"), "path C:\\Users\\João Silva\\x");

    const redactedFile = await createDebugReport({ paths: p, redact: true, ctx, summary: { a: 1 }, now: new Date("2026-09-28T20:00:00Z") });
    expect(redactedFile).toBe(join(p.reports, "solradar-helper-report-20260928-200000.tar.gz"));
    const files = await new Bun.Archive(await Bun.file(redactedFile).bytes()).files();
    expect([...files.keys()].sort()).toEqual(["logs/helper-20260928-200000.log", "summary.json"]);
    expect(await files.get("logs/helper-20260928-200000.log")!.text()).not.toContain("João");
    expect(JSON.parse(await files.get("summary.json")!.text())).toMatchObject({ redacted: true, a: 1 });

    const raw = await createDebugReport({ paths: p, redact: false, ctx, summary: {}, now: new Date("2026-09-28T20:00:01Z") });
    const rawFiles = await new Bun.Archive(await Bun.file(raw).bytes()).files();
    expect(await rawFiles.get("logs/helper-20260928-200000.log")!.text()).toContain("João");
});
