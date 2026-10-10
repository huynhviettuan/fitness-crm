import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./platform/env.js";

const app = await createApp({ docs: env.NODE_ENV !== "production" });
await app.listen(env.PORT);
console.info(`API listening on port ${env.PORT}`);
