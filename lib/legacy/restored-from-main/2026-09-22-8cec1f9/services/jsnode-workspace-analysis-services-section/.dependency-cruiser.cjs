/*
 * The org-layering / import-stratification gate, as a dependency-cruiser ruleset.
 *
 * The owner's own stated import law (owner-stated 2026-08-30): scripts import scripts and src,
 * never apps; apps compose scripts, src, and other apps. Each rule below is that law, plus
 * no-circular, turned into an exit status. This gate no longer reads the canonical capability
 * registry or a specification file: both were deleted 2026-09-11/2026-09-13, and the two rules
 * that depended on them (raw-substrate-only-in-effect-owners, superseded-capability-import) were
 * removed with them rather than left pointing at nothing.
 *
 * Run from the repository root:
 *   depcruise --config <this file> --output-type err <paths...>
 * Whole tree (CI): depcruise --config <this file> --output-type err lib
 * Changed files only: depcruise --config <this file> --output-type err --max-depth 1 <files>
 */
const packageDir = "^(lib/.*services/[^/]+)/(?:src|scripts|apps)/";

module.exports = {
  forbidden: [
    {
      name: "only-apps-import-apps",
      comment:
        "org-layering: an app has zero library consumers; the one lawful import of an app is by another app. " +
        "import-stratification: scripts cannot import apps.",
      severity: "error",
      from: { pathNot: "/apps/" },
      to: { path: "/apps/", pathNot: "/node_modules/" },
    },
    {
      name: "src-never-imports-scripts",
      comment:
        "org-layering: src is the domain's types and public algebra; scripts import src and scripts; " +
        "apps compose scripts, src, and apps. src reaching into scripts inverts the stratification.",
      severity: "error",
      from: { path: "/src/" },
      to: { path: "/scripts/", pathNot: "/node_modules/" },
    },
    {
      name: "relative-import-escapes-package",
      comment:
        "a capability is consumed by its package name at an exact pin, never by " +
        "a ../../ path into another package. A relative import must stay inside its own package directory.",
      severity: "error",
      from: { path: packageDir },
      to: { dependencyTypes: ["local"], pathNot: "^$1/" },
    },
    {
      name: "no-circular",
      comment: "composition is codomain meeting domain; a cycle is not a morphism.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "/legacy/|/dist/|/\\.tmp/|/content/assets/|/build/" },
    moduleSystems: ["es6", "cjs"],
    tsPreCompilationDeps: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      mainFields: ["module", "main"],
    },
    progress: { type: "none" },
  },
};
