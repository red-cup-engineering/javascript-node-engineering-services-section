# Node.js Workspace Analysis

Workspace analysis reads package manifests and source to describe dependency,
package, and type-flow structure.

[Computer Systems Fabrication Engineering][fabrication] owns the maintained
[workspace analysis][workspace] and [Node.js topology][topology] implementation.
Its package exports `analysis/workspace/workspace` and
`analysis/topology/jsnode-topology`.

The following fragments predate that implementation's consolidation in Bare
Cedar Fog commit `8cec1f9a93a3`.

- [September 6 workspace analysis packages](lib/legacy/2026-09-06-4f1f4f2-jsnode-workspace-analysis)
  contains the retained manifests, tests, and source from `jsnode-computer`
  and `jsnode-server`.
- [September 21 workspace analysis app](lib/legacy/2026-09-21-e99cb7c-workspace-analysis-app)
  contains the old CLI and manifest. Its entry point needs the service modules
  that were consolidated into the fabrication package.

[fabrication]: https://github.com/red-cup-engineering/computer-systems-fabrication-life-cycle-engineering-services-section
[workspace]: https://github.com/red-cup-engineering/computer-systems-fabrication-life-cycle-engineering-services-section/tree/main/src/analysis/workspace
[topology]: https://github.com/red-cup-engineering/computer-systems-fabrication-life-cycle-engineering-services-section/blob/main/src/analysis/topology/jsnode-topology.mjs
