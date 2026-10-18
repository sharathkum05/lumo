import { LumoError } from "../errors.ts";
import type { Clause, Operand, Operator, OrderBy, Query } from "./ast.ts";
import { tokenize, type Token } from "./lexer.ts";

/**
 * Parses a JQL query.
 *
 *   query   := [or] [ORDER BY item ("," item)*]
 *   or      := and (OR and)*
 *   and     := not (AND not)*
 *   not     := (NOT | "!") not | "(" or ")" | field operator operand
 */
export function parseJql(input: string): Query {
  return new Parser(tokenize(input)).query();
}

class Parser {
  private i = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  query(): Query {
    let where: Clause | null = null;
    if (!this.atEof() && !this.atKeyword("order")) where = this.or();
    const orderBy: OrderBy[] = [];
    if (this.acceptKeyword("order")) {
      this.expectKeyword("by");
      do {
        const field = this.fieldName();
        let direction: "asc" | "desc" = "asc";
        if (this.acceptKeyword("desc")) direction = "desc";
        else this.acceptKeyword("asc");
        orderBy.push({ field, direction });
      } while (this.accept("comma"));
    }
    if (!this.atEof()) this.fail(`Unexpected "${this.peek().text}"`);
    return { where, orderBy };
  }

  private or(): Clause {
    const clauses = [this.and()];
    while (this.acceptKeyword("or")) clauses.push(this.and());
    return clauses.length === 1 ? clauses[0]! : { kind: "or", clauses };
  }

  private and(): Clause {
    const clauses = [this.not()];
    while (this.acceptKeyword("and")) clauses.push(this.not());
    return clauses.length === 1 ? clauses[0]! : { kind: "and", clauses };
  }

  private not(): Clause {
    if (this.acceptKeyword("not") || this.acceptOp("!")) return { kind: "not", clause: this.not() };
    if (this.accept("lparen")) {
      const inner = this.or();
      this.expect("rparen");
      return inner;
    }
    const field = this.fieldName();
    const op = this.operator();
    return { kind: "compare", field, op, operand: this.operand(op) };
  }

  private fieldName(): string {
    const t = this.peek();
    if (t.kind !== "word" && t.kind !== "string") this.fail("Expected a field name");
    this.i++;
    return t.text;
  }

  private operator(): Operator {
    const t = this.peek();
    if (t.kind === "op" && t.text !== "!") {
      this.i++;
      return t.text as Operator;
    }
    if (this.acceptKeyword("in")) return "in";
    if (this.acceptKeyword("is")) return this.acceptKeyword("not") ? "is not" : "is";
    if (this.acceptKeyword("not")) {
      this.expectKeyword("in");
      return "not in";
    }
    return this.fail(`Expected an operator after field, got "${t.text}"`);
  }

  private operand(op: Operator): Operand {
    if (op === "is" || op === "is not") {
      if (this.acceptKeyword("empty") || this.acceptKeyword("null")) return { kind: "empty" };
      return this.fail(`Expected EMPTY or NULL after ${op.toUpperCase()}`);
    }
    if (op === "in" || op === "not in") {
      if (!this.atKind("lparen")) return this.single();
      this.i++;
      const items: Operand[] = [];
      if (!this.atKind("rparen")) {
        do items.push(this.single());
        while (this.accept("comma"));
      }
      this.expect("rparen");
      return { kind: "list", items };
    }
    return this.single();
  }

  private single(): Operand {
    const t = this.peek();
    if (t.kind === "string") {
      this.i++;
      return { kind: "value", value: t.text };
    }
    if (t.kind !== "word") return this.fail("Expected a value");
    this.i++;
    const lower = t.text.toLowerCase();
    if (lower === "empty" || lower === "null") return { kind: "empty" };
    if (this.accept("lparen")) {
      const args: string[] = [];
      if (!this.atKind("rparen")) {
        do {
          const a = this.peek();
          if (a.kind !== "word" && a.kind !== "string") this.fail("Expected a function argument");
          this.i++;
          args.push(a.text);
        } while (this.accept("comma"));
      }
      this.expect("rparen");
      return { kind: "function", name: t.text, args };
    }
    return { kind: "value", value: t.text };
  }

  private peek(): Token {
    return this.tokens[this.i]!;
  }

  private atEof(): boolean {
    return this.peek().kind === "eof";
  }

  private atKind(kind: Token["kind"]): boolean {
    return this.peek().kind === kind;
  }

  private atKeyword(word: string): boolean {
    const t = this.peek();
    return t.kind === "word" && t.text.toLowerCase() === word;
  }

  private accept(kind: Token["kind"]): boolean {
    if (!this.atKind(kind)) return false;
    this.i++;
    return true;
  }

  private acceptOp(op: string): boolean {
    const t = this.peek();
    if (t.kind !== "op" || t.text !== op) return false;
    this.i++;
    return true;
  }

  private acceptKeyword(word: string): boolean {
    if (!this.atKeyword(word)) return false;
    this.i++;
    return true;
  }

  private expect(kind: Token["kind"]): void {
    if (!this.accept(kind)) this.fail(`Expected "${kind === "rparen" ? ")" : kind}"`);
  }

  private expectKeyword(word: string): void {
    if (!this.acceptKeyword(word)) this.fail(`Expected ${word.toUpperCase()}`);
  }

  private fail(message: string): never {
    const t = this.peek();
    const where = t.kind === "eof" ? "at end of query" : `at position ${t.pos}`;
    throw new LumoError("jql_syntax", `${message} ${where}`);
  }
}
