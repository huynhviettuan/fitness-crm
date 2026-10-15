import { defineConfig, globalIgnores } from "eslint/config";
import base from "@flow/config/eslint";

export default defineConfig([...base, globalIgnores(["dist/**", "release/**"])]);
