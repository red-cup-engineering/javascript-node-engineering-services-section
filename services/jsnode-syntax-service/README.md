# jsnode-syntax-service

Reads JavaScript source as admitted syntax for Node. It parses with `javascript-parser-service` and
projects what callers need: tokens and source records, module requests and exports, a module's
operation arguments, and portable codemod plans (module-specifier rewrites, package collapse) that
apply only to the exact source they admitted and return a receipt. It does not touch the file system.
