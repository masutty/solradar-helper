import { expect, test } from "bun:test";
import { buildToolEnv, expandEnvVars, mergePath, parseRegValue } from "../src/core/env";
import { fakeRunner } from "./helpers";

const REG_USER = `
HKEY_CURRENT_USER\\Environment
    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Tools
`;
const REG_MACHINE = `
HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment
    Path    REG_EXPAND_SZ    C:\\Windows\\system32;C:\\Program Files\\Git\\cmd
`;

test("parseRegValue reads REG_SZ and REG_EXPAND_SZ values", () => {
    expect(parseRegValue(REG_USER, "Path")).toBe("%USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Tools");
    expect(parseRegValue("    pv    REG_SZ    120.0.1\n", "pv")).toBe("120.0.1");
    expect(parseRegValue("ERROR: not found", "Path")).toBeUndefined();
});

test("expandEnvVars is case-insensitive and leaves unknown vars", () => {
    expect(expandEnvVars("%userprofile%\\a;%NOPE%", { USERPROFILE: "C:\\Users\\João" })).toBe("C:\\Users\\João\\a;%NOPE%");
});

test("mergePath dedupes case-insensitively and keeps order", () => {
    expect(mergePath(["C:\\A;c:\\a;C:\\B", undefined, "C:\\B;C:\\C"])).toBe("C:\\A;C:\\B;C:\\C");
});

test("buildToolEnv picks up tools installed after the Helper started", async () => {
    const { runner } = fakeRunner(spec =>
        spec.args[1]?.startsWith("HKLM") ? { stdout: REG_MACHINE } : { stdout: REG_USER });
    const env = await buildToolEnv(runner, { Path: "C:\\Stale", USERPROFILE: "C:\\Users\\João", SystemRoot: "C:\\Windows", ProgramFiles: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\João\\AppData\\Local" });
    const parts = env.PATH!.split(";");
    expect(parts[0]).toBe("C:\\Windows\\system32");
    expect(parts).toContain("C:\\Program Files\\Git\\cmd");
    expect(parts).toContain("C:\\Users\\João\\AppData\\Local\\Microsoft\\WindowsApps");
    expect(parts).toContain("C:\\Stale");
    expect(parts).toContain("C:\\Program Files\\nodejs");
    expect(Object.keys(env).filter(k => k.toLowerCase() === "path")).toEqual(["PATH"]);
});
