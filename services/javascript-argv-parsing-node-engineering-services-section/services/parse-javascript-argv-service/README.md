# parse-javascript-argv-service

Transforms a supplied JavaScript-host argument vector into admitted command arguments:
`argument`, `requiredArgument` and `repeatedArgument` read flag values; `parseJavascriptArgv`
reads a complete `JavascriptArgvParsingRequest` carrier into a `JavascriptArgvParseRead`;
`parseArgv` reads a vector against a set of valued options. It owns no process execution,
standard streams, help rendering or application-specific option policy.
