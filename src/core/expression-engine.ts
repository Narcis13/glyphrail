import { createFailure, exitCodeForErrorCode } from "./errors";

type TokenType =
  | "identifier"
  | "number"
  | "string"
  | "operator"
  | "dot"
  | "leftParen"
  | "rightParen"
  | "eof";

interface Token {
  type: TokenType;
  value: string;
  position: number;
}

export type ExpressionNode =
  | LiteralExpressionNode
  | ReferenceExpressionNode
  | UnaryExpressionNode
  | BinaryExpressionNode;

export interface LiteralExpressionNode {
  type: "literal";
  value: string | number | boolean | null;
}

export interface ReferenceExpressionNode {
  type: "reference";
  segments: string[];
}

export interface UnaryExpressionNode {
  type: "unary";
  operator: "!" | "-";
  operand: ExpressionNode;
}

export interface BinaryExpressionNode {
  type: "binary";
  operator: "==" | "!=" | "&&" | "||" | "+" | "-" | "*" | "/" | "%";
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface ExpressionReference {
  root: string;
  path: string;
  segments: string[];
}

export interface ExpressionScope {
  input?: Record<string, unknown>;
  state?: Record<string, unknown>;
  env?: Record<string, unknown>;
  context?: Record<string, unknown>;
  item?: Record<string, unknown> | unknown;
  branch?: Record<string, unknown>;
  output?: Record<string, unknown> | unknown;
  [key: string]: unknown;
}

const SUPPORTED_ROOTS = new Set(["input", "state", "env", "context", "item", "branch", "output"]);

export function isExpressionInterpolation(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("${") && trimmed.endsWith("}");
}

export function unwrapExpression(value: string): string {
  const trimmed = value.trim();
  if (!isExpressionInterpolation(trimmed)) {
    throw createFailure(
      "EXPRESSION_EVALUATION_ERROR",
      `Invalid expression interpolation: ${value}`,
      exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR")
    );
  }

  return trimmed.slice(2, -1).trim();
}

export function parseExpression(value: string): ExpressionNode {
  const parser = new ExpressionParser(tokenize(unwrapExpression(value)));
  return parser.parse();
}

export function evaluateExpression(value: string | ExpressionNode, scope: ExpressionScope): unknown {
  const ast = typeof value === "string" ? parseExpression(value) : value;
  return evaluateExpressionNode(ast, scope);
}

export function evaluateExpressionNode(node: ExpressionNode, scope: ExpressionScope): unknown {
  switch (node.type) {
    case "literal":
      return node.value;
    case "reference":
      return resolveReference(node.segments, scope);
    case "unary": {
      const operand = evaluateExpressionNode(node.operand, scope);
      return node.operator === "!" ? !operand : -toNumber(operand);
    }
    case "binary": {
      const left = evaluateExpressionNode(node.left, scope);
      const right = evaluateExpressionNode(node.right, scope);

      switch (node.operator) {
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        case "&&":
          return Boolean(left) && Boolean(right);
        case "||":
          return Boolean(left) || Boolean(right);
        case "+":
          return typeof left === "string" || typeof right === "string"
            ? `${left ?? ""}${right ?? ""}`
            : toNumber(left) + toNumber(right);
        case "-":
          return toNumber(left) - toNumber(right);
        case "*":
          return toNumber(left) * toNumber(right);
        case "/":
          return toNumber(left) / toNumber(right);
        case "%":
          return toNumber(left) % toNumber(right);
      }
    }
  }
}

export function collectExpressionReferences(node: ExpressionNode): ExpressionReference[] {
  const references: ExpressionReference[] = [];
  visitExpression(node, (currentNode) => {
    if (currentNode.type === "reference") {
      references.push({
        root: currentNode.segments[0] ?? "",
        path: currentNode.segments.join("."),
        segments: [...currentNode.segments]
      });
    }
  });
  return references;
}

function visitExpression(node: ExpressionNode, visitor: (node: ExpressionNode) => void): void {
  visitor(node);
  if (node.type === "unary") {
    visitExpression(node.operand, visitor);
  }
  if (node.type === "binary") {
    visitExpression(node.left, visitor);
    visitExpression(node.right, visitor);
  }
}

function resolveReference(segments: string[], scope: ExpressionScope): unknown {
  const [root, ...rest] = segments;
  if (!root || (!SUPPORTED_ROOTS.has(root) && !(root in scope))) {
    throw createFailure(
      "EXPRESSION_EVALUATION_ERROR",
      `Unsupported expression root: ${root ?? "<empty>"}`,
      exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR")
    );
  }

  let current: unknown = (scope as Record<string, unknown>)[root];
  for (const segment of rest) {
    if (current == null || (typeof current !== "object" && !Array.isArray(current))) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function toNumber(value: unknown): number {
  if (typeof value !== "number") {
    throw createFailure(
      "EXPRESSION_EVALUATION_ERROR",
      `Expected a number in expression evaluation, received ${typeof value}.`,
      exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR")
    );
  }
  return value;
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "leftParen", value: char, position: index });
      index += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "rightParen", value: char, position: index });
      index += 1;
      continue;
    }

    if (char === ".") {
      tokens.push({ type: "dot", value: char, position: index });
      index += 1;
      continue;
    }

    const twoCharacterOperator = source.slice(index, index + 2);
    if (["==", "!=", "&&", "||"].includes(twoCharacterOperator)) {
      tokens.push({ type: "operator", value: twoCharacterOperator, position: index });
      index += 2;
      continue;
    }

    if (["!", "+", "-", "*", "/", "%"].includes(char)) {
      tokens.push({ type: "operator", value: char, position: index });
      index += 1;
      continue;
    }

    if (char === `"` || char === `'`) {
      const [value, nextIndex] = readStringToken(source, index);
      tokens.push({ type: "string", value, position: index });
      index = nextIndex;
      continue;
    }

    if (/\d/.test(char)) {
      const [value, nextIndex] = readNumberToken(source, index);
      tokens.push({ type: "number", value, position: index });
      index = nextIndex;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const [value, nextIndex] = readIdentifierToken(source, index);
      tokens.push({ type: "identifier", value, position: index });
      index = nextIndex;
      continue;
    }

    throw createFailure(
      "EXPRESSION_EVALUATION_ERROR",
      `Unexpected character '${char}' in expression.`,
      exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR"),
      { position: index }
    );
  }

  tokens.push({ type: "eof", value: "", position: source.length });
  return tokens;
}

