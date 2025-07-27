import { defineConfig } from "tsup";
import { globSync } from "glob";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/client/index.ts",
    ...globSync("src/server/**/*.ts"),
  ],
  format: ["esm", "cjs"],
  dts: true,
});
