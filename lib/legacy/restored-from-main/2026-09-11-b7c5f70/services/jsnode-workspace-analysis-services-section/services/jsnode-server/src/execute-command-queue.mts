/**
 * execute-command-queue — an in-process FIFO serializing concurrent
 * execute_command calls onto this one persistent server process.
 *
 * Every session that connects to the already-shared, already-running
 * jsnode-server process shares this one queue: a plain promise chain, not a
 * new dependency, not a lock file on disk. Two `execute_command` calls
 * arriving from two different sessions at the same moment do not run their
 * child processes concurrently against each other; the second call's work
 * does not even start until the first call's process has exited. This is
 * the actual coordination point for the disk/process-I/O race this tool was
 * built to close: one shared process, one shared queue, real serialization
 * inside it — not a claim that serialization happened, a queue that forces
 * it to.
 *
 * A rejected (or throwing) task never wedges the queue: the tasks enqueued
 * after it still run once their turn comes.
 */
export interface ExecuteCommandQueue {
  /** Runs `task` only after every task enqueued before it has settled
   *  (resolved or rejected), and returns exactly `task`'s own outcome. */
  enqueue<T>(task: () => Promise<T> | T): Promise<T>;
}

export function createExecuteCommandQueue(): ExecuteCommandQueue {
  // `tail` always settles to `undefined` — it is bookkeeping for "when is it
  // this task's turn," never the caller-visible result. The caller-visible
  // result is `started`, returned untouched (rejection included) below.
  let tail: Promise<void> = Promise.resolve();
  return {
    enqueue<T>(task: () => Promise<T> | T): Promise<T> {
      const started = tail.then(() => task());
      tail = started.then(
        () => undefined,
        () => undefined,
      );
      return started;
    },
  };
}
