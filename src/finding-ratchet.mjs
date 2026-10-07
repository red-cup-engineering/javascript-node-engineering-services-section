/**
 * finding-ratchet — findings that may only fall. An audit's findings are tallied by key (what the
 * finding is, never only where its file sits), at a base commit and at a candidate; the candidate
 * is refused when any key's count rises. Keys are tab-joined fields, named by the audit.
 */

/** The package owning a path: the deepest manifest directory above it, else its own directory. */
export function owningPackage(path, directories) {
  for (let cut = path.lastIndexOf("/"); cut > 0; cut = path.lastIndexOf("/", cut - 1)) {
    const name = directories.get(path.slice(0, cut));
    if (name !== undefined) return name;
  }
  return path.slice(0, path.lastIndexOf("/"));
}

/** A package map's directories, each to the package name it holds. */
export const packageDirectories = (map) => new Map(Object.entries(map.packages).map(([name, directory]) => [directory, name]));

/** Tally findings by key, keeping where each was found. */
export function tallyFindings(findings, keyOf) {
  const tally = new Map();
  for (const finding of findings) {
    const key = keyOf(finding);
    const entry = tally.get(key) ?? { count: 0, importers: [] };
    entry.count += 1;
    entry.importers.push(finding.importer);
    tally.set(key, entry);
  }
  return tally;
}

/** Compare two tallies: every key whose count rose (with where the candidate finds it) and every key whose count fell, as rows of the key's named fields. */
export function compareTallies(base, candidate, fields) {
  const rose = [];
  const fell = [];
  for (const key of new Set([...base.keys(), ...candidate.keys()])) {
    const before = base.get(key)?.count ?? 0;
    const after = candidate.get(key)?.count ?? 0;
    if (before === after) continue;
    const values = key.split("\t");
    const row = { ...Object.fromEntries(fields.map((field, index) => [field, values[index]])), base: before, candidate: after };
    if (after > before) rose.push(Object.freeze({ ...row, importers: Object.freeze(candidate.get(key).importers) }));
    else fell.push(Object.freeze(row));
  }
  const order = (left, right) => fields.reduce((result, field) => result || String(left[field]).localeCompare(String(right[field])), 0);
  return { rose: rose.sort(order), fell: fell.sort(order) };
}

/** True when a candidate's package map seats a name the base also has at another directory: the
 *  one change of the map that can move an unchanged file's import to another layer. A name the
 *  candidate adds resolves only imports the base could not, which the phantom audit owns. */
export const reseated = (baseMap, candidateMap) => Object.entries(candidateMap.packages).some(([name, directory]) => baseMap.packages[name] !== undefined && baseMap.packages[name] !== directory);
