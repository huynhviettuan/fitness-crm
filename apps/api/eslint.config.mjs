import { defineConfig, globalIgnores } from "eslint/config";
import base from "@gymcrm/config/eslint";

export default defineConfig([...base, globalIgnores(["dist/**", "src/generated/**"])]);
