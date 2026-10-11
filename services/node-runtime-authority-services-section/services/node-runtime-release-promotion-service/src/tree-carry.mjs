// Carrying a release tree's tracked files into a new one is the kernel's work: tens of thousands of
// link(2) and mkdir(2) calls, each of which costs the same whatever it links. One thread issues them
// one after another; worker threads issue them side by side, each over its own run of the sorted
// paths (so each makes its own directories, and two workers meeting in one directory only race to
// a mkdir the other's recursive call treats as done). A release tree is immutable once promoted,
// and a carry is a clone, never a share: every directory of the new tree is its own, so removing
// the running release leaves the new one whole. (Sharing whole subtrees by symlink was measured and
// refused: Node resolves a module to its real path, so a shared subtree's `../../` imports would
// leave the new release for the old one's siblings.)
import { constants as fsConstants, copyFileSync, linkSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

function carry({ from, to, entries, reflinks }) {
  const made = new Set([to]);
  for (const { mode, path } of entries) {
    const target = join(to, path);
    const directory = dirname(target);
    if (!made.has(directory)) { mkdirSync(directory, { recursive: true }); made.add(directory); }
    const source = join(from, path);
    if (mode === "120000") symlinkSync(readlinkSync(source), target);
    else if (reflinks) copyFileSync(source, target, fsConstants.COPYFILE_FICLONE_FORCE);
    else linkSync(source, target);
  }
  return entries.length;
}

if (!isMainThread && workerData?.treeCarry) {
  try { parentPort.postMessage({ carried: carry(workerData.treeCarry) }); }
  catch (error) { parentPort.postMessage({ error: `${error.code ?? ""} ${error.message}` }); }
}

/**
 * Carries `entries` (`{ mode, path }`, sorted by path) of the tree `from` into the tree `to`, by
 * reflink where `reflinks` and else by hard link; symlinks are recreated. Runs in `jobs` worker
 * threads (at least `grain` entries each), each given a contiguous run, and rejects with the first failure.
 */
export async function carryFiles({ from, to, entries, reflinks = false, jobs = 16, grain = 500 }) {
  mkdirSync(to, { recursive: true });
  const count = Math.max(1, Math.min(jobs, Math.ceil(entries.length / grain)));
  if (count === 1) return carry({ from, to, entries, reflinks });
  const size = Math.ceil(entries.length / count);
  const runs = Array.from({ length: count }, (_, index) => entries.slice(index * size, (index + 1) * size)).filter((run) => run.length > 0);
  const counts = await Promise.all(runs.map((run) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { treeCarry: { from, to, entries: run, reflinks } } });
    worker.once("message", (message) => (message.error ? reject(new Error(message.error)) : resolve(message.carried)));
    worker.once("error", reject);
    worker.once("exit", (code) => { if (code !== 0) reject(new Error(`carry worker exited ${code}`)); });
  })));
  return counts.reduce((sum, value) => sum + value, 0);
}
