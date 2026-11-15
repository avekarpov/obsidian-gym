import esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const watch = process.argv.includes("--watch");
const install = process.argv.includes("--install");
const vault = process.env.VAULT ?? path.join(os.homedir(), ".vault");
const files = ["main.js", "manifest.json", "styles.css"];

const installPlugin = {
  name: "install",
  setup(build) {
    build.onEnd((result) => {
      if (!install || result.errors.length) return;
      const target = path.join(vault, ".obsidian", "plugins", "gym");
      fs.mkdirSync(target, { recursive: true });
      for (const file of files) fs.copyFileSync(file, path.join(target, file));
      console.log(`installed into ${target}`);
    });
  },
};

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  outfile: "main.js",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  logLevel: "info",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  plugins: [installPlugin],
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
