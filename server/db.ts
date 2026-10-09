// Ouverture de la base SQLite du backend VPS (node:sqlite, intégré à Deno).
// Un seul processus écrit : WAL pour que les lectures (pick, SSE) ne bloquent
// pas les syncs. Le schéma est appliqué si la base est neuve (user_version 0).
import { DatabaseSync } from "node:sqlite";

const SCHEMA = await Deno.readTextFile(new URL("./schema.sql", import.meta.url));

export class Store {
  readonly sql: DatabaseSync;
  // Verrou applicatif : les handlers sont async, une transaction ouverte par
  // une requête ne doit pas voir s'intercaler les écritures d'une autre.
  #queue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.sql = new DatabaseSync(path);
    this.sql.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const v = this.sql.prepare("PRAGMA user_version").get() as { user_version: number };
    if (v.user_version === 0) this.sql.exec(SCHEMA);
  }

  // Exécute fn en exclusion mutuelle avec les autres écritures.
  exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.#queue.then(() => fn());
    this.#queue = run.catch(() => {});
    return run;
  }

  // Transaction : COMMIT si fn réussit, ROLLBACK si elle lève.
  atomic<T>(fn: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      this.sql.exec("BEGIN IMMEDIATE");
      try {
        const r = await fn();
        this.sql.exec("COMMIT");
        return r;
      } catch (e) {
        this.sql.exec("ROLLBACK");
        throw e;
      }
    });
  }

  close() { this.sql.close(); }
}

export function openDb(path: string): Store {
  return new Store(path);
}
