# @red-cup-engineering/derive-set-of-duplication-work-intents-service

Turns the duplication graph's cross-package, consumer-backed candidates into structured work intents, one per candidate, so consolidation is dispatched by the platform and never by a session's own reading.

## Operation

~~~js
export function deriveSetOfDuplicationWorkIntents(request)
~~~

### Parameters

- request (object): A record with `candidates` (the `jsnode_duplication` readout's candidates array), `plans` (optional array of `jsnode.duplication-migration.plan` records keyed by `candidate.semanticFingerprint`), `chain` (exactly four admitted chain items: endeavor, campaign, project, plan), `limit` (optional, default 25), and `derivedAt` (optional ISO-8601 string; defaults to the operation's own wall clock, letting a caller pin it for deterministic examples and tests).

### Returns

object: A `DuplicationWorkIntentSet`: `type`, `version: 1`, `derivedAt`, `considered`, `skippedSinglePackage`, `intents` (array of `metroplat.work.structured-intent` inputs).

### Refusals

- TypeError: When `candidates` is not an array, `chain` is not an array of four items, or a `plans` entry lacks `candidate.semanticFingerprint`.

## Command

derive-set-of-duplication-work-intents reads one JSON value per input line and writes one JSON value per output line.

## Examples

### one cross-package candidate with an owner-republish plan

Input:

~~~json
{
  "candidates": [
    {
      "semanticFingerprint": "c5d74f3ac47bd1f96432030d60dd22606d633153c6c945008769123ddde1f1a2",
      "implementations": [
        {
          "name": "praxisFeedbackInterpretation"
        }
      ],
      "packages": [
        "@red-cup-engineering/knowing",
        "@red-cup-engineering/metroplat"
      ],
      "consumers": [
        "a",
        "b",
        "c",
        "d",
        "e",
        "f",
        "g",
        "h"
      ],
      "removableBytes": 2119,
      "existingUpstreamOwner": "@red-cup-engineering/knowing"
    }
  ],
  "plans": [
    {
      "candidate": {
        "semanticFingerprint": "c5d74f3ac47bd1f96432030d60dd22606d633153c6c945008769123ddde1f1a2"
      },
      "owner": "@red-cup-engineering/knowing",
      "ownerExport": {
        "name": "praxisFeedbackInterpretation"
      },
      "refusals": [
        {
          "reason": "owner-republish-required",
          "detail": "@red-cup-engineering/knowing's published 0.1.2 does not yet export \"praxisFeedbackInterpretation\" — publish it, then re-run"
        }
      ]
    }
  ],
  "chain": [
    {
      "cell": "endeavor:ops-561-group",
      "text": "ops.561.group: the ERP/ICS control plane for agents and humans."
    },
    {
      "cell": "campaign:internal-compute-market",
      "parent": "endeavor:ops-561-group",
      "text": "Sell every compute on the internal market."
    },
    {
      "cell": "project:core-stability",
      "parent": "campaign:internal-compute-market",
      "text": "Get the core stable."
    },
    {
      "cell": "plan:2026-09-03-core-stability",
      "parent": "project:core-stability",
      "text": "This week's plan."
    }
  ],
  "derivedAt": "2026-09-05T00:00:00.000Z"
}
~~~

Output:

