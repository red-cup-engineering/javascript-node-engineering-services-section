# @red-cup-engineering/admit-javascript-node-command-execution-request-service

Admits a candidate as an exact JavascriptNodeCommandExecutionRequest@1, unchanged.

## Operation

~~~js
export function admitJavascriptNodeCommandExecutionRequest(request)
~~~

### Parameters

- request (object): A candidate JavascriptNodeCommandExecutionRequest.

### Returns

object: The same request, admitted.

## Command

admit-javascript-node-command-execution-request reads one JSON value per input line and writes one JSON value per output line.

## Examples

### admits a valid request unchanged

Input:

~~~json
{
  "type": "JavascriptNodeCommandExecutionRequest",
  "version": 1,
  "command": "node",
  "arguments": [
    "--version"
  ],
  "directory": "/tmp",
  "environment": null,
  "input": null
}
~~~

Output:

~~~json
{
  "type": "JavascriptNodeCommandExecutionRequest",
  "version": 1,
  "command": "node",
  "arguments": [
    "--version"
  ],
  "directory": "/tmp",
  "environment": null,
  "input": null
}
~~~
