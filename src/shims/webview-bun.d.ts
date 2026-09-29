// Typecheck-only declaration (see tsconfig.check.json). The real package ships TS source
// with a type error, so `tsc` maps "webview-bun" here. Bun uses the real package at runtime.
export declare enum SizeHint {
    NONE = 0,
    MIN = 1,
    MAX = 2,
    FIXED = 3,
}

export declare class Webview {
    constructor(debug?: boolean, size?: { width: number; height: number; hint: SizeHint });
    title: string;
    size: { width: number; height: number; hint: SizeHint };
    bind(name: string, callback: (...args: any[]) => unknown): void;
    setHTML(html: string): void;
    run(): void;
}