~~~json
{
  "type": "DuplicationWorkIntentSet",
  "version": 1,
  "derivedAt": "2026-09-05T00:00:00.000Z",
  "considered": 1,
  "skippedSinglePackage": 0,
  "intents": [
    {
      "kind": "metroplat.work.structured-intent",
      "id": "swi:2026-09-05:migrate-c5d74f3ac47b",
      "producer": {
        "id": "derive-set-of-duplication-work-intents",
        "revision": "0.1.1"
      },
      "sources": [
        {
          "id": "admit-set-of-health-work-intents.mjs#CHAIN_ITEMS",
          "kind": "chain-items-source",
          "locator": "admit-set-of-health-work-intents.mjs#CHAIN_ITEMS"
        },
        {
          "id": "jsnode_duplication#c5d74f3ac47bd1f96432030d60dd22606d633153c6c945008769123ddde1f1a2",
          "kind": "jsnode-duplication-candidate",
          "locator": "jsnode_duplication#c5d74f3ac47bd1f96432030d60dd22606d633153c6c945008769123ddde1f1a2"
        },
        {
          "id": "jsnode.duplication-migration.plan#c5d74f3ac47bd1f96432030d60dd22606d633153c6c945008769123ddde1f1a2",
          "kind": "jsnode-duplication-migration-plan",
          "locator": "jsnode.duplication-migration.plan#c5d74f3ac47bd1f96432030d60dd22606d633153c6c945008769123ddde1f1a2"
        }
      ],
      "items": [
        {
          "cell": "endeavor:ops-561-group",
          "text": "ops.561.group: the ERP/ICS control plane for agents and humans.",
          "evidence": [
            "chain item admitted verbatim from CHAIN_ITEMS: ops.561.group: the ERP/ICS control plane for agents and humans."
          ],
          "provenance": [
            {
              "source": "admit-set-of-health-work-intents.mjs#CHAIN_ITEMS",
              "evidence": [
                "ops.561.group: the ERP/ICS control plane for agents and humans."
              ]
            }
          ]
        },
        {
          "cell": "campaign:internal-compute-market",
          "parent": "endeavor:ops-561-group",
          "text": "Sell every compute on the internal market.",
          "evidence": [
            "chain item admitted verbatim from CHAIN_ITEMS: Sell every compute on the internal market."
          ],
          "provenance": [
            {
              "source": "admit-set-of-health-work-intents.mjs#CHAIN_ITEMS",
              "evidence": [
                "Sell every compute on the internal market."
              ]
            }
          ]
        },
        {
          "cell": "project:core-stability",
          "parent": "campaign:internal-compute-market",
          "text": "Get the core stable.",
          "evidence": [
            "chain item admitted verbatim from CHAIN_ITEMS: Get the core stable."
          ],
          "provenance": [
            {
              "source": "admit-set-of-health-work-intents.mjs#CHAIN_ITEMS",
              "evidence": [
                "Get the core stable."
              ]
            }
          ]
        },
        {
          "cell": "plan:2026-09-03-core-stability",
          "parent": "project:core-stability",
          "text": "This week's plan.",
          "evidence": [
            "chain item admitted verbatim from CHAIN_ITEMS: This week's plan."
          ],
          "provenance": [
            {
              "source": "admit-set-of-health-work-intents.mjs#CHAIN_ITEMS",
              "evidence": [
                "This week's plan."
              ]
            }
          ]
        },
        {
          "cell": "task:migrate-consumer-c5d74f3ac47b",
          "parent": "plan:2026-09-03-core-stability",
          "text": "praxisFeedbackInterpretation copied in @red-cup-engineering/knowing, @red-cup-engineering/metroplat with 8 consumers, removable 2119 bytes. owner=`@red-cup-engineering/knowing`. first step: publish `@red-cup-engineering/knowing` exporting `praxisFeedbackInterpretation`, then apply the plan. gate: the plan applies (`jsnode-computer duplication-migration --apply`), the consumers' tests pass, the owner is published, and `jsnode_duplication` no longer lists `c5d74f3ac47b`. modality=MUST force=necessary horizon=now",
          "evidence": [
            "8 consumers",
            "removableBytes=2119"
          ],
          "provenance": [
            {
              "source": "jsnode_duplication#c5d74f3ac47bd1f96432030d60dd22606d633153c6c945008769123ddde1f1a2",
              "evidence": [
                "removableBytes=2119",
                "consumers=8"
              ]
            },
            {
              "source": "jsnode.duplication-migration.plan#c5d74f3ac47bd1f96432030d60dd22606d633153c6c945008769123ddde1f1a2",
              "evidence": [
                "owner-republish-required: @red-cup-engineering/knowing's published 0.1.2 does not yet export \"praxisFeedbackInterpretation\" — publish it, then re-run"
              ]
            }
          ]
        }
      ]
    }
  ]
}
~~~
