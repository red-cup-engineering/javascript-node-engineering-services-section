/**
 * The house ECMAScript parser: JavaScript source text in, an ESTree `Program`
 * out. Plain Node, no dependency. Every node carries `start` and `end` source
 * offsets; the program carries every comment (`comments`) and every token
 * (`tokens`) in source order. Covers the ES2024 language the house writes:
 * modules and scripts, classes with private members and static blocks,
 * async functions and generators, destructuring, spread, optional chaining,
 * template literals, regular expressions, BigInt, numeric separators, import
 * attributes, `import.meta` and dynamic `import()`. JSX and TypeScript are not
 * JavaScript and are refused as syntax errors.
 *
 * A syntax error throws a `SyntaxError` whose `pos`, `line` and `column` name
 * where parsing stopped.
 */

const KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
  "else", "export", "extends", "finally", "for", "function", "if", "import", "in", "instanceof",
  "new", "return", "super", "switch", "this", "throw", "try", "typeof", "var", "void", "while",
  "with", "null", "true", "false",
]);

const BINARY_PRECEDENCE = new Map([
  ["??", 1], ["||", 2], ["&&", 3], ["|", 4], ["^", 5], ["&", 6],
  ["==", 7], ["!=", 7], ["===", 7], ["!==", 7],
  ["<", 8], [">", 8], ["<=", 8], [">=", 8], ["instanceof", 8], ["in", 8],
  ["<<", 9], [">>", 9], [">>>", 9],
  ["+", 10], ["-", 10], ["*", 11], ["/", 11], ["%", 11], ["**", 12],
]);

const ASSIGNMENT_OPERATORS = new Set([
  "=", "+=", "-=", "*=", "/=", "%=", "**=", "<<=", ">>=", ">>>=", "&=", "|=", "^=", "&&=", "||=", "??=",
]);

// Longest punctuators first so the scanner can take the first match.
const PUNCTUATORS = [
  ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
  "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "/=", "%=",
  "&=", "|=", "^=", "<<", ">>", "**",
  "{", "}", "(", ")", "[", "]", ";", ",", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^", "!",
  "~", "?", ":", "=", ".", "@",
];

const ID_START = /[\p{ID_Start}$_]/u;
const ID_CONTINUE = /[\p{ID_Continue}$_\u200C\u200D]/u;
const LINE_TERMINATOR = /[\n\r\u2028\u2029]/u;

function isIdStart(ch) { return ch !== undefined && ID_START.test(ch); }
function isIdContinue(ch) { return ch !== undefined && ID_CONTINUE.test(ch); }
function isDigit(code) { return code >= 48 && code <= 57; }

/** Line and column (both counted from 1) of a source offset. */
export function lineColumnOf(text, pos) {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < pos && index < text.length; index += 1) {
    const ch = text[index];
    if (ch === "\n" || ch === "\u2028" || ch === "\u2029" || (ch === "\r" && text[index + 1] !== "\n")) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: pos - lineStart + 1 };
}

function fail(text, pos, message) {
  const { line, column } = lineColumnOf(text, pos);
  const error = new SyntaxError(`${message} (${line}:${column})`);
  error.pos = pos;
  error.line = line;
  error.column = column;
  throw error;
}

// ── scanner ──────────────────────────────────────────────────────────────────

