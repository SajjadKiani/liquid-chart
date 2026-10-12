import { spawnSync } from 'node:child_process';
import { cp, rm, readdir, readFile, writeFile } from 'node:fs/promises';

await rm(new URL('../dist/', import.meta.url), { recursive: true, force: true });
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.lib.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
// TypeScript rewrites runtime imports, but leaves .ts specifiers in declarations.
// Use .js specifiers there too so consumers need neither our sources nor a
// special allowImportingTsExtensions setting.
for (const file of await readdir(new URL('../dist/', import.meta.url))) {
  if (!file.endsWith('.d.ts')) continue;
  const path = new URL(`../dist/${file}`, import.meta.url);
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace(/(['"])(\.\.?\/[^'"]+)\.ts\1/g, '$1$2.js$1'));
}
await cp(new URL('../src/chart.css', import.meta.url), new URL('../dist/style.css', import.meta.url));
