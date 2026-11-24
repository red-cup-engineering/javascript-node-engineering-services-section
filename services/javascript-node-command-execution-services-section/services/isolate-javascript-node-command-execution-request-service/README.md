# isolate-javascript-node-command-execution-request-service

Wraps an exact `JavascriptNodeCommandExecutionRequest@1` so its program runs inside a bubblewrap sandbox: every
namespace unshared, the host filesystem read-only, hidden directories masked, readable and writable directories
re-opened in order. The result is again one exact request, executed by whichever command executor the caller chooses.
