#!/usr/bin/env node
import { access } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { readMarkdownFile } from "@red-cup-engineering/markdown-engineering-services-section/read-markdown-file";
import { writeMarkdownFile } from "@red-cup-engineering/markdown-engineering-services-section/write-markdown-file";
import { readFileText } from "@red-cup-engineering/computer-file-engineering-services-section/read-file";
import { writeFileText } from "@red-cup-engineering/computer-file-engineering-services-section/write-file";
import { walkPosixPaths } from "@red-cup-engineering/computer-filepath-engineering-services-section/walk-posix-paths";
import { runJavascriptNodeOperation } from "@red-cup-engineering/javascript-node-services-section/operation";
import { foldDirectoryEntriesIntoServicesSectionForm } from "./fold-directory-entries-into-services-section-form.mjs";
import { checkServicesSectionFormConformance } from "./check-services-section-form-conformance.mjs";
import { findServicesSectionRepositoryRoot, readServicesSectionLaw } from "./read-services-section-law.mjs";
import { writeEnterpriseBrand } from "@coesite-operations/enterprise-branding-services-section/write-enterprise-brand";
import { sectionCarriesBrand, sectionCustody } from "@coesite-operations/enterprise-branding-services-section/src";

const SERVICES_TREE_PREFIX = "lib/emsenn/services/561-group/services/";
const ENGINEERING_TREE_PREFIX = `${SERVICES_TREE_PREFIX}engineering-services-section/`;
const SECTION_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*-(?:services-section|service)$/u;

/**
 * The Group's naming law for a new section, read from its path alone: the directory is the name, it sits
 * in its parent's services/, it is kebab-case ending in -services-section (a section) or -service (a leaf
 * service), and a section founded anywhere under engineering-services-section names its engineering
 * ("computer-engineering-services-section", never "computer-services-section").
 * @param {string} path The requested repo-relative section path.
 * @param {string} name The requested section name.
 * @returns {string[]} One sentence per rule the request breaks; empty when the name conforms.
 */
export function sectionNameObstructions(path, name) {
  const trimmed = path.replace(/\/+$/u, "");
  const directory = posix.basename(trimmed);
  const obstructions = [];
  if (directory !== name) obstructions.push(`the directory "${directory}" is not the section's name "${name}"`);
  if (posix.basename(posix.dirname(trimmed)) !== "services") obstructions.push(`"${directory}" is not founded in its parent's services/ directory`);
  if (!SECTION_NAME.test(directory)) obstructions.push(`"${directory}" is not kebab-case ending in -services-section or -service`);
  if (trimmed.startsWith(ENGINEERING_TREE_PREFIX) && directory.endsWith("-services-section") && !directory.endsWith("-engineering-services-section")) {
    obstructions.push(`a section under engineering-services-section is named "<subject>-engineering-services-section", not "${directory}"`);
  }
  return obstructions;
}

const operationDefinition = {
  name: "foundServicesSection",
  description: "Founds one new services-section directory in ServicesSectionForm shape — a README.md and package.json — skipping either that already exists rather than overwriting it, optionally appending one sentence to the parent section's README, then folds the resulting directory entries through fold-directory-entries-into-services-section-form-service.",
  inputSchema: {
    type: "object",
    required: ["path", "name", "custody", "packageName", "packageDescription"],
    properties: {
      path: { type: "string", minLength: 1 },
      name: { type: "string", minLength: 1 },
      custody: { type: "string", minLength: 1 },
      packageName: { type: "string", minLength: 1 },
      packageDescription: { type: "string", minLength: 1 },
      brand: { type: "string" },
      keywords: { type: "array", items: { type: "string" } },
      parentReadmeSentence: { type: "string" },
      readme: { type: "string" },
      root: { type: "string" },
    },
  },
  outputSchema: {
    anyOf: [
      { type: "object", required: ["type", "version", "path", "created", "skipped"], properties: { type: { const: "ServicesSectionForm" }, version: { const: 1 } } },
      {
        type: "object",
        required: ["refused"],
        additionalProperties: false,
        properties: { refused: { enum: ["PATH_OUTSIDE_SERVICES_TREE", "REPOSITORY_ROOT_NOT_FOUND"] }, cwd: { type: "string" } },
      },
      {
        type: "object",
        required: ["refused", "obstructions"],
        additionalProperties: false,
        properties: { refused: { const: "NAME_NOT_CONFORMANT" }, obstructions: { type: "array", items: { type: "string" } } },
      },
      {
        type: "object",
        required: ["refusal", "sectionPath", "custody"],
        additionalProperties: false,
        properties: {
          refusal: { const: "SECTION_CARRIES_NO_BRAND" },
          sectionPath: { type: "string" },
          custody: { type: "string" },
        },
      },
    ],
  },
};

