import { readConfig } from "./config";
import { LocalDatabase } from "./db";

const config = readConfig();
const database = new LocalDatabase(config.databasePath);

try {
  const migrations = database.migrate();
  console.log(migrations.length ? `Applied: ${migrations.join(", ")}` : "Database is up to date.");
} finally {
  database.close();
}
