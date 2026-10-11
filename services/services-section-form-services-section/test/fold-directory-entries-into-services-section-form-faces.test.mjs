import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { foldDirectoryEntriesIntoServicesSectionForm as boundOperation } from "../scripts/fold-directory-entries-into-services-section-form.mjs";
import { law } from "./section-law-fixture.mjs";
const foldDirectoryEntriesIntoServicesSectionForm = (request) => boundOperation(request, law.contentTaxonomy);

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "a conformant engineering section folds fully populated",
    "input": {
      "path": "lib/emsenn/services/561-group/services/engineering-services-section/services/widget-engineering-services-section",
      "entries": [
        "README.md",
        "package.json",
        "src/x.mjs",
        "scripts/read-x.mjs",
        "test/x.test.mjs",
        "data/records/",
        "services/child-services-section/"
      ],
      "packageJson": {
        "name": "@red-cup-engineering/widget",
        "version": "0.1.0",
        "type": "module",
        "dependencies": {
          "left-pad": "1.3.0"
        }
      }
    },
    "output": {
      "type": "ServicesSectionForm",
      "version": 1,
      "path": "lib/emsenn/services/561-group/services/engineering-services-section/services/widget-engineering-services-section",
      "name": "widget-engineering-services-section",
      "custody": "engineering",
      "readme": {
        "present": true
      },
      "package": {
        "present": true,
        "name": "@red-cup-engineering/widget",
        "version": "0.1.0",
        "type": "module",
        "dependenciesExactPins": true
      },
      "content": {
        "present": false,
        "text": {
          "glossary": {
            "terms": 0,
            "concepts": 0,
            "topics": 0
          },
          "documents": {
            "articles": {
              "notes": 0,
              "teachingArticles": {
                "explanations": 0,
                "guides": 0,
                "references": 0,
                "tutorials": 0
              },
              "specifications": 0,
              "bibliographies": 0,
              "researchArticles": 0
            }
          }
        }
      },
      "code": {
        "src": [
          "x.mjs"
        ],
        "scripts": [
          "read-x.mjs"
        ],
        "apps": [],
        "test": [
          "x.test.mjs"
        ]
      },
      "data": {
        "present": true,
        "logs": false,
        "records": true,
        "state": false,
        "other": []
      },
      "services": [
        "child-services-section"
      ],
      "legacy": [],
      "stray": [],
      "laws": {
        "dataTrioOnly": true,
        "scriptsVerbNounNaming": true,
        "appsComposeScripts": true,
        "oneTopicPerSection": true,
        "contentUnderContentText": true,
        "notesDatedPath": true,
        "noRootWorkspaceFiles": true,
        "legacyIsRevivalInventory": true
      }
    }
  },
  {
    "type": "JavascriptNodeOperationExample",
    "name": "a thin public section folds mostly-absent",
    "input": {
      "path": "lib/emsenn/services/561-group/services/public-services-section/services/thin-public-services-section",
      "entries": [
        "content/text/glossary/terms/a.md"
      ]
    },
    "output": {
      "type": "ServicesSectionForm",
      "version": 1,
      "path": "lib/emsenn/services/561-group/services/public-services-section/services/thin-public-services-section",
      "name": "thin-public-services-section",
      "custody": "public",
      "readme": {
        "present": false
      },
      "package": {
        "present": false
      },
      "content": {
        "present": true,
        "text": {
          "glossary": {
            "terms": 1,
            "concepts": 0,
            "topics": 0
          },
          "documents": {
            "articles": {
              "notes": 0,
              "teachingArticles": {
                "explanations": 0,
                "guides": 0,
                "references": 0,
                "tutorials": 0
              },
              "specifications": 0,
              "bibliographies": 0,
              "researchArticles": 0
            }
          }
        }
      },
      "code": {
        "src": [],
        "scripts": [],
        "apps": [],
        "test": []
      },
      "data": {
        "present": false,
        "logs": false,
        "records": false,
        "state": false,
        "other": []
      },
      "services": [],
      "legacy": [],
      "stray": [],
      "laws": {
        "dataTrioOnly": true,
        "scriptsVerbNounNaming": true,
        "appsComposeScripts": true,
        "oneTopicPerSection": true,
        "contentUnderContentText": true,
        "notesDatedPath": true,
        "noRootWorkspaceFiles": true,
        "legacyIsRevivalInventory": true
      }
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await foldDirectoryEntriesIntoServicesSectionForm(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/fold-directory-entries-into-services-section-form.mjs", import.meta.url))], {
      input: JSON.stringify(example.input) + "\n",
      encoding: "utf8",
    });
    assert.equal(command.status, 0, command.stderr);
    const commandOutput = JSON.parse(command.stdout.trim());
    assert.deepEqual(commandOutput, example.output);
    assert.deepEqual(commandOutput, importedOutput);
  });
}

test("the command preserves its help face without reading NDJSON", () => {
  const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/fold-directory-entries-into-services-section-form.mjs", import.meta.url)), "--help"], {
    input: "not-json\n",
    encoding: "utf8",
  });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(command.stdout, "foldDirectoryEntriesIntoServicesSectionForm — Folds a section's path, its already-listed relative entries, and its already-parsed package.json into a ServicesSectionForm record — a pure transformation over its request, using explicitly supplied content-taxonomy law.\n");
});

test("the command reports a typed refusal for an invalid NDJSON request and exits nonzero", () => {
  const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/fold-directory-entries-into-services-section-form.mjs", import.meta.url))], {
    input: "null\n",
    encoding: "utf8",
  });
  assert.equal(command.status, 2, command.stderr);
  assert.equal(JSON.parse(command.stdout).refusal.reason, "InvalidInput");
});