class Scanner {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.braces = [];
    this.comments = [];
    this.commentSeen = new Set();
    if (text.startsWith("#!")) {
      const end = text.search(LINE_TERMINATOR);
      const stop = end < 0 ? text.length : end;
      this.comments.push({ type: "Hashbang", value: text.slice(2, stop), start: 0, end: stop });
      this.commentSeen.add(0);
      this.pos = stop;
    }
  }

  state() { return { pos: this.pos, braces: [...this.braces] }; }
  restore(state) { this.pos = state.pos; this.braces = [...state.braces]; }

  recordComment(type, value, start, end) {
    if (this.commentSeen.has(start)) return;
    this.commentSeen.add(start);
    this.comments.push({ type, value, start, end });
  }

  /** Skip whitespace and comments; report whether a line terminator was crossed. */
  skipSpace() {
    const text = this.text;
    let newline = false;
    while (this.pos < text.length) {
      const ch = text[this.pos];
      if (ch === " " || ch === "\t" || ch === "\v" || ch === "\f" || ch === "\u00a0" || ch === "\ufeff" || /\s/u.test(ch) && !LINE_TERMINATOR.test(ch)) {
        this.pos += 1;
      } else if (LINE_TERMINATOR.test(ch)) {
        newline = true;
        this.pos += 1;
      } else if (ch === "/" && text[this.pos + 1] === "/") {
        const start = this.pos;
        let end = this.pos + 2;
        while (end < text.length && !LINE_TERMINATOR.test(text[end])) end += 1;
        this.recordComment("Line", text.slice(start + 2, end), start, end);
        this.pos = end;
      } else if (ch === "/" && text[this.pos + 1] === "*") {
        const start = this.pos;
        const close = text.indexOf("*/", start + 2);
        if (close < 0) fail(text, start, "Unterminated comment");
        const body = text.slice(start + 2, close);
        if (LINE_TERMINATOR.test(body)) newline = true;
        this.recordComment("Block", body, start, close + 2);
        this.pos = close + 2;
      } else {
        break;
      }
    }
    return newline;
  }

  /** Read the next token. `/` is always read as a punctuator; the parser rescans a regex. */
  next() {
    const newlineBefore = this.skipSpace();
    const text = this.text;
    const start = this.pos;
    if (start >= text.length) return { type: "eof", value: "", start, end: start, newlineBefore };
    const ch = text[start];
    const code = text.charCodeAt(start);

    if (ch === "`") return this.readTemplate(start, newlineBefore, true);
    if (ch === "}" && this.braces.length > 0 && this.braces[this.braces.length - 1] === "template") {
      this.braces.pop();
      return this.readTemplate(start, newlineBefore, false);
    }
    if (ch === '"' || ch === "'") return this.readString(start, ch, newlineBefore);
    if (isDigit(code) || (ch === "." && isDigit(text.charCodeAt(start + 1)))) return this.readNumber(start, newlineBefore);
    if (ch === "#" && start + 1 < text.length && (isIdStart(text[start + 1]) || text[start + 1] === "\\")) {
      this.pos = start + 1;
      const name = this.readWord();
      return { type: "privateName", value: name, start, end: this.pos, newlineBefore };
    }
    if (isIdStart(this.codePointAt(start)) || ch === "\\") {
      const raw = this.readWord();
      return { type: "name", value: raw, start, end: this.pos, newlineBefore };
    }
    for (const punctuator of PUNCTUATORS) {
      if (text.startsWith(punctuator, start)) {
        // `?.` followed by a digit is a conditional followed by a number.
        if (punctuator === "?." && isDigit(text.charCodeAt(start + 2))) continue;
        this.pos = start + punctuator.length;
        if (punctuator === "{") this.braces.push("brace");
        else if (punctuator === "}") this.braces.pop();
        return { type: "punct", value: punctuator, start, end: this.pos, newlineBefore };
      }
    }
    fail(text, start, `Unexpected character ${JSON.stringify(ch)}`);
  }

  codePointAt(pos) {
    const point = this.text.codePointAt(pos);
    return point === undefined ? undefined : String.fromCodePoint(point);
  }

  readWord() {
    const text = this.text;
    let word = "";
    let first = true;
    while (this.pos < text.length) {
      const ch = this.codePointAt(this.pos);
      if (ch === "\\") {
        if (text[this.pos + 1] !== "u") fail(text, this.pos, "Invalid escape in identifier");
        this.pos += 2;
        const decoded = this.readUnicodeEscapeBody();
        word += decoded;
      } else if (first ? isIdStart(ch) : isIdContinue(ch)) {
        word += ch;
        this.pos += ch.length;
      } else {
        break;
      }
      first = false;
    }
    return word;
  }

  readUnicodeEscapeBody() {
    const text = this.text;
    if (text[this.pos] === "{") {
      const close = text.indexOf("}", this.pos);
      if (close < 0) fail(text, this.pos, "Invalid Unicode escape");
      const point = Number.parseInt(text.slice(this.pos + 1, close), 16);
      if (!Number.isFinite(point) || point > 0x10ffff) fail(text, this.pos, "Invalid Unicode escape");
      this.pos = close + 1;
      return String.fromCodePoint(point);
    }
    const hex = text.slice(this.pos, this.pos + 4);
    if (!/^[0-9a-fA-F]{4}$/u.test(hex)) fail(text, this.pos, "Invalid Unicode escape");
    this.pos += 4;
    return String.fromCharCode(Number.parseInt(hex, 16));
  }

  readNumber(start, newlineBefore) {
    const text = this.text;
    let pos = start;
    let bigint = false;
    const radixDigits = (pattern) => {
      const begin = pos;
      while (pos < text.length && (pattern.test(text[pos]) || text[pos] === "_")) pos += 1;
      if (pos === begin) fail(text, pos, "Expected number digits");
    };
    if (text[pos] === "0" && /[xXoObB]/u.test(text[pos + 1] ?? "")) {
      const kind = text[pos + 1].toLowerCase();
      pos += 2;
      radixDigits(kind === "x" ? /[0-9a-fA-F]/u : kind === "o" ? /[0-7]/u : /[01]/u);
      if (text[pos] === "n") { bigint = true; pos += 1; }
    } else {
      while (pos < text.length && (isDigit(text.charCodeAt(pos)) || text[pos] === "_")) pos += 1;
      let decimal = false;
      if (text[pos] === ".") {
        decimal = true;
        pos += 1;
        while (pos < text.length && (isDigit(text.charCodeAt(pos)) || text[pos] === "_")) pos += 1;
      }
      if (text[pos] === "e" || text[pos] === "E") {
        decimal = true;
        pos += 1;
        if (text[pos] === "+" || text[pos] === "-") pos += 1;
        const begin = pos;
        while (pos < text.length && (isDigit(text.charCodeAt(pos)) || text[pos] === "_")) pos += 1;
        if (pos === begin) fail(text, pos, "Invalid exponent");
      }
      if (!decimal && text[pos] === "n") { bigint = true; pos += 1; }
    }
    if (isIdStart(text[pos])) fail(text, pos, "Identifier directly after number");
    this.pos = pos;
    const raw = text.slice(start, pos);
    const clean = raw.replaceAll("_", "");
    let value;
    if (bigint) value = BigInt(clean.slice(0, -1));
    else if (/^0[0-7]+$/u.test(clean)) value = Number.parseInt(clean, 8);
    else value = Number(clean);
    return { type: "num", value, raw, bigint: bigint ? clean.slice(0, -1) : undefined, start, end: pos, newlineBefore };
  }

  readEscape(inTemplate) {
    const text = this.text;
    const ch = text[this.pos];
    this.pos += 1;
    switch (ch) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "b": return "\b";
      case "f": return "\f";
      case "v": return "\v";
      case "0":
        if (isDigit(text.charCodeAt(this.pos))) {
          if (inTemplate) return null;
          return this.readLegacyOctal(ch);
        }
        return "\0";
      case "x": {
        const hex = text.slice(this.pos, this.pos + 2);
        if (!/^[0-9a-fA-F]{2}$/u.test(hex)) { if (inTemplate) return null; fail(text, this.pos, "Invalid hexadecimal escape"); }
        this.pos += 2;
        return String.fromCharCode(Number.parseInt(hex, 16));
      }
      case "u": {
        if (inTemplate) {
          const save = this.pos;
          try { return this.readUnicodeEscapeBody(); } catch { this.pos = save; return null; }
        }
        return this.readUnicodeEscapeBody();
      }
      case "\r":
        if (text[this.pos] === "\n") this.pos += 1;
        return "";
      case "\n": case "\u2028": case "\u2029":
        return "";
      default:
        if (ch >= "1" && ch <= "7") {
          if (inTemplate) return null;
          return this.readLegacyOctal(ch);
        }
        if (ch === "8" || ch === "9") { if (inTemplate) return null; return ch; }
        return ch;
    }
  }

  readLegacyOctal(first) {
    let digits = first;
    while (digits.length < 3 && /[0-7]/u.test(this.text[this.pos] ?? "") && Number.parseInt(digits + this.text[this.pos], 8) <= 255) {
      digits += this.text[this.pos];
      this.pos += 1;
    }
    return String.fromCharCode(Number.parseInt(digits, 8));
  }

  readString(start, quote, newlineBefore) {
    const text = this.text;
    this.pos = start + 1;
    let value = "";
    for (;;) {
      if (this.pos >= text.length) fail(text, start, "Unterminated string");
      const ch = text[this.pos];
      if (ch === quote) { this.pos += 1; break; }
      if (ch === "\\") { this.pos += 1; value += this.readEscape(false); continue; }
      if (ch === "\n" || ch === "\r") fail(text, this.pos, "Unterminated string");
      value += ch;
      this.pos += 1;
    }
    return { type: "string", value, raw: text.slice(start, this.pos), start, end: this.pos, newlineBefore };
  }

  readTemplate(start, newlineBefore, opening) {
    const text = this.text;
    this.pos = start + 1;
    let cooked = "";
    let invalid = false;
    const chunkStart = this.pos;
    for (;;) {
      if (this.pos >= text.length) fail(text, start, "Unterminated template");
      const ch = text[this.pos];
      if (ch === "`") {
        const raw = text.slice(chunkStart, this.pos);
        this.pos += 1;
        return { type: "template", value: invalid ? null : cooked, raw, tail: true, opening, start, end: this.pos, newlineBefore };
      }
      if (ch === "$" && text[this.pos + 1] === "{") {
        const raw = text.slice(chunkStart, this.pos);
        this.pos += 2;
        this.braces.push("template");
        return { type: "template", value: invalid ? null : cooked, raw, tail: false, opening, start, end: this.pos, newlineBefore };
      }
      if (ch === "\\") {
        this.pos += 1;
        const escaped = this.readEscape(true);
        if (escaped === null) invalid = true; else cooked += escaped;
        continue;
      }
      if (ch === "\r") {
        cooked += "\n";
        this.pos += text[this.pos + 1] === "\n" ? 2 : 1;
        continue;
      }
      cooked += ch;
      this.pos += 1;
    }
  }

  /** Rescan from `start` as a regular expression literal. */
  readRegExp(start, newlineBefore) {
    const text = this.text;
    let pos = start + 1;
    let inClass = false;
    for (;;) {
      if (pos >= text.length || LINE_TERMINATOR.test(text[pos])) fail(text, start, "Unterminated regular expression");
      const ch = text[pos];
      if (ch === "\\") { pos += 2; continue; }
      if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) break;
      pos += 1;
    }
    const pattern = text.slice(start + 1, pos);
    pos += 1;
    const flagsStart = pos;
    while (pos < text.length && isIdContinue(text[pos])) pos += 1;
    const flags = text.slice(flagsStart, pos);
    if (!/^[dgimsuvy]*$/u.test(flags)) fail(text, flagsStart, "Invalid regular expression flags");
    this.pos = pos;
    let value = null;
    try { value = new RegExp(pattern, flags); } catch { value = null; }
    return { type: "regexp", value, regex: { pattern, flags }, raw: text.slice(start, pos), start, end: pos, newlineBefore };
  }
}

// ── parser ───────────────────────────────────────────────────────────────────

class Parser {
  constructor(text, options) {
    this.text = text;
    this.sourceType = options.sourceType ?? "module";
    this.scanner = new Scanner(text);
    this.tokens = [];
    this.inFunction = false;
    this.inAsync = this.sourceType === "module";
    this.inGenerator = false;
    this.inClassField = false;
    this.lastEnd = 0;
    this.token = this.scanner.next();
  }

  // token plumbing
  advance() {
    this.lastEnd = this.token.end;
    this.tokens.push(this.token);
    this.token = this.scanner.next();
  }

  peek() {
    const state = this.scanner.state();
    const token = this.scanner.next();
    this.scanner.restore(state);
    return token;
  }

  is(value) { return (this.token.type === "punct" || this.token.type === "name") && this.token.value === value; }
  isName(value) { return this.token.type === "name" && this.token.value === value; }
  eat(value) { if (this.is(value)) { this.advance(); return true; } return false; }
  expect(value) { if (!this.eat(value)) this.unexpected(`Expected ${JSON.stringify(value)}`); }

