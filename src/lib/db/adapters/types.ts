export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface PreparedStatement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/**
 * Real better-sqlite3 shape: `db.transaction(fn)` returns a callable that
 * ALSO carries `.deferred`/`.immediate`/`.exclusive` variants, each invoked
 * with the same args to run the same function under that transaction mode.
 * `.deferred()` and the bare call are equivalent (DEFERRED is the default).
 */
export interface SqliteTransactionFn<T> {
  (...args: unknown[]): T;
  deferred(...args: unknown[]): T;
  immediate(...args: unknown[]): T;
  exclusive(...args: unknown[]): T;
}

export interface SqliteAdapter {
  readonly driver: "better-sqlite3" | "node:sqlite" | "bun:sqlite" | "sql.js";
  readonly open: boolean;
  readonly name: string;

  prepare(sql: string): PreparedStatement;
  exec(sql: string): void;
  pragma(pragmaStr: string, options?: { simple?: boolean }): unknown;

  /**
   * Returns a callable transaction wrapper. Call it directly (or `.deferred()`)
   * for DEFERRED, `.immediate()` to take the write lock up front (see
   * `SqliteTransactionFn`), `.exclusive()` for EXCLUSIVE.
   */
  transaction<T>(fn: (...args: unknown[]) => T): SqliteTransactionFn<T>;

  /** Backup nativo ou file-copy fallback */
  backup(destination: string): Promise<void>;

  checkpoint(mode?: string): void;
  close(): void;

  readonly raw: unknown;
}
