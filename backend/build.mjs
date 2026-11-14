import { build } from "esbuild";

await build({
    entryPoints: ["src/server.ts"],
    outfile: "dist/server.js",
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    target: "node26",
    sourcemap: false,
});