  unexpected(message) {
    const shown = this.token.type === "eof" ? "end of input" : JSON.stringify(this.text.slice(this.token.start, this.token.end));
    fail(this.text, this.token.start, message ?? `Unexpected ${shown}`);
  }

  canInsertSemicolon() { return this.token.type === "eof" || this.is("}") || this.token.newlineBefore; }
  semicolon() { if (!this.eat(";") && !this.canInsertSemicolon()) this.unexpected("Expected \";\""); }

  finish(node, start) {
    node.start = start;
    node.end = this.lastEnd;
    return node;
  }

  identifierName() {
    if (this.token.type !== "name") this.unexpected("Expected an identifier");
    const start = this.token.start;
    const name = this.token.value;
    this.advance();
    return this.finish({ type: "Identifier", name }, start);
  }

  bindingIdentifier() {
    if (this.token.type !== "name" || (KEYWORDS.has(this.token.value) && !this.isContextualBinding())) this.unexpected("Expected an identifier");
    return this.identifierName();
  }

  isContextualBinding() { return false; }

  isIdentifierReference() {
    if (this.token.type !== "name") return false;
    const name = this.token.value;
    if (KEYWORDS.has(name)) return false;
    if (name === "yield" && this.inGenerator) return false;
    if (name === "await" && this.inAsync) return false;
    return true;
  }

  // program and statements
  parseProgram() {
    const body = [];
    while (this.token.type !== "eof") body.push(this.parseStatement(true));
    const program = { type: "Program", sourceType: this.sourceType, body, start: 0, end: this.text.length };
    program.comments = this.scanner.comments.sort((left, right) => left.start - right.start);
    program.tokens = this.tokens;
    return program;
  }

  parseStatement(topLevel = false) {
    const token = this.token;
    const start = token.start;
    if (token.type === "punct") {
      if (token.value === "{") return this.parseBlock();
      if (token.value === ";") { this.advance(); return this.finish({ type: "EmptyStatement" }, start); }
    }
    if (token.type === "name") {
      switch (token.value) {
        case "var": case "const": return this.parseVariableStatement();
        case "let": {
          const next = this.peek();
          if (next.type === "name" && !["in", "instanceof"].includes(next.value) || next.value === "[" || next.value === "{") return this.parseVariableStatement();
          break;
        }
        case "function": return this.parseFunction(start, true, false);
        case "async": {
          const next = this.peek();
          if (next.type === "name" && next.value === "function" && !next.newlineBefore) {
            this.advance();
            return this.parseFunction(start, true, true);
          }
          break;
        }
        case "class": return this.parseClass(start, true);
        case "if": return this.parseIf();
        case "for": return this.parseFor();
        case "while": {
          this.advance();
          const test = this.parseParenExpression();
          const body = this.parseStatement();
          return this.finish({ type: "WhileStatement", test, body }, start);
        }
        case "do": {
          this.advance();
          const body = this.parseStatement();
          this.expect("while");
          const test = this.parseParenExpression();
          this.eat(";");
          return this.finish({ type: "DoWhileStatement", body, test }, start);
        }
        case "return": {
          this.advance();
          const argument = this.canInsertSemicolon() || this.is(";") ? null : this.parseExpression();
          this.semicolon();
          return this.finish({ type: "ReturnStatement", argument }, start);
        }
        case "break": case "continue": {
          this.advance();
          let label = null;
          if (this.token.type === "name" && !this.token.newlineBefore && !KEYWORDS.has(this.token.value)) label = this.identifierName();
          this.semicolon();
          return this.finish({ type: token.value === "break" ? "BreakStatement" : "ContinueStatement", label }, start);
        }
        case "throw": {
          this.advance();
          if (this.token.newlineBefore) this.unexpected("Illegal newline after throw");
          const argument = this.parseExpression();
          this.semicolon();
          return this.finish({ type: "ThrowStatement", argument }, start);
        }
        case "try": return this.parseTry();
        case "switch": return this.parseSwitch();
        case "debugger": this.advance(); this.semicolon(); return this.finish({ type: "DebuggerStatement" }, start);
        case "with": {
          this.advance();
          const object = this.parseParenExpression();
          const body = this.parseStatement();
          return this.finish({ type: "WithStatement", object, body }, start);
        }
        case "import": {
          const next = this.peek();
          if (next.value !== "(" && next.value !== ".") {
            if (!topLevel) this.unexpected("import declarations may only appear at top level");
            return this.parseImport();
          }
          break;
        }
        case "export":
          if (!topLevel) this.unexpected("export declarations may only appear at top level");
          return this.parseExport();
        default: break;
      }
      if (this.isIdentifierReference() || token.value === "yield" || token.value === "await") {
        const next = this.peek();
        if (next.type === "punct" && next.value === ":" && this.isIdentifierReference()) {
          const label = this.identifierName();
          this.advance();
          const body = this.parseStatement();
          return this.finish({ type: "LabeledStatement", label, body }, start);
        }
      }
    }
    const expression = this.parseExpression();
    this.semicolon();
    return this.finish({ type: "ExpressionStatement", expression }, start);
  }

  parseBlock() {
    const start = this.token.start;
    this.expect("{");
    const body = [];
    while (!this.is("}")) {
      if (this.token.type === "eof") this.unexpected();
      body.push(this.parseStatement());
    }
    this.advance();
    return this.finish({ type: "BlockStatement", body }, start);
  }

  parseParenExpression() {
    this.expect("(");
    const expression = this.parseExpression();
    this.expect(")");
    return expression;
  }

  parseIf() {
    const start = this.token.start;
    this.advance();
    const test = this.parseParenExpression();
    const consequent = this.parseStatement();
    const alternate = this.eat("else") ? this.parseStatement() : null;
    return this.finish({ type: "IfStatement", test, consequent, alternate }, start);
  }

  parseVariableStatement() {
    const declaration = this.parseVariableDeclaration(false);
    this.semicolon();
    declaration.end = this.lastEnd;
    return declaration;
  }

  parseVariableDeclaration(noIn) {
    const start = this.token.start;
    const kind = this.token.value;
    this.advance();
    const declarations = [];
    do {
      const declaratorStart = this.token.start;
      const id = this.parseBindingTarget();
      const init = this.eat("=") ? this.parseAssignment(noIn) : null;
      declarations.push(this.finish({ type: "VariableDeclarator", id, init }, declaratorStart));
    } while (this.eat(","));
    return this.finish({ type: "VariableDeclaration", kind, declarations }, start);
  }

  parseBindingTarget() {
    if (this.is("[")) return this.parseArrayPattern();
    if (this.is("{")) return this.parseObjectPattern();
    return this.bindingIdentifierLoose();
  }

  bindingIdentifierLoose() {
    if (this.token.type !== "name" || (KEYWORDS.has(this.token.value))) this.unexpected("Expected a binding name");
    return this.identifierName();
  }

  parseBindingElement() {
    const start = this.token.start;
    const target = this.parseBindingTarget();
    if (this.eat("=")) {
      const right = this.parseAssignment(false);
      return this.finish({ type: "AssignmentPattern", left: target, right }, start);
    }
    return target;
  }

  parseArrayPattern() {
    const start = this.token.start;
    this.expect("[");
    const elements = [];
    while (!this.is("]")) {
      if (this.is(",")) { this.advance(); elements.push(null); continue; }
      if (this.is("...")) {
        const restStart = this.token.start;
        this.advance();
        const argument = this.parseBindingTarget();
        elements.push(this.finish({ type: "RestElement", argument }, restStart));
      } else {
        elements.push(this.parseBindingElement());
      }
      if (!this.is("]")) this.expect(",");
    }
    this.advance();
    return this.finish({ type: "ArrayPattern", elements }, start);
  }

  parseObjectPattern() {
    const start = this.token.start;
    this.expect("{");
    const properties = [];
    while (!this.is("}")) {
      const propertyStart = this.token.start;
      if (this.is("...")) {
        this.advance();
        const argument = this.parseBindingTarget();
        properties.push(this.finish({ type: "RestElement", argument }, propertyStart));
      } else {
        const { key, computed } = this.parsePropertyName();
        let value;
        let shorthand = false;
        if (this.eat(":")) {
          value = this.parseBindingElement();
        } else {
          if (key.type !== "Identifier") this.unexpected();
          shorthand = true;
          value = { type: "Identifier", name: key.name, start: key.start, end: key.end };
          if (this.eat("=")) {
            const right = this.parseAssignment(false);
            value = this.finish({ type: "AssignmentPattern", left: value, right }, propertyStart);
          }
        }
        properties.push(this.finish({ type: "Property", key, value, kind: "init", method: false, shorthand, computed }, propertyStart));
      }
      if (!this.is("}")) this.expect(",");
    }
    this.advance();
    return this.finish({ type: "ObjectPattern", properties }, start);
  }

