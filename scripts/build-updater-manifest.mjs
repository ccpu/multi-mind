// Writes the latest.json the updater asks GitHub for.
//
// The plugin never looks at the release itself. It fetches one file, reads the
// version in it, and trusts nothing else: every artifact named there has to
// carry a detached signature it can check against the public key baked into
// tauri.conf.json. So this runs over the downloaded bundles, pairs each
// updater artifact with the .sig the bundler wrote beside it, and points at
// where the release will serve it from.
//
// A platform whose artifact or signature is missing is an error rather than an
// omission -- a quietly absent platform is one that never sees another update,
// which is the failure this file exists to end.

import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const [artifactsRoot, version, tag, repository] = process.argv.slice(2);

if (!artifactsRoot || !version || !tag || !repository) {
  throw new Error(
    'Usage: build-updater-manifest.mjs <artifacts-root> <version> <tag> <repository>',
  );
}

/**
 * The download step keeps each build's artifact in its own directory, named
 * after the matrix entry that produced it. For the two macOS builds that name
 * is the only thing left that tells them apart, because the bundler gives both
 * tarballs the same one.
 */
const PLATFORMS = {
  'tauri-macos-aarch64': { key: 'darwin-aarch64', suffix: '.app.tar.gz', arch: 'aarch64' },
  'tauri-macos-x86_64': { key: 'darwin-x86_64', suffix: '.app.tar.gz', arch: 'x64' },
  'tauri-linux-x86_64': { key: 'linux-x86_64', suffix: '.AppImage' },
  'tauri-windows-x86_64': { key: 'windows-x86_64', suffix: '-setup.exe' },
};

async function filesUnder(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name));
}

/**
 * GitHub replaces the spaces in an asset's name with dots as it uploads it, so
 * the URL written here has to name the file the way the release will serve it,
 * not the way the bundler wrote it.
 */
function assetUrl(file) {
  return `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(
    basename(file).replaceAll(' ', '.'),
  )}`;
}

/**
 * Both macOS builds produce `Multi Mind.app.tar.gz`, and one release cannot
 * hold two assets under one name -- uploading them as they are loses an
 * architecture. The architecture goes into the name before either is uploaded.
 * Every other platform already names its own bundle unambiguously and is left
 * alone, so the published installers keep the names they have always had.
 */
async function disambiguate(file, { arch, suffix }) {
  if (arch === undefined) {
    return file;
  }

  const renamed = join(dirname(file), `Multi.Mind_${version}_${arch}${suffix}`);

  await Promise.all([rename(file, renamed), rename(`${file}.sig`, `${renamed}.sig`)]);

  return renamed;
}

/** Resolves one platform's signed bundle, or explains why the release cannot ship. */
async function resolve([artifact, platform]) {
  const directory = join(artifactsRoot, artifact);

  let files;
  try {
    files = await filesUnder(directory);
  } catch {
    throw new Error(
      `Nothing was downloaded for ${platform.key}; expected the ${artifact} artifact.`,
    );
  }

  const signed = new Set(files.filter((file) => file.endsWith('.sig')));
  const bundles = files.filter(
    (file) => file.endsWith(platform.suffix) && signed.has(`${file}.sig`),
  );

  if (bundles.length !== 1) {
    throw new Error(
      bundles.length === 0
        ? `No signed ${platform.suffix} was built for ${platform.key}. Check that `
          + 'bundle.createUpdaterArtifacts is set and that the signing key reached the build.'
        : `Several signed ${platform.suffix} bundles were built for ${platform.key}: `
          + `${bundles.map((file) => basename(file)).join(', ')}.`,
    );
  }

  const bundle = await disambiguate(bundles[0], platform);

  console.log(`${platform.key}: ${basename(bundle)}`);

  return [
    platform.key,
    { signature: (await readFile(`${bundle}.sig`, 'utf8')).trim(), url: assetUrl(bundle) },
  ];
}

const platforms = Object.fromEntries(
  await Promise.all(Object.entries(PLATFORMS).map(resolve)),
);

await writeFile(
  join(artifactsRoot, 'latest.json'),
  `${JSON.stringify(
    {
      version,
      notes: `See https://github.com/${repository}/releases/tag/${tag}`,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2,
  )}\n`,
);
