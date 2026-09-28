import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { explorer, parseWebView2Version, WEBVIEW2_KEYS, webView2Installed } from "../src/core/win32";

test("parseWebView2Version accepts real versions and rejects 0.0.0.0", () => {
    expect(parseWebView2Version("\n    pv    REG_SZ    129.0.2792.65\n")).toBe("129.0.2792.65");
    expect(parseWebView2Version("    pv    REG_SZ    0.0.0.0")).toBeUndefined();
    expect(parseWebView2Version("ERROR: The system was unable to find the specified registry key or value.")).toBeUndefined();
});

test("WebView2 registry keys keep their backslashes", () => {
    for (const key of WEBVIEW2_KEYS) {
        expect(key).toContain("\\EdgeUpdate\\Clients\\{F3017226-");
        expect(key).toMatch(/^HK(LM|CU)\\/);
    }
});

test.skipIf(process.platform !== "win32")("explorer path is real", () => {
    expect(explorer().endsWith("\\explorer.exe")).toBe(true);
    expect(existsSync(explorer())).toBe(true);
});

test.skipIf(process.platform !== "win32")("webView2Installed finds the runtime on this machine", () => {
    expect(webView2Installed()).toBe(true);
});
