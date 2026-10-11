import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { findServicesSectionRepositoryRoot, readServicesSectionLaw } from "../scripts/read-services-section-law.mjs";

export const law = await readServicesSectionLaw(await findServicesSectionRepositoryRoot(dirname(fileURLToPath(import.meta.url))));
export async function installSectionLaw(root) {
  const directory = resolve(root, "lib/emsenn/services/561-group/services/561-group-services-section/data/records/schema");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(resolve(directory, "services-section-form.schema.json"), JSON.stringify(law.schema)),
    writeFile(resolve(directory, "services-section-form-content-taxonomy.json"), JSON.stringify(law.contentTaxonomy)),
  ]);
}