  parseFor() {
    const start = this.token.start;
    this.advance();
    let isAwait = false;
    if (this.isName("await")) { isAwait = true; this.advance(); }
    this.expect("(");
    let init = null;
    if (this.is(";")) {
      // no initializer
    } else if (this.isName("var") || this.isName("const") || (this.isName("let") && (() => { const next = this.peek(); return next.type === "name" || next.value === "[" || next.value === "{"; })())) {
      init = this.parseVariableDeclaration(true);
    } else {
      init = this.parseExpression(true);
    }
    if (init && (this.isName("of") || this.is("in"))) {
      const kind = this.isName("of") ? "ForOfStatement" : "ForInStatement";
      this.advance();
      const left = init.type === "VariableDeclaration" ? init : this.toAssignable(init);
      const right = kind === "ForOfStatement" ? this.parseAssignment(false) : this.parseExpression();
      this.expect(")");
      const body = this.parseStatement();
      const node = { type: kind, left, right, body };
      if (kind === "ForOfStatement") node.await = isAwait;
      return this.finish(node, start);
    }
    this.expect(";");
    const test = this.is(";") ? null : this.parseExpression();
    this.expect(";");
    const update = this.is(")") ? null : this.parseExpression();
    this.expect(")");
    const body = this.parseStatement();
    return this.finish({ type: "ForStatement", init, test, update, body }, start);
  }

  parseTry() {
    const start = this.token.start;
    this.advance();
    const block = this.parseBlock();
    let handler = null;
    if (this.isName("catch")) {
      const catchStart = this.token.start;
      this.advance();
      let param = null;
      if (this.eat("(")) {
        param = this.parseBindingTarget();
        this.expect(")");
      }
      const body = this.parseBlock();
      handler = this.finish({ type: "CatchClause", param, body }, catchStart);
    }
    const finalizer = this.eat("finally") ? this.parseBlock() : null;
    if (!handler && !finalizer) this.unexpected("Missing catch or finally after try");
    return this.finish({ type: "TryStatement", block, handler, finalizer }, start);
  }

  parseSwitch() {
    const start = this.token.start;
    this.advance();
    const discriminant = this.parseParenExpression();
    this.expect("{");
    const cases = [];
    while (!this.is("}")) {
      const caseStart = this.token.start;
      let test = null;
      if (this.eat("case")) test = this.parseExpression();
      else this.expect("default");
      this.expect(":");
      const consequent = [];
      while (!this.is("case") && !this.is("default") && !this.is("}")) consequent.push(this.parseStatement());
      cases.push(this.finish({ type: "SwitchCase", test, consequent }, caseStart));
    }
    this.advance();
    return this.finish({ type: "SwitchStatement", discriminant, cases }, start);
  }

  // functions and classes
  parseFunction(start, isStatement, isAsync, allowAnonymous = false) {
    this.expect("function");
    const generator = this.eat("*");
    let id = null;
    if (this.token.type === "name" && !this.is("(")) id = this.identifierName();
    else if (isStatement && !allowAnonymous) this.unexpected("Expected a function name");
    const { params, body } = this.parseFunctionRest(isAsync, generator);
    return this.finish({ type: isStatement ? "FunctionDeclaration" : "FunctionExpression", id, expression: false, generator, async: isAsync, params, body }, start);
  }

  parseFunctionRest(isAsync, generator) {
    const saved = [this.inFunction, this.inAsync, this.inGenerator];
    this.inFunction = true;
    this.inAsync = isAsync;
    this.inGenerator = generator;
    const params = this.parseParams();
    const body = this.parseBlock();
    [this.inFunction, this.inAsync, this.inGenerator] = saved;
    return { params, body };
  }

  parseParams() {
    this.expect("(");
    const params = [];
    while (!this.is(")")) {
      if (this.is("...")) {
        const start = this.token.start;
        this.advance();
        const argument = this.parseBindingTarget();
        params.push(this.finish({ type: "RestElement", argument }, start));
      } else {
        params.push(this.parseBindingElement());
      }
      if (!this.is(")")) this.expect(",");
    }
    this.advance();
    return params;
  }

  parseClass(start, isStatement, allowAnonymous = false) {
    this.expect("class");
    let id = null;
    if (this.token.type === "name" && !this.is("extends") && !this.is("{")) id = this.identifierName();
    else if (isStatement && !allowAnonymous) this.unexpected("Expected a class name");
    // ClassHeritage is a LeftHandSideExpression, including constructor factories.
    const superClass = this.eat("extends") ? this.parseSubscripts(this.parseExpressionAtom(), true) : null;
    const bodyStart = this.token.start;
    this.expect("{");
    const body = [];
    while (!this.is("}")) {
      if (this.eat(";")) continue;
      body.push(this.parseClassMember());
    }
    this.advance();
    const classBody = this.finish({ type: "ClassBody", body }, bodyStart);
    return this.finish({ type: isStatement ? "ClassDeclaration" : "ClassExpression", id, superClass, body: classBody }, start);
  }

  parseClassMember() {
    const start = this.token.start;
    let isStatic = false;
    let kind = "method";
    let isAsync = false;
    let generator = false;
    const modifierFollows = () => {
      const next = this.peek();
      return !(next.type === "punct" && ["(", "=", ";", "}"].includes(next.value)) && !next.newlineBefore;
    };
    if (this.isName("static") && modifierFollows()) {
      this.advance();
      isStatic = true;
      if (this.is("{")) {
        const saved = [this.inFunction, this.inAsync, this.inGenerator];
        this.inFunction = true; this.inAsync = false; this.inGenerator = false;
        const block = this.parseBlock();
        [this.inFunction, this.inAsync, this.inGenerator] = saved;
        return this.finish({ type: "StaticBlock", body: block.body }, start);
      }
    }
    if (this.isName("async") && modifierFollows() && !this.peek().newlineBefore) { this.advance(); isAsync = true; }
    if (this.eat("*")) generator = true;
    if ((this.isName("get") || this.isName("set")) && !isAsync && !generator && modifierFollows()) {
      kind = this.token.value;
      this.advance();
    }
    const { key, computed } = this.parsePropertyName(true);
    if (this.is("(")) {
      const isConstructor = !isStatic && !computed && ((key.type === "Identifier" && key.name === "constructor") || (key.type === "Literal" && key.value === "constructor"));
      const value = this.parseMethodValue(isAsync, generator);
      return this.finish({ type: "MethodDefinition", key, computed, value, kind: isConstructor ? "constructor" : kind, static: isStatic }, start);
    }
    let value = null;
    if (this.eat("=")) {
      const saved = [this.inFunction, this.inAsync, this.inGenerator, this.inClassField];
      this.inFunction = true; this.inAsync = false; this.inGenerator = false; this.inClassField = true;
      value = this.parseAssignment(false);
      [this.inFunction, this.inAsync, this.inGenerator, this.inClassField] = saved;
    }
    this.semicolon();
    return this.finish({ type: "PropertyDefinition", key, computed, value, static: isStatic }, start);
  }

  parseMethodValue(isAsync, generator) {
    const start = this.token.start;
    const { params, body } = this.parseFunctionRest(isAsync, generator);
    return this.finish({ type: "FunctionExpression", id: null, expression: false, generator, async: isAsync, params, body }, start);
  }

  parsePropertyName(allowPrivate = false) {
    const token = this.token;
    const start = token.start;
    if (this.eat("[")) {
      const key = this.parseAssignment(false);
      this.expect("]");
      return { key, computed: true };
    }
    if (token.type === "privateName") {
      if (!allowPrivate) this.unexpected();
      this.advance();
      return { key: this.finish({ type: "PrivateIdentifier", name: token.value }, start), computed: false };
    }
    if (token.type === "string" || token.type === "num") {
      this.advance();
      return { key: this.literalFromToken(token), computed: false };
    }
    if (token.type === "name") return { key: this.identifierName(), computed: false };
    this.unexpected("Expected a property name");
  }

