// Minimal global toast store. Lives outside the router so toasts survive
// navigation (Settings saves, then routes away — the toast must outlast it).
export type ToastKind = "success" | "error";
export interface Toast {
    id: number;
    message: string;
    kind: ToastKind;
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
let nextId = 1;

function emit(): void {
    for (const l of listeners) l();
}

export function pushToast(
    message: string,
    kind: ToastKind = "success",
    ttlMs = 2600,
): void {
    const id = nextId++;
    toasts = [...toasts, { id, message, kind }];
    emit();
    setTimeout(() => dismissToast(id), ttlMs);
}

export function dismissToast(id: number): void {
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
