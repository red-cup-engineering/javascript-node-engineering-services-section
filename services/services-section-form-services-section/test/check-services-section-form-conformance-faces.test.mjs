import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkServicesSectionFormConformance as boundOperation } from "../scripts/check-services-section-form-conformance.mjs";
import { law } from "./section-law-fixture.mjs";
const checkServicesSectionFormConformance = (form) => boundOperation(form, law.schema);

const examples = [
  {
    "type": "JavascriptNodeOperationExample",
    "name": "the schema's own fully-populated engineering worked example is conformant",
    "input": {
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
    },
    "output": {
      "conformant": true,
      "obstructions": []
    }
  },
  {
    "type": "JavascriptNodeOperationExample",
    "name": "a data.other entry obstructs conformance at /data/other",
    "input": {
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
        "other": [
          "stray-topic"
        ]
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
    },
    "output": {
      "conformant": false,
      "obstructions": [
        {
          "kind": "instance",
          "path": "/data/other",
          "keyword": "maxItems",
          "message": "must NOT have more than 0 items"
        }
      ]
    }
  }
];

for (const example of examples) {
  test(example.name, async () => {
    const importedOutput = await checkServicesSectionFormConformance(example.input);
    assert.deepEqual(importedOutput, example.output);
    const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/check-services-section-form-conformance.mjs", import.meta.url))], {
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
  const command = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/check-services-section-form-conformance.mjs", import.meta.url)), "--help"], {
    input: "not-json\n",
    encoding: "utf8",
  });
  assert.equal(command.status, 0, command.stderr);
  assert.equal(command.stdout, "checkServicesSectionFormConformance — Checks a ServicesSectionForm record for conformance against services-section-form.schema.json, composing @red-cup-engineering/computer-data-engine for the whole judgment.\n");
});