  literalFromToken(token) {
    const node = { type: "Literal", value: token.value, raw: token.raw ?? this.text.slice(token.start, token.end), start: token.start, end: token.end };
    if (token.type === "num" && token.bigint !== undefined) node.bigint = token.bigint;
    if (token.type === "regexp") node.regex = token.regex;
    return node;
  }

  // modules
  parseModuleSource() {
    if (this.token.type !== "string") this.unexpected("Expected a module specifier string");
    const token = this.token;
    this.advance();
    return this.literalFromToken(token);
  }

  parseImportAttributes() {
    if (!((this.isName("with") || this.isName("assert")) && !this.token.newlineBefore)) return [];
    this.advance();
    this.expect("{");
    const attributes = [];
    while (!this.is("}")) {
      const start = this.token.start;
      const key = this.token.type === "string" ? (() => { const token = this.token; this.advance(); return this.literalFromToken(token); })() : this.identifierName();
      this.expect(":");
      const value = this.parseModuleSource();
      attributes.push(this.finish({ type: "ImportAttribute", key, value }, start));
      if (!this.is("}")) this.expect(",");
    }
    this.advance();
    return attributes;
  }

  moduleExportName() {
    if (this.token.type === "string") { const token = this.token; this.advance(); return this.literalFromToken(token); }
    return this.identifierName();
  }

  parseImport() {
    const start = this.token.start;
    this.advance();
    const specifiers = [];
    if (this.token.type !== "string") {
      if (this.token.type === "name" && !this.is("{") ) {
        if (this.isName("*")) this.unexpected();
      }
      if (this.token.type === "name") {
        const local = this.identifierName();
        specifiers.push(this.finish({ type: "ImportDefaultSpecifier", local }, local.start));
        this.eat(",");
      }
      if (this.is("*")) {
        const namespaceStart = this.token.start;
        this.advance();
        this.expect("as");
        const local = this.identifierName();
        specifiers.push(this.finish({ type: "ImportNamespaceSpecifier", local }, namespaceStart));
      } else if (this.eat("{")) {
        while (!this.is("}")) {
          const specifierStart = this.token.start;
          const imported = this.moduleExportName();
          const local = this.eat("as") ? this.identifierName() : { ...imported };
          specifiers.push(this.finish({ type: "ImportSpecifier", imported, local }, specifierStart));
          if (!this.is("}")) this.expect(",");
        }
        this.advance();
      }
      this.expect("from");
    }
    const source = this.parseModuleSource();
    const attributes = this.parseImportAttributes();
    this.semicolon();
    return this.finish({ type: "ImportDeclaration", specifiers, source, attributes }, start);
  }

  parseExport() {
    const start = this.token.start;
    this.advance();
    if (this.is("*")) {
      this.advance();
      const exported = this.eat("as") ? this.moduleExportName() : null;
      this.expect("from");
      const source = this.parseModuleSource();
      const attributes = this.parseImportAttributes();
      this.semicolon();
      return this.finish({ type: "ExportAllDeclaration", exported, source, attributes }, start);
    }
    if (this.eat("default")) {
      const declarationStart = this.token.start;
      let declaration;
      if (this.isName("function")) {
        declaration = this.parseFunction(declarationStart, true, false, true);
      } else if (this.isName("async") && this.peek().value === "function" && !this.peek().newlineBefore) {
        this.advance();
        declaration = this.parseFunction(declarationStart, true, true, true);
      } else if (this.isName("class")) {
        declaration = this.parseClass(declarationStart, true, true);
      } else {
        declaration = this.parseAssignment(false);
        this.semicolon();
      }
      return this.finish({ type: "ExportDefaultDeclaration", declaration }, start);
    }
    if (this.is("{")) {
      this.advance();
      const specifiers = [];
      while (!this.is("}")) {
        const specifierStart = this.token.start;
        const local = this.moduleExportName();
        const exported = this.eat("as") ? this.moduleExportName() : { ...local };
        specifiers.push(this.finish({ type: "ExportSpecifier", local, exported }, specifierStart));
        if (!this.is("}")) this.expect(",");
      }
      this.advance();
      let source = null;
      let attributes = [];
      if (this.eat("from")) {
        source = this.parseModuleSource();
        attributes = this.parseImportAttributes();
      }
      this.semicolon();
      return this.finish({ type: "ExportNamedDeclaration", declaration: null, specifiers, source, attributes }, start);
    }
    const declaration = this.parseStatement();
    if (!/Declaration$/u.test(declaration.type)) fail(this.text, declaration.start, "Expected a declaration after export");
    return this.finish({ type: "ExportNamedDeclaration", declaration, specifiers: [], source: null, attributes: [] }, start);
  }

  // expressions
  parseExpression(noIn = false) {
    const start = this.token.start;
    const expression = this.parseAssignment(noIn);
    if (this.is(",")) {
      const expressions = [expression];
      while (this.eat(",")) expressions.push(this.parseAssignment(noIn));
      return this.finish({ type: "SequenceExpression", expressions }, start);
    }
    return expression;
  }

  parseAssignment(noIn = false) {
    const start = this.token.start;
    if (this.inGenerator && this.isName("yield")) return this.parseYield(noIn);
    if (this.isArrowAhead()) return this.parseArrow(noIn);
    const left = this.parseConditional(noIn);
    if (this.token.type === "punct" && ASSIGNMENT_OPERATORS.has(this.token.value)) {
      const operator = this.token.value;
      this.advance();
      const target = operator === "=" ? this.toAssignable(left) : left;
      const right = this.parseAssignment(noIn);
      return this.finish({ type: "AssignmentExpression", operator, left: target, right }, start);
    }
    return left;
  }

  parseYield(noIn) {
    const start = this.token.start;
    this.advance();
    let delegate = false;
    let argument = null;
    if (!this.token.newlineBefore) {
      delegate = this.eat("*");
      if (delegate || !(this.is(")") || this.is("]") || this.is("}") || this.is(",") || this.is(";") || this.is(":") || this.token.type === "eof" || (this.token.type === "template" && !this.token.opening))) {
        argument = this.parseAssignment(noIn);
      }
    }
    return this.finish({ type: "YieldExpression", delegate, argument }, start);
  }

  /** Decide, without consuming, whether an arrow function starts here. */
  isArrowAhead() {
    const token = this.token;
    const state = this.scanner.state();
    const scan = () => this.scanner.next();
    try {
      if (token.type === "name" && token.value === "async") {
        const next = scan();
        if (next.newlineBefore) return false;
        if (next.type === "name" && !KEYWORDS.has(next.value)) {
          const after = scan();
          return after.type === "punct" && after.value === "=>" && !after.newlineBefore;
        }
        if (next.type === "punct" && next.value === "(") return this.parenFollowedByArrow(scan);
        return false;
      }
      if (token.type === "name" && !KEYWORDS.has(token.value)) {
        const next = scan();
        return next.type === "punct" && next.value === "=>" && !next.newlineBefore;
      }
      if (token.type === "punct" && token.value === "(") return this.parenFollowedByArrow(scan);
      return false;
    } catch {
      return false;
    } finally {
      this.scanner.restore(state);
    }
  }

  /** After an opening parenthesis, skip to its match and report whether `=>` follows. */
  parenFollowedByArrow(scan) {
    let depth = 1;
    let previous = null;
    for (;;) {
      let next = scan();
      if (next.type === "eof") return false;
      if (next.type === "punct" && next.value === "/" && (previous === null || this.regexAllowedAfter(previous))) {
        next = this.scanner.readRegExp(next.start, next.newlineBefore);
      }
      if (next.type === "punct") {
        if (next.value === "(" || next.value === "[" || next.value === "{") depth += 1;
        else if (next.value === ")" || next.value === "]" || next.value === "}") {
          depth -= 1;
          if (depth === 0) {
            const after = scan();
            return after.type === "punct" && after.value === "=>" && !after.newlineBefore;
          }
        }
      }
      previous = next;
    }
  }

