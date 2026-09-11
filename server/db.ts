import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type RunResult = ReturnType<ReturnType<Database["prepare"]>["run"]>;

export class LocalStatement {
  readonly #database: Database;
  readonly #sql: string;
  readonly #values: SQLQueryBindings[];

  constructor(database: Database, sql: string, values: SQLQueryBindings[] = []) {
    this.#database = database;
    this.#sql = sql;
    this.#values = values;
  }

  bind(...values: SQLQueryBindings[]): LocalStatement {
    return new LocalStatement(this.#database, this.#sql, values);
  }

  all<T>(): { results: T[] } {
    return { results: this.#database.prepare(this.#sql).all(...this.#values) as T[] };
  }

  first<T>(): T | null {
    return (this.#database.prepare(this.#sql).get(...this.#values) as T | null) ?? null;
  }

  run(): RunResult {
    return this.#database.prepare(this.#sql).run(...this.#values);
  }
}

export class LocalDatabase {
  readonly #database: Database;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }
    this.#database = new Database(path, { create: true, strict: true });
    this.#database.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  }

  prepare(sql: string): LocalStatement {
    return new LocalStatement(this.#database, sql);
  }

  batch(statements: LocalStatement[]): RunResult[] {
    return this.#database.transaction(() => statements.map((statement) => statement.run()))();
  }

  migrate(migrationsDirectory = resolve(import.meta.dir, "../migrations")): string[] {
    this.#database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;`);

    const applied = new Set(
      (this.#database.query("SELECT name FROM schema_migrations").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    );
    const pending = readdirSync(migrationsDirectory)
      .filter((name) => /^\d+.*\.sql$/.test(name) && !applied.has(name))
      .sort();

    const apply = this.#database.transaction((name: string) => {
      this.#database.exec(readFileSync(resolve(migrationsDirectory, name), "utf8"));
      this.#database
        .query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(name, new Date().toISOString());
    });
    for (const name of pending) {
      apply(name);
    }
    return pending;
  }

  close(): void {
    this.#database.close();
  }
}