function readStringToken(source: string, start: number): [string, number] {
  const quote = source[start];
  let index = start + 1;
  let value = "";

  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      const next = source[index + 1];
      if (next === undefined) {
        break;
      }
      value += next;
      index += 2;
      continue;
    }
    if (char === quote) {
      return [value, index + 1];
    }
    value += char;
    index += 1;
  }

  throw createFailure(
    "EXPRESSION_EVALUATION_ERROR",
    "Unterminated string literal in expression.",
    exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR"),
    { position: start }
  );
}

function readNumberToken(source: string, start: number): [string, number] {
  let index = start;
  while (index < source.length && /[\d.]/.test(source[index])) {
    index += 1;
  }
  return [source.slice(start, index), index];
}

function readIdentifierToken(source: string, start: number): [string, number] {
  let index = start;
  while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) {
    index += 1;
  }
  return [source.slice(start, index), index];
}

class ExpressionParser {
  constructor(
    private readonly tokens: Token[],
    private index = 0
  ) {}

  parse(): ExpressionNode {
    const expression = this.parseOr();
    this.expect("eof");
    return expression;
  }

  private parseOr(): ExpressionNode {
    let node = this.parseAnd();
    while (this.matchOperator("||")) {
      node = {
        type: "binary",
        operator: "||",
        left: node,
        right: this.parseAnd()
      };
    }
    return node;
  }