  regexAllowedAfter(token) {
    if (token.type === "punct") return ![")", "]", "}"].includes(token.value);
    if (token.type === "name") return KEYWORDS.has(token.value) && !["this", "super", "null", "true", "false"].includes(token.value);
    return false;
  }

  parseArrow(noIn) {
    const start = this.token.start;
    let isAsync = false;
    if (this.isName("async") && (this.peek().value === "(" || (this.peek().type === "name" && this.peek().value !== "=>"))) {
      const next = this.peek();
      if (!(next.type === "punct" && next.value === "=>")) { this.advance(); isAsync = true; }
    }
    const saved = [this.inFunction, this.inAsync, this.inGenerator];
    this.inAsync = isAsync;
    this.inGenerator = false;
    let params;
    if (this.is("(")) params = this.parseParams();
    else params = [this.identifierName()];
    this.expect("=>");
    this.inFunction = true;
    let body;
    let expression = false;
    if (this.is("{")) body = this.parseBlock();
    else { body = this.parseAssignment(noIn); expression = true; }
    [this.inFunction, this.inAsync, this.inGenerator] = saved;
    return this.finish({ type: "ArrowFunctionExpression", id: null, expression, generator: false, async: isAsync, params, body }, start);
  }

  parseConditional(noIn) {
    const start = this.token.start;
    const test = this.parseBinary(0, noIn);
    if (this.eat("?")) {
      const consequent = this.parseAssignment(false);
      this.expect(":");
      const alternate = this.parseAssignment(noIn);
      return this.finish({ type: "ConditionalExpression", test, consequent, alternate }, start);
    }
    return test;
  }

  binaryOperator(noIn) {
    const token = this.token;
    if (token.type === "punct" || (token.type === "name" && (token.value === "instanceof" || token.value === "in"))) {
      if (noIn && token.value === "in") return null;
      return BINARY_PRECEDENCE.has(token.value) ? token.value : null;
    }
    return null;
  }

  parseBinary(minPrecedence, noIn) {
    const start = this.token.start;
    let left;
    if (this.token.type === "privateName" && this.peek().value === "in") {
      const token = this.token;
      this.advance();
      left = this.finish({ type: "PrivateIdentifier", name: token.value }, token.start);
    } else {
      left = this.parseUnary();
    }
    for (;;) {
      const operator = this.binaryOperator(noIn);
      if (operator === null) return left;
      const precedence = BINARY_PRECEDENCE.get(operator);
      if (precedence <= minPrecedence && !(operator === "**" && precedence === minPrecedence)) return left;
      if (precedence < minPrecedence) return left;
      this.advance();
      const right = operator === "**" ? this.parseBinary(precedence - 1, noIn) : this.parseBinary(precedence, noIn);
      const type = operator === "||" || operator === "&&" || operator === "??" ? "LogicalExpression" : "BinaryExpression";
      left = this.finish({ type, operator, left, right }, start);
    }
  }

  parseUnary() {
    const token = this.token;
    const start = token.start;
    if (token.type === "punct" && ["!", "~", "+", "-"].includes(token.value) || token.type === "name" && ["typeof", "void", "delete"].includes(token.value)) {
      this.advance();
      const argument = this.parseUnary();
      if (this.is("**")) this.unexpected("Unary operator before ** needs parentheses");
      return this.finish({ type: "UnaryExpression", operator: token.value, prefix: true, argument }, start);
    }
    if (token.type === "punct" && (token.value === "++" || token.value === "--")) {
      this.advance();
      const argument = this.parseUnary();
      return this.finish({ type: "UpdateExpression", operator: token.value, prefix: true, argument }, start);
    }
    if (token.type === "name" && token.value === "await" && (this.inAsync || (!this.inFunction && this.sourceType === "module"))) {
      this.advance();
      const argument = this.parseUnary();
      return this.finish({ type: "AwaitExpression", argument }, start);
    }
    const expression = this.parseSubscripts(this.parseExpressionAtom(), true);
    if (this.token.type === "punct" && (this.token.value === "++" || this.token.value === "--") && !this.token.newlineBefore) {
      const operator = this.token.value;
      this.advance();
      return this.finish({ type: "UpdateExpression", operator, prefix: false, argument: expression }, start);
    }
    return expression;
  }

  parseSubscripts(base, allowCalls) {
    const start = base.start;
    let expression = base;
    let chained = false;
    for (;;) {
      if (this.is("?.")) {
        chained = true;
        this.advance();
        if (allowCalls && this.is("(")) {
          const args = this.parseArguments();
          expression = this.finish({ type: "CallExpression", callee: expression, arguments: args, optional: true }, start);
        } else if (this.eat("[")) {
          const property = this.parseExpression();
          this.expect("]");
          expression = this.finish({ type: "MemberExpression", object: expression, property, computed: true, optional: true }, start);
        } else {
          const property = this.parseMemberName();
          expression = this.finish({ type: "MemberExpression", object: expression, property, computed: false, optional: true }, start);
        }
      } else if (this.eat(".")) {
        const property = this.parseMemberName();
        expression = this.finish({ type: "MemberExpression", object: expression, property, computed: false, optional: false }, start);
      } else if (this.eat("[")) {
        const property = this.parseExpression();
        this.expect("]");
        expression = this.finish({ type: "MemberExpression", object: expression, property, computed: true, optional: false }, start);
      } else if (allowCalls && this.is("(")) {
        const args = this.parseArguments();
        expression = this.finish({ type: "CallExpression", callee: expression, arguments: args, optional: false }, start);
      } else if (this.token.type === "template" && this.token.opening) {
        if (chained) this.unexpected("Tagged template in optional chain");
        const quasi = this.parseTemplate();
        expression = this.finish({ type: "TaggedTemplateExpression", tag: expression, quasi }, start);
      } else {
        break;
      }
    }
    if (chained) return { type: "ChainExpression", expression, start, end: expression.end };
    return expression;
  }

  parseMemberName() {
    if (this.token.type === "privateName") {
      const token = this.token;
      this.advance();
      return this.finish({ type: "PrivateIdentifier", name: token.value }, token.start);
    }
    return this.identifierName();
  }

  parseArguments() {
    this.expect("(");
    const args = [];
    while (!this.is(")")) {
      if (this.is("...")) {
        const start = this.token.start;
        this.advance();
        const argument = this.parseAssignment(false);
        args.push(this.finish({ type: "SpreadElement", argument }, start));
      } else {
        args.push(this.parseAssignment(false));
      }
      if (!this.is(")")) this.expect(",");
    }
    this.advance();
    return args;
  }

  parseTemplate() {
    const start = this.token.start;
    const quasis = [];
    const expressions = [];
    let token = this.token;
    for (;;) {
      const elementStart = token.start + 1;
      const elementEnd = token.tail ? token.end - 1 : token.end - 2;
      quasis.push({ type: "TemplateElement", value: { raw: token.raw, cooked: token.value }, tail: token.tail, start: elementStart, end: elementEnd });
      this.advance();
      if (token.tail) break;
      expressions.push(this.parseExpression());
      if (this.token.type !== "template" || this.token.opening) this.unexpected("Expected template continuation");
      token = this.token;
    }
    return this.finish({ type: "TemplateLiteral", quasis, expressions }, start);
  }

