// Writing generated files: atomically, and only when the content changed.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export async function readIfExists(path) {
  try {
    return await readFile(path);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

/** Writes `bytes` to `path` unless it already holds them. Returns whether it wrote. */
export async function writeIfChanged(path, bytes) {
  const current = await readIfExists(path);
  if (current && current.equals(bytes)) return false;
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(temp, bytes);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
  return true;
}

/** Writes each `{ path, bytes }`. Returns how many were written and how many there were. */
export async function writeAll(files) {
  let written = 0;
  for (const { path, bytes } of files) if (await writeIfChanged(path, bytes)) written += 1;
  return { written, total: files.length };
}