  private parseAnd(): ExpressionNode {
    let node = this.parseEquality();
    while (this.matchOperator("&&")) {
      node = {
        type: "binary",
        operator: "&&",
        left: node,
        right: this.parseEquality()
      };
    }
    return node;
  }

  private parseEquality(): ExpressionNode {
    let node = this.parseAdditive();
    while (true) {
      if (this.matchOperator("==")) {
        node = {
          type: "binary",
          operator: "==",
          left: node,
          right: this.parseAdditive()
        };
        continue;
      }
      if (this.matchOperator("!=")) {
        node = {
          type: "binary",
          operator: "!=",
          left: node,
          right: this.parseAdditive()
        };
        continue;
      }
      return node;
    }
  }

  private parseAdditive(): ExpressionNode {
    let node = this.parseMultiplicative();
    while (true) {
      if (this.matchOperator("+")) {
        node = {
          type: "binary",
          operator: "+",
          left: node,
          right: this.parseMultiplicative()
        };
        continue;
      }
      if (this.matchOperator("-")) {
        node = {
          type: "binary",
          operator: "-",
          left: node,
          right: this.parseMultiplicative()
        };
        continue;
      }
      return node;
    }
  }

  private parseMultiplicative(): ExpressionNode {
    let node = this.parseUnary();
    while (true) {
      if (this.matchOperator("*")) {
        node = {
          type: "binary",
          operator: "*",
          left: node,
          right: this.parseUnary()
        };
        continue;
      }
      if (this.matchOperator("/")) {
        node = {
          type: "binary",
          operator: "/",
          left: node,
          right: this.parseUnary()
        };
        continue;
      }
      if (this.matchOperator("%")) {
        node = {
          type: "binary",
          operator: "%",
          left: node,
          right: this.parseUnary()
        };
        continue;
      }
      return node;
    }
  }

  private parseUnary(): ExpressionNode {
    if (this.matchOperator("!")) {
      return {
        type: "unary",
        operator: "!",
        operand: this.parseUnary()
      };
    }
    if (this.matchOperator("-")) {
      return {
        type: "unary",
        operator: "-",
        operand: this.parseUnary()
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExpressionNode {
    if (this.match("leftParen")) {
      const expression = this.parseOr();
      this.expect("rightParen");
      return expression;
    }

    const token = this.peek();
    if (token.type === "number") {
      this.index += 1;
      return {
        type: "literal",
        value: Number(token.value)
      };
    }
    if (token.type === "string") {
      this.index += 1;
      return {
        type: "literal",
        value: token.value
      };
    }
    if (token.type === "identifier") {
      this.index += 1;
      if (token.value === "true" || token.value === "false") {
        return {
          type: "literal",
          value: token.value === "true"
        };
      }
      if (token.value === "null") {
        return {
          type: "literal",
          value: null
        };
      }

      const segments = [token.value];
      while (this.match("dot")) {
        const segment = this.expect("identifier");
        segments.push(segment.value);
      }

      return {
        type: "reference",
        segments
      };
    }

    throw createFailure(
      "EXPRESSION_EVALUATION_ERROR",
      `Unexpected token '${token.value}' in expression.`,
      exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR"),
      { position: token.position }
    );
  }

  private match(type: TokenType): boolean {
    if (this.peek().type !== type) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private matchOperator(operator: string): boolean {
    const token = this.peek();
    if (token.type !== "operator" || token.value !== operator) {
      return false;
    }
    this.index += 1;
    return true;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw createFailure(
        "EXPRESSION_EVALUATION_ERROR",
        `Expected ${type} in expression but found '${token.value}'.`,
        exitCodeForErrorCode("EXPRESSION_EVALUATION_ERROR"),
        { position: token.position }
      );
    }
    this.index += 1;
    return token;
  }

  private peek(): Token {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1];
  }
}