  parseExpressionAtom() {
    let token = this.token;
    const start = token.start;
    if (token.type === "punct" && (token.value === "/" || token.value === "/=")) {
      this.scanner.restore({ pos: token.start, braces: this.scanner.braces });
      token = this.scanner.readRegExp(token.start, token.newlineBefore);
      this.token = token;
    }
    switch (token.type) {
      case "num": case "string": case "regexp":
        this.advance();
        return this.literalFromToken(token);
      case "template":
        if (!token.opening) this.unexpected();
        return this.parseTemplate();
      case "privateName":
        this.unexpected();
        break;
      case "name": {
        switch (token.value) {
          case "this": this.advance(); return this.finish({ type: "ThisExpression" }, start);
          case "super": this.advance(); return this.finish({ type: "Super" }, start);
          case "null": this.advance(); return this.finish({ type: "Literal", value: null, raw: "null" }, start);
          case "true": case "false": this.advance(); return this.finish({ type: "Literal", value: token.value === "true", raw: token.value }, start);
          case "function": return this.parseFunction(start, false, false);
          case "class": return this.parseClass(start, false);
          case "new": return this.parseNew();
          case "import": {
            this.advance();
            if (this.eat(".")) {
              const meta = { type: "Identifier", name: "import", start, end: token.end };
              const property = this.identifierName();
              return this.finish({ type: "MetaProperty", meta, property }, start);
            }
            this.expect("(");
            const source = this.parseAssignment(false);
            let options = null;
            if (this.eat(",") && !this.is(")")) { options = this.parseAssignment(false); this.eat(","); }
            this.expect(")");
            return this.finish({ type: "ImportExpression", source, options }, start);
          }
          case "async": {
            const next = this.peek();
            if (next.type === "name" && next.value === "function" && !next.newlineBefore) {
              this.advance();
              return this.parseFunction(start, false, true);
            }
            break;
          }
          default: break;
        }
        if (KEYWORDS.has(token.value)) this.unexpected();
        return this.identifierName();
      }
      case "punct":
        if (token.value === "(") {
          this.advance();
          const expression = this.parseExpression();
          this.expect(")");
          return expression;
        }
        if (token.value === "[") return this.parseArrayLiteral();
        if (token.value === "{") return this.parseObjectLiteral();
        break;
      default: break;
    }
    this.unexpected();
  }

  parseNew() {
    const start = this.token.start;
    this.advance();
    if (this.eat(".")) {
      const meta = { type: "Identifier", name: "new", start, end: start + 3 };
      const property = this.identifierName();
      return this.finish({ type: "MetaProperty", meta, property }, start);
    }
    let callee = this.parseExpressionAtom();
    callee = this.parseSubscripts(callee, false);
    const args = this.is("(") ? this.parseArguments() : [];
    return this.finish({ type: "NewExpression", callee, arguments: args }, start);
  }

  parseArrayLiteral() {
    const start = this.token.start;
    this.expect("[");
    const elements = [];
    while (!this.is("]")) {
      if (this.is(",")) { this.advance(); elements.push(null); continue; }
      if (this.is("...")) {
        const spreadStart = this.token.start;
        this.advance();
        const argument = this.parseAssignment(false);
        elements.push(this.finish({ type: "SpreadElement", argument }, spreadStart));
      } else {
        elements.push(this.parseAssignment(false));
      }
      if (!this.is("]")) this.expect(",");
    }
    this.advance();
    return this.finish({ type: "ArrayExpression", elements }, start);
  }

  parseObjectLiteral() {
    const start = this.token.start;
    this.expect("{");
    const properties = [];
    while (!this.is("}")) {
      properties.push(this.parseObjectMember());
      if (!this.is("}")) this.expect(",");
    }
    this.advance();
    return this.finish({ type: "ObjectExpression", properties }, start);
  }

  parseObjectMember() {
    const start = this.token.start;
    if (this.is("...")) {
      this.advance();
      const argument = this.parseAssignment(false);
      return this.finish({ type: "SpreadElement", argument }, start);
    }
    let isAsync = false;
    let generator = false;
    let kind = "init";
    const modifierFollows = () => {
      const next = this.peek();
      return !(next.type === "punct" && ["(", ",", "}", ":", "="].includes(next.value));
    };
    if (this.isName("async") && modifierFollows() && !this.peek().newlineBefore) { this.advance(); isAsync = true; }
    if (this.eat("*")) generator = true;
    if ((this.isName("get") || this.isName("set")) && !isAsync && !generator && modifierFollows()) {
      kind = this.token.value;
      this.advance();
    }
    const { key, computed } = this.parsePropertyName();
    if (this.is("(")) {
      const value = this.parseMethodValue(isAsync, generator);
      return this.finish({ type: "Property", key, value, kind, method: kind === "init", shorthand: false, computed }, start);
    }
    if (kind !== "init" || isAsync || generator) this.unexpected();
    if (this.eat(":")) {
      const value = this.parseAssignment(false);
      return this.finish({ type: "Property", key, value, kind: "init", method: false, shorthand: false, computed }, start);
    }
    if (computed || key.type !== "Identifier") this.unexpected();
    let value = { type: "Identifier", name: key.name, start: key.start, end: key.end };
    if (this.eat("=")) {
      const right = this.parseAssignment(false);
      value = this.finish({ type: "AssignmentPattern", left: value, right }, start);
    }
    return this.finish({ type: "Property", key: { ...key }, value, kind: "init", method: false, shorthand: true, computed: false }, start);
  }

  /** Reinterpret an expression as an assignment or binding target. */
  toAssignable(node) {
    switch (node.type) {
      case "Identifier": case "MemberExpression": case "ObjectPattern": case "ArrayPattern": case "AssignmentPattern": case "RestElement":
        return node;
      case "ObjectExpression":
        node.type = "ObjectPattern";
        for (const property of node.properties) {
          if (property.type === "SpreadElement") { property.type = "RestElement"; property.argument = this.toAssignable(property.argument); }
          else property.value = this.toAssignable(property.value);
        }
        return node;
      case "ArrayExpression":
        node.type = "ArrayPattern";
        node.elements = node.elements.map((element) => {
          if (element === null) return null;
          if (element.type === "SpreadElement") return { type: "RestElement", argument: this.toAssignable(element.argument), start: element.start, end: element.end };
          return this.toAssignable(element);
        });
        return node;
      case "AssignmentExpression":
        if (node.operator !== "=") break;
        return { type: "AssignmentPattern", left: this.toAssignable(node.left), right: node.right, start: node.start, end: node.end };
      case "ChainExpression":
        break;
      default: break;
    }
    fail(this.text, node.start, "Invalid assignment target");
  }
}

/**
 * Parse JavaScript source into an ESTree `Program` with `comments` and
 * `tokens`. `sourceType` is `"module"` (default) or `"script"`.
 */
export function parseJavaScript(text, { sourceType = "module" } = {}) {
  if (typeof text !== "string") throw new TypeError("JavaScript source must be a string");
  return new Parser(text, { sourceType }).parseProgram();
}

const NON_CHILD_KEYS = new Set(["type", "start", "end", "comments", "tokens", "regex", "value", "raw", "bigint"]);

/** Visit every node depth-first; `visit(node, parent)` returning `false` skips that node's children. */
export function walkJavaScript(node, visit, parent = null) {
  if (visit(node, parent) === false) return;
  for (const key of Object.keys(node)) {
    if (NON_CHILD_KEYS.has(key) && !(key === "value" && node.type === "Property") && !(key === "value" && (node.type === "MethodDefinition" || node.type === "PropertyDefinition" || node.type === "ImportAttribute"))) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) if (item && typeof item.type === "string") walkJavaScript(item, visit, node);
    } else if (child && typeof child === "object" && typeof child.type === "string") {
      walkJavaScript(child, visit, node);
    }
  }
}

/** The comments that sit between the previous token and `node`, nearest last. */
export function leadingComments(program, node) {
  const tokens = program.tokens;
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (tokens[middle].end <= node.start) low = middle + 1; else high = middle;
  }
  const previousEnd = low === 0 ? 0 : tokens[low - 1].end;
  return program.comments.filter((comment) => comment.start >= previousEnd && comment.end <= node.start);
}

/** The JSDoc block (`/** … *\/`) directly before `node`, or null. */
export function jsdocOf(program, node) {
  const comments = leadingComments(program, node);
  const last = comments[comments.length - 1];
  return last && last.type === "Block" && last.value.startsWith("*") ? last : null;
}

function jsdocLines(value) {
  return value.replace(/^\*/u, "").split(/\r?\n/u).map((line) => line.replace(/^\s*\*? ?/u, ""));
}

function readBracedType(text) {
  if (!text.startsWith("{")) return { type: null, rest: text };
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    else if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return { type: text.slice(1, index).trim(), rest: text.slice(index + 1) };
    }
  }
  return { type: text.slice(1).trim(), rest: "" };
}

/**
 * Read a JSDoc block comment's value (the text between `/*` and `*\/`) into its
 * description and tags. `@param` and `@property` tags carry `type`, `name`
 * (brackets and defaults removed, `optional` set) and `description`;
 * `@returns`/`@return` and `@throws` carry `type` and `description`; any other
 * tag carries its `text`.
 */
