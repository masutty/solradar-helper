import { join } from "node:path";
import { system32, type CommandRunner } from "./commands";

export type ToolEnv = Record<string, string>;

export function parseRegValue(output: string, name: string): string | undefined {
    const re = new RegExp(`^\\s+${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, "im");
    return output.match(re)?.[1]?.trim();
}

export function expandEnvVars(value: string, env: Record<string, string | undefined>): string {
    return value.replace(/%([^%]+)%/g, (whole, name: string) => {
        const key = Object.keys(env).find(k => k.toLowerCase() === name.toLowerCase());
        return key && env[key] !== undefined ? env[key]! : whole;
    });
}

export function mergePath(parts: (string | undefined)[]): string {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const part of parts) {
        for (const entry of (part ?? "").split(";")) {
            const t = entry.trim();
            if (t && !seen.has(t.toLowerCase())) {
                seen.add(t.toLowerCase());
                out.push(t);
            }
        }
    }
    return out.join(";");
}

function knownToolDirs(env: Record<string, string | undefined>): string[] {
    const pf = env.ProgramFiles ?? "C:\\Program Files";
    const local = env.LOCALAPPDATA ?? "";
    return [
        join(pf, "Git", "cmd"),
        join(pf, "nodejs"),
        local && join(local, "Microsoft", "WindowsApps"),
        local && join(local, "Microsoft", "WinGet", "Links"),
    ].filter(Boolean);
}

// A running process never sees PATH changes made by installers, so rebuild PATH
// for child processes from the registry (machine, then user), then the inherited
// PATH, then well-known install locations.
export async function buildToolEnv(
    runner: CommandRunner,
    base: Record<string, string | undefined> = process.env,
): Promise<ToolEnv> {
    const reg = system32("reg.exe", base);
    const query = async (key: string) => {
        const r = await runner.run({ cmd: reg, args: ["query", key, "/v", "Path"], timeoutMs: 10_000 });
        const raw = r.exitCode === 0 ? parseRegValue(r.stdout, "Path") : undefined;
        return raw && expandEnvVars(raw, base);
    };
    const machine = await query("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment");
    const user = await query("HKCU\\Environment");

    const env: ToolEnv = {};
    for (const [k, v] of Object.entries(base)) if (v !== undefined && k.toLowerCase() !== "path") env[k] = v;
    const inherited = Object.entries(base).find(([k]) => k.toLowerCase() === "path")?.[1];
    env.PATH = mergePath([machine, user, inherited, ...knownToolDirs(base)]);
    return env;
}
