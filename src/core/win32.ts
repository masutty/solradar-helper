import { dlopen, FFIType } from "bun:ffi";
import { system32 } from "./commands";
import { parseRegValue } from "./env";

const MB_OKCANCEL = 0x1;
const MB_ICONINFORMATION = 0x40;
const IDOK = 1;

const wide = (s: string) => Buffer.from(s + "\0", "utf16le");

export function showMessageBox(title: string, text: string, buttons: "ok" | "okcancel" = "ok"): "ok" | "cancel" {
    const user32 = dlopen("user32.dll", {
        MessageBoxW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
    });
    try {
        const flags = MB_ICONINFORMATION | (buttons === "okcancel" ? MB_OKCANCEL : 0);
        return user32.symbols.MessageBoxW(null, wide(text), wide(title), flags) === IDOK ? "ok" : "cancel";
    } finally {
        user32.close();
    }
}

export function parseWebView2Version(regOutput: string): string | undefined {
    const v = parseRegValue(regOutput, "pv");
    return v && v !== "0.0.0.0" ? v : undefined;
}

const WEBVIEW2_KEYS = [
    "HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKCU\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
];

export function webView2Installed(): boolean {
    return WEBVIEW2_KEYS.some(key => {
        const r = Bun.spawnSync([system32("reg.exe"), "query", key, "/v", "pv"], { stdin: "ignore", stdout: "pipe", stderr: "ignore", windowsHide: true });
        return r.exitCode === 0 && !!parseWebView2Version(r.stdout.toString());
    });
}

const explorer = () => system32("..\explorer.exe");

function detached(cmd: string[]) {
    Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
}

export function openUrl(url: string): void {
    detached([system32("rundll32.exe"), "url.dll,FileProtocolHandler", url]);
}

export function openFolder(path: string): void {
    detached([explorer(), path]);
}

export function revealFile(path: string): void {
    detached([explorer(), `/select,${path}`]);
}
