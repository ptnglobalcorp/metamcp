import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}
console.log("process.env.DATABASE_URL", process.env.DATABASE_URL);

export const db = drizzle(process.env.DATABASE_URL, { schema });
