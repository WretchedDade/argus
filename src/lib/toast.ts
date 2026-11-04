// Minimal global toast store. Lives outside the router so toasts survive
// navigation (Settings saves, then routes away — the toast must outlast it).
export type ToastKind = "success" | "error" | "progress";
export interface Toast {
    id: number;
    message: string;
    kind: ToastKind;
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit(): void {
    for (const l of listeners) l();
}

function schedule(id: number, ttlMs: number | null): void {
    clearTimeout(timers.get(id));
    timers.delete(id);
    if (ttlMs !== null)
        timers.set(
            id,
            setTimeout(() => dismissToast(id), ttlMs),
        );
}

// A progress toast stays until updateToast or dismissToast ends it.
export function pushToast(
    message: string,
    kind: ToastKind = "success",
    ttlMs: number | null = kind === "progress" ? null : 2600,
): number {
    const id = nextId++;
    toasts = [...toasts, { id, message, kind }];
    emit();
    schedule(id, ttlMs);
    return id;
}

export function updateToast(
    id: number,
    patch: Partial<Pick<Toast, "message" | "kind">>,
    ttlMs: number | null = patch.kind === "progress" || !patch.kind
        ? null
        : 2600,
): void {
    if (!toasts.some((t) => t.id === id)) return;
    toasts = toasts.map((t) => (t.id === id ? { ...t, ...patch } : t));
    emit();
    schedule(id, ttlMs);
}

export function dismissToast(id: number): void {
    schedule(id, null);
    toasts = toasts.filter((t) => t.id !== id);
    emit();
}

export function subscribeToasts(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function getToasts(): Toast[] {
    return toasts;
}
