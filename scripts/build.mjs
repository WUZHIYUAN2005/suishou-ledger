import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = new URL("../", import.meta.url);
const shell = await readFile(new URL("src/shell.html", root), "utf8");
const worker = await readFile(new URL("src/service-worker.js", root), "utf8");
const { outputFiles } = await build({
  absWorkingDir: fileURLToPath(root),
  entryPoints: ["src/main.jsx"],
  bundle: true,
  minify: true,
  jsx: "automatic",
  target: ["safari16", "chrome105", "firefox115"],
  loader: { ".png": "dataurl", ".webp": "dataurl" },
  supported: { "inline-script": true, "inline-style": true },
  outfile: "dist/ledger-app.js",
  write: false,
});
const script = outputFiles.find((file) => file.path.endsWith(".js")).text;
const styles = outputFiles.find((file) => file.path.endsWith(".css")).text;

const html = shell
  .replace("<!-- INLINE_STYLES -->", () => `<style>\n${styles}</style>`)
  .replace("<!-- INLINE_SCRIPT -->", () => `<script>\n${script}</script>`);
const revision = createHash("sha256")
  .update(html)
  .update(worker)
  .digest("hex")
  .slice(0, 12);

await Promise.all([
  writeFile(new URL("index.html", root), html),
  writeFile(new URL("cloud.html", root), html),
  writeFile(
    new URL("sw.js", root),
    worker.replace("__LEDGER_REVISION__", revision),
  ),
]);
console.log(`Built both ledger entry points (${revision})`);
