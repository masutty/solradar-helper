import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { hostname, userInfo, version as osVersion, release } from "node:os";
import { join } from "node:path";
import { HELPER_VERSION, LOG_RETENTION } from "../core/constants";
import { timestamp } from "../core/logger";
import type { AppPaths } from "../core/paths";

export interface RedactionContext {
    userProfile?: string;
    userName?: string;
    computerName?: string;
}

export function redactionContextFromEnv(env: Record<string, string | undefined> = process.env): RedactionContext {
    let user: string | undefined;
    try { user = userInfo().username; } catch { user = env.USERNAME; }
    return { userProfile: env.USERPROFILE, userName: user, computerName: env.COMPUTERNAME ?? hostname() };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (s: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(s)}(?![\\p{L}\\p{N}_])`, "giu");

export function redact(text: string, ctx: RedactionContext): string {
    let out = text;
    if (ctx.userProfile) {
        const p = ctx.userProfile.replace(/[\\/]+$/, "");
        // JSON-escaped form first, then native, then forward slashes.
        for (const v of [p.replaceAll("\\", "\\\\"), p, p.replaceAll("\\", "/")]) {
            out = out.replace(new RegExp(escapeRe(v), "giu"), "%USERPROFILE%");
        }
    }
    out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>");
    out = out.replace(/[\w-]{24,}\.[\w-]{6}\.[\w-]{27,}/g, "<token>");
    if (ctx.userName && ctx.userName.length >= 3) out = out.replace(word(ctx.userName), "<user>");
    if (ctx.computerName && ctx.computerName.length >= 3) out = out.replace(word(ctx.computerName), "<computer>");
    return out;
}

export async function createDebugReport(opts: {
    paths: AppPaths;
    redact: boolean;
    ctx: RedactionContext;
    summary: unknown;
    now?: Date;
}): Promise<string> {
    const clean = (t: string) => (opts.redact ? redact(t, opts.ctx) : t);
    const files: Record<string, string> = {};

    const summary = {
        helperVersion: HELPER_VERSION,
        os: `${osVersion()} (${release()})`,
        arch: process.arch,
        redacted: opts.redact,
        createdAt: (opts.now ?? new Date()).toISOString(),
        ...(opts.summary as object),
    };
    files["summary.json"] = clean(JSON.stringify(summary, null, 2));

    let logs: string[] = [];
    try { logs = readdirSync(opts.paths.logs).filter(f => f.endsWith(".log")).sort().slice(-LOG_RETENTION); } catch {}
    for (const f of logs) files[`logs/${f}`] = clean(readFileSync(join(opts.paths.logs, f), "utf8"));

    mkdirSync(opts.paths.reports, { recursive: true });
    const out = join(opts.paths.reports, `solradar-helper-report-${timestamp(opts.now ?? new Date())}.tar.gz`);
    await Bun.write(out, new Bun.Archive(files, { compress: "gzip" }));
    return out;
}
