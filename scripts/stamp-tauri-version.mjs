import { readFile, writeFile } from 'node:fs/promises';

const [version] = process.argv.slice(2);
const validVersion =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!version || !validVersion.test(version)) {
  throw new Error(`Expected a semantic version, received ${version ?? 'nothing'}.`);
}

async function updateJsonVersion(path) {
  const json = JSON.parse(await readFile(path, 'utf8'));
  json.version = version;
  await writeFile(path, `${JSON.stringify(json, null, 2)}\n`);
}

async function updateCargoVersion(path) {
  const contents = await readFile(path, 'utf8');
  const updated = contents.replace(/^(version = ")[^"]+(")$/m, `$1${version}$2`);

  if (updated === contents) {
    throw new Error(`Could not find the package version in ${path}.`);
  }

  await writeFile(path, updated);
}

await Promise.all([
  updateJsonVersion('apps/desktop/package.json'),
  updateCargoVersion('apps/desktop/src-tauri/Cargo.toml'),
  updateJsonVersion('apps/desktop/src-tauri/tauri.conf.json'),
]);