/**
 * Reports whether a filesystem path exists, without distinguishing file from directory.
 * @param {string} path An absolute or cwd-relative filesystem path.
 * @returns {Promise<boolean>} True when the path resolves to an existing entry.
 * @throws {Error} Any access error other than the path not existing.
 */
async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Builds a one-paragraph README body from a package's own name and description.
 * @param {string} packageName The section's npm package name.
 * @param {string} packageDescription The section's one-sentence description.
 * @returns {string} A minimal Markdown README.
 */
function defaultReadmeText(packageName, packageDescription) {
  return `# ${packageName}\n\n${packageDescription}\n`;
}

/**
 * Founds one new services-section directory in ServicesSectionForm shape — a README.md and package.json — skipping either that already exists rather than overwriting it, optionally appending one sentence to the parent section's README, then folds the resulting directory entries through fold-directory-entries-into-services-section-form-service.
 * @param {{path: string, name: string, custody: string, packageName: string, packageDescription: string, brand?: string, keywords?: string[], parentReadmeSentence?: string, readme?: string, root?: string}} request A record naming the new section's repo-relative path (must be beneath lib/emsenn/services/561-group/services/), its display name, custody ("science"|"engineering"|"operations"|"561-group"|"public"), its package name and description, an optional brand name (written as an enterprise brand service record through enterprise-branding-services-section's write script — never into the package name, directory name, or README title — and refused when the section is not public custody or one of the five houses), optional extra keywords appended after custody, an optional sentence to append to the parent section's README when not already present, an optional full README text (a one-paragraph README is generated from packageName/packageDescription when omitted), and an optional root (an absolute repository root to resolve path against; when omitted, the repository root is found by walking up from process.cwd() to the nearest ancestor containing lib/emsenn/services/561-group/services, so the result never depends on which directory the caller happens to be in).
 * @returns {Promise<object>} The ServicesSectionForm record folded from the section's entries, plus `created` and `skipped` relative-path arrays, and `brand` (the write-enterprise-brand.mjs result) when request.brand was supplied; or a refusal datum: `{refused: "PATH_OUTSIDE_SERVICES_TREE"}` when path is not beneath the services tree, `{refused: "NAME_NOT_CONFORMANT", obstructions}` when the name breaks the Group's naming law (see sectionNameObstructions), before anything is written, `{refused: "REPOSITORY_ROOT_NOT_FOUND", cwd}` when root is omitted and no ancestor of process.cwd() contains the services tree, or `{refusal: "SECTION_CARRIES_NO_BRAND", sectionPath, custody}` when request.brand was supplied for a section that is not public custody or one of the five houses.
 * @throws {TypeError} When path, name, custody, packageName, or packageDescription is missing or not a string.
 */
