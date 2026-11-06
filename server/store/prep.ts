import type { DatabaseSync, StatementSync } from "node:sqlite";

const caches = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

// Cache prepared statements by SQL text so hot paths don't recompile.
export function prep(db: DatabaseSync, sql: string): StatementSync {
    let cache = caches.get(db);
    if (!cache) {
        cache = new Map();
        caches.set(db, cache);
    }
    let stmt = cache.get(sql);
    if (!stmt) {
        stmt = db.prepare(sql);
        cache.set(sql, stmt);
    }
    return stmt;
}