export function parseJsdoc(value) {
  const lines = jsdocLines(value);
  const chunks = [];
  let current = { tag: null, lines: [] };
  for (const line of lines) {
    const match = /^\s*@([A-Za-z][\w-]*)\s?(.*)$/u.exec(line);
    if (match) {
      chunks.push(current);
      current = { tag: match[1], lines: [match[2]] };
    } else {
      current.lines.push(line);
    }
  }
  chunks.push(current);
  const description = chunks[0].lines.join("\n").trim();
  const tags = [];
  for (const chunk of chunks.slice(1)) {
    const body = chunk.lines.join("\n").trim();
    const tag = chunk.tag;
    if (tag === "param" || tag === "arg" || tag === "argument" || tag === "property" || tag === "prop") {
      const { type, rest } = readBracedType(body);
      const nameMatch = /^\s*(\[[^\]]*\]|[^\s]+)\s*([\s\S]*)$/u.exec(rest) ?? [null, "", ""];
      let name = nameMatch[1] ?? "";
      let optional = false;
      if (name.startsWith("[")) { optional = true; name = name.slice(1, -1).split("=")[0].trim(); }
      tags.push({ tag, type, name, optional, description: (nameMatch[2] ?? "").trim() });
    } else if (tag === "typedef" || tag === "callback" || tag === "type") {
      const { type, rest } = readBracedType(body);
      const name = rest.trim().split(/\s+/u)[0] ?? "";
      tags.push({ tag, type, name, text: body });
    } else if (tag === "returns" || tag === "return" || tag === "throws" || tag === "throw" || tag === "exception") {
      const { type, rest } = readBracedType(body);
      tags.push({ tag, type, description: rest.trim() });
    } else {
      tags.push({ tag, text: body });
    }
  }
  return { description, tags };
}

// ── scope binding ────────────────────────────────────────────────────────────

const SCOPE_FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

function patternIdentifiers(pattern, out = []) {
  if (!pattern) return out;
  switch (pattern.type) {
    case "Identifier": out.push(pattern); break;
    case "ObjectPattern": for (const property of pattern.properties) patternIdentifiers(property.type === "RestElement" ? property.argument : property.value, out); break;
    case "ArrayPattern": for (const element of pattern.elements) patternIdentifiers(element, out); break;
    case "RestElement": patternIdentifiers(pattern.argument, out); break;
    case "AssignmentPattern": patternIdentifiers(pattern.left, out); break;
    default: break;
  }
  return out;
}

/** Whether an Identifier node, seen under `parent`, reads or writes a binding
 * (rather than naming a property, label, or export alias). */
function isReferencePosition(node, parent) {
  if (!parent) return true;
  switch (parent.type) {
    case "MemberExpression": return parent.object === node || parent.computed;
    case "Property": return parent.value === node || parent.computed;
    case "MethodDefinition": case "PropertyDefinition": return parent.computed && parent.key === node || parent.value === node;
    case "LabeledStatement": case "BreakStatement": case "ContinueStatement": return false;
    case "ExportSpecifier": return parent.local === node;
    case "ImportAttribute": return false;
    case "ImportSpecifier": case "ImportDefaultSpecifier": case "ImportNamespaceSpecifier": return false;
    case "MetaProperty": return false;
    case "ExportAllDeclaration": return false;
    default: return true;
  }
}

/**
 * Resolve every identifier reference in a program to the binding that
 * declares it. Returns `{ bindings, declarationOccurrences, references, scopeOf }`: `bindings` lists
 * `{ name, kind, identifier, scope }` in declaration order; `references` maps
 * each referencing Identifier node to its binding, or to `null` for a global;
 * declaring identifiers map to their own binding. `declarationOccurrences` lists
 * `{ identifier, binding }` for every declaration occurrence, preserving a
 * shared binding identity when legal var/function declarations repeat.
 * Modules are strict: `let`,
 * `const`, `class` and function declarations are block-scoped, `var` hoists
 * to the nearest function.
 */
export function bindJavaScript(program) {
  const bindings = [];
  const declarationOccurrences = [];
  const references = new Map();
  const scopeOf = new Map();
  const newScope = (node, parent, isFunction) => {
    const scope = { node, parent, isFunction, names: new Map() };
    scopeOf.set(node, scope);
    return scope;
  };
  const declare = (scope, identifier, kind) => {
    const existing = scope.names.get(identifier.name);
    if (existing && (kind === "var" || existing.kind === "var" || kind === "function")) {
      references.set(identifier, existing);
      declarationOccurrences.push({ identifier, binding: existing });
      return existing;
    }
    const binding = { name: identifier.name, kind, identifier, scope };
    scope.names.set(identifier.name, binding);
    bindings.push(binding);
    references.set(identifier, binding);
    declarationOccurrences.push({ identifier, binding });
    return binding;
  };
  const functionScopeOf = (scope) => { let current = scope; while (!current.isFunction) current = current.parent; return current; };
  const children = (node) => {
    const out = [];
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "comments" || key === "tokens") continue;
      const child = node[key];
      if (Array.isArray(child)) { for (const item of child) if (item && typeof item.type === "string") out.push(item); }
      else if (child && typeof child === "object" && typeof child.type === "string") out.push(child);
    }
    return out;
  };

  // Pass 1: build scopes and declare names. A function's or catch clause's
  // body block shares the scope of its parameters.
  const declarePass = (node, scope) => {
    switch (node.type) {
      case "Program": {
        const inner = newScope(node, null, true);
        for (const child of node.body) declarePass(child, inner);
        return;
      }
      case "FunctionDeclaration": case "FunctionExpression": case "ArrowFunctionExpression": {
        if (node.type === "FunctionDeclaration" && node.id) declare(scope, node.id, "function");
        const inner = newScope(node, scope, true);
        if (node.type === "FunctionExpression" && node.id) declare(inner, node.id, "function-name");
        for (const param of node.params) for (const identifier of patternIdentifiers(param)) declare(inner, identifier, "param");
        for (const param of node.params) declarePass(param, inner);
        if (node.body.type === "BlockStatement") { scopeOf.set(node.body, inner); for (const statement of node.body.body) declarePass(statement, inner); }
        else declarePass(node.body, inner);
        return;
      }
      case "CatchClause": {
        const inner = newScope(node, scope, false);
        for (const identifier of patternIdentifiers(node.param)) declare(inner, identifier, "catch");
        if (node.param) declarePass(node.param, inner);
        scopeOf.set(node.body, inner);
        for (const statement of node.body.body) declarePass(statement, inner);
        return;
      }
      case "ClassDeclaration": case "ClassExpression": {
        if (node.type === "ClassDeclaration" && node.id) declare(scope, node.id, "class");
        const inner = newScope(node, scope, false);
        if (node.type === "ClassExpression" && node.id) declare(inner, node.id, "class-name");
        for (const child of children(node)) if (child !== node.id) declarePass(child, inner);
        return;
      }
      case "BlockStatement": case "ForStatement": case "ForInStatement": case "ForOfStatement": case "SwitchStatement": case "StaticBlock": {
        const inner = newScope(node, scope, node.type === "StaticBlock");
        for (const child of children(node)) declarePass(child, inner);
        return;
      }
      case "VariableDeclaration": {
        const target = node.kind === "var" ? functionScopeOf(scope) : scope;
        for (const declarator of node.declarations) for (const identifier of patternIdentifiers(declarator.id)) declare(target, identifier, node.kind);
        break;
      }
      case "ImportDeclaration":
        for (const specifier of node.specifiers) declare(scope, specifier.local, "import");
        return;
      default: break;
    }
    for (const child of children(node)) declarePass(child, scope);
  };
  declarePass(program, null);

  // Pass 2: resolve references against the scope chain.
  const lookup = (scope, name) => {
    for (let current = scope; current; current = current.parent) {
      const binding = current.names.get(name);
      if (binding) return binding;
    }
    return null;
  };
  const resolvePass = (node, parent, scope) => {
    const inner = scopeOf.get(node) ?? scope;
    if (node.type === "Identifier" && !references.has(node) && isReferencePosition(node, parent)) {
      references.set(node, lookup(scope, node.name));
    }
    if (node.type === "ExportNamedDeclaration" && node.source) return;
    for (const child of children(node)) resolvePass(child, node, inner);
  };
  resolvePass(program, null, scopeOf.get(program));
  return { bindings, declarationOccurrences, references, scopeOf };
}