export async function foundServicesSection(request) {
  if (typeof request?.path !== "string" || request.path.length === 0) throw new TypeError("path is required");
  if (typeof request?.name !== "string" || request.name.length === 0) throw new TypeError("name is required");
  if (typeof request?.custody !== "string" || request.custody.length === 0) throw new TypeError("custody is required");
  if (typeof request?.packageName !== "string" || request.packageName.length === 0) throw new TypeError("packageName is required");
  if (typeof request?.packageDescription !== "string" || request.packageDescription.length === 0) throw new TypeError("packageDescription is required");

  if (!request.path.startsWith(SERVICES_TREE_PREFIX)) {
    return { refused: "PATH_OUTSIDE_SERVICES_TREE" };
  }

  const obstructions = sectionNameObstructions(request.path, request.name);
  if (obstructions.length > 0) return { refused: "NAME_NOT_CONFORMANT", obstructions };

  const cwd = process.cwd();
  const repositoryRoot = typeof request.root === "string" && request.root.length > 0
    ? resolve(request.root)
    : await findServicesSectionRepositoryRoot(cwd);
  if (repositoryRoot === null) {
    return { refused: "REPOSITORY_ROOT_NOT_FOUND", cwd };
  }

  if (typeof request.brand === "string" && request.brand.length > 0 && !sectionCarriesBrand(request.path)) {
    return { refusal: "SECTION_CARRIES_NO_BRAND", sectionPath: request.path, custody: sectionCustody(request.path) };
  }

  const { schema, contentTaxonomy } = await readServicesSectionLaw(repositoryRoot);

  const created = [];
  const skipped = [];

  const keywords = [
    request.custody,
    ...(Array.isArray(request.keywords) ? request.keywords : []),
  ];

  const packageJson = {
    name: request.packageName,
    version: "0.1.0",
    description: request.packageDescription,
    type: "module",
    keywords,
  };

  const files = [
    { rel: "README.md", markdown: true, text: request.readme ?? defaultReadmeText(request.packageName, request.packageDescription) },
    { rel: "package.json", markdown: false, text: `${JSON.stringify(packageJson, null, 2)}\n` },
  ];

  for (const file of files) {
    const absolute = resolve(repositoryRoot, request.path, file.rel);
    if (await pathExists(absolute)) {
      skipped.push(file.rel);
      continue;
    }
    if (file.markdown) await writeMarkdownFile({ path: absolute, text: file.text, mode: "create" });
    else await writeFileText(absolute, file.text);
    created.push(file.rel);
  }

  if (typeof request.parentReadmeSentence === "string" && request.parentReadmeSentence.length > 0) {
    const parentReadmeRelative = join(dirname(dirname(request.path)), "README.md");
    const parentReadmeAbsolute = resolve(repositoryRoot, parentReadmeRelative);
    if (await pathExists(parentReadmeAbsolute)) {
      const currentText = await readMarkdownFile(parentReadmeAbsolute);
      if (currentText.includes(request.parentReadmeSentence)) {
        skipped.push(`${parentReadmeRelative} (sentence already present)`);
      } else {
        const updatedText = `${currentText.replace(/\n+$/u, "")}\n\n${request.parentReadmeSentence}\n`;
        await writeMarkdownFile({ path: parentReadmeAbsolute, text: updatedText, mode: "replace" });
        created.push(`${parentReadmeRelative} (sentence appended)`);
      }
    } else {
      skipped.push(`${parentReadmeRelative} (parent README missing)`);
    }
  }

  const walk = await walkPosixPaths({ root: resolve(repositoryRoot, request.path), result: "paths" });
  const finalPackageJsonText = await readFileText(resolve(repositoryRoot, request.path, "package.json"));
  const form = foldDirectoryEntriesIntoServicesSectionForm({
    path: request.path,
    entries: walk.files,
    packageJson: JSON.parse(finalPackageJsonText),
  }, contentTaxonomy);
  const receiving = checkServicesSectionFormConformance(form, schema);
  if (!receiving.conformant) throw new Error(JSON.stringify(receiving.obstructions));

  const brand = typeof request.brand === "string" && request.brand.length > 0
    ? await writeEnterpriseBrand({ sectionPath: request.path, brand: { name: request.brand, custody: request.custody }, root: repositoryRoot })
    : undefined;

  return { ...form, created, skipped, ...(brand === undefined ? {} : { brand }) };
}

if (import.meta.main) {
  process.exitCode = (await runJavascriptNodeOperation(
    { ...operationDefinition, operation: foundServicesSection },
    { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout },
  )).exitCode;
}
