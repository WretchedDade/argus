// Minimal ambient types for the host-provided SDK. The runtime resolves the
// real module; we only declare the surface Argus uses so TS stays honest.
declare module "@github/copilot-sdk/extension" {
    export class CanvasError extends Error {
        constructor(code: string, message: string);
    }

    export interface CanvasOpenContext {
        instanceId: string;
        input?: Record<string, unknown>;
    }

    export interface CanvasCloseContext {
        instanceId: string;
    }

    export interface CanvasActionContext {
        instanceId: string;
        input?: Record<string, unknown>;
    }

    export interface CanvasAction {
        name: string;
        description?: string;
        inputSchema?: unknown;
        handler: (ctx: CanvasActionContext) => Promise<unknown>;
    }

    export interface CanvasDefinition {
        id: string;
        displayName: string;
        description?: string;
        inputSchema?: unknown;
        actions?: CanvasAction[];
        open: (
            ctx: CanvasOpenContext,
        ) => Promise<{ title: string; status?: string; url: string }>;
        onClose?: (ctx: CanvasCloseContext) => Promise<void>;
    }

    export function createCanvas(def: CanvasDefinition): CanvasDefinition;

    export interface Session {
        log: (message: string, options?: { level?: string }) => Promise<void>;
        send: (message: string) => Promise<void>;
    }

    export function joinSession(opts: {
        tools?: unknown[];
        canvases: CanvasDefinition[];
    }): Promise<Session>;
}
