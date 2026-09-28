import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
    compareAppDirs, findDiscordInstalls, parseProcessJson, pickInstall, processesOf, readInjection,
} from "../src/services/discord";
import { tempDir } from "./helpers";

function fakeDiscord(local: string, folder: string, versions: string[]) {
    for (const v of versions) mkdirSync(join(local, folder, `app-${v}`, "resources"), { recursive: true });
}

test("compareAppDirs compares numerically", () => {
    expect(["app-1.0.10", "app-1.0.9"].sort(compareAppDirs)).toEqual(["app-1.0.9", "app-1.0.10"]);
});

test("finds installs, picks the newest app dir, ignores folders without resources", () => {
    const local = tempDir();
    fakeDiscord(local, "Discord", ["1.0.9016", "1.0.9175"]);
    fakeDiscord(local, "DiscordCanary", ["1.0.500"]);
    mkdirSync(join(local, "DiscordPTB", "app-1.0.1"), { recursive: true }); // no resources
    const installs = findDiscordInstalls(local);
    expect(installs.map(i => i.branch)).toEqual(["stable", "canary"]);
    expect(installs[0]!.appDir).toBe(join(local, "Discord", "app-1.0.9175"));
    expect(installs[0]!.exe).toBe("Discord.exe");
});

test("pickInstall prefers remembered branch, then stable, then first", () => {
    const local = tempDir();
    fakeDiscord(local, "Discord", ["1.0.1"]);
    fakeDiscord(local, "DiscordPTB", ["1.0.1"]);
    const installs = findDiscordInstalls(local);
    expect(pickInstall(installs, "ptb")?.branch).toBe("ptb");
    expect(pickInstall(installs, "canary")?.branch).toBe("stable");
    expect(pickInstall(installs.slice(1))?.branch).toBe("ptb");
    expect(pickInstall([])).toBeUndefined();
});

test("readInjection distinguishes ours, someone else's and none (non-ASCII path)", () => {
    const local = tempDir();
    fakeDiscord(local, "Discord", ["1.0.1"]);
    const install = findDiscordInstalls(local)[0]!;
    const res = join(install.appDir, "resources");
    const checkout = "C:\\Users\\João Silva\\AppData\\Local\\SolRadarHelper\\Vencord";

    writeFileSync(join(res, "app.asar"), "original");
    expect(readInjection(install, checkout)).toBe("not-injected");

    writeFileSync(join(res, "_app.asar"), "original");
    writeFileSync(join(res, "app.asar"), `...require("C:\\\\Users\\\\João Silva\\\\AppData\\\\Local\\\\SolRadarHelper\\\\Vencord\\\\dist\\\\patcher.js")`, "utf8");
    expect(readInjection(install, checkout)).toBe("injected");

    writeFileSync(join(res, "app.asar"), `require("C:/Users/João Silva/AppData/Roaming/Vencord/dist/patcher.js")`, "utf8");
    expect(readInjection(install, checkout)).toBe("injected-elsewhere");
});

test("parseProcessJson handles object, array and empty output", () => {
    expect(parseProcessJson("")).toEqual([]);
    expect(parseProcessJson(`{"ProcessId":1,"ExecutablePath":"C:\\\\x\\\\Discord.exe"}`)).toEqual([{ pid: 1, path: "C:\\x\\Discord.exe" }]);
    expect(parseProcessJson(`[{"ProcessId":1,"ExecutablePath":"a"},{"ProcessId":2,"ExecutablePath":null}]`)).toEqual([{ pid: 1, path: "a" }]);
});

test("processesOf only matches processes inside the install root", () => {
    const install = { branch: "stable" as const, label: "Discord", root: "C:\\L\\Discord", appDir: "C:\\L\\Discord\\app-1", exe: "Discord.exe" };
    const procs = [
        { pid: 1, path: "C:\\L\\Discord\\app-1\\Discord.exe" },
        { pid: 2, path: "C:\\L\\DiscordPTB\\app-1\\DiscordPTB.exe" },
        { pid: 3, path: "c:\\l\\discord\\Update.exe" },
    ];
    expect(processesOf(install, procs).map(p => p.pid)).toEqual([1, 3]);
});
