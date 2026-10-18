import { LumoError } from "../errors.ts";

export type TokenKind = "word" | "string" | "op" | "lparen" | "rparen" | "comma" | "eof";

export interface Token {
  kind: TokenKind;
  /** For strings, the unescaped contents; otherwise the raw text. */
  text: string;
  pos: number;
}

const OPERATORS = ["!=", "!~", ">=", "<=", "=", "~", ">", "<", "!"];
// Characters that end an unquoted word. Anything else (letters, digits, "-", ".", "_", ...) is part of it,
// so values like WEB-12, 2026-10-01 and -7d lex as single words, as in Jira.
const WORD_STOP = /[\s()",'=!~<>]/;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen", text: ch, pos: i++ });
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", text: ch, pos: i++ });
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma", text: ch, pos: i++ });
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i++;
      let text = "";
      while (i < input.length && input[i] !== ch) {
        if (input[i] === "\\" && i + 1 < input.length) i++;
        text += input[i++];
      }
      if (i >= input.length) throw new LumoError("jql_syntax", `Unterminated string starting at position ${start}`);
      i++;
      tokens.push({ kind: "string", text, pos: start });
      continue;
    }
    const op = OPERATORS.find((o) => input.startsWith(o, i));
    if (op) {
      tokens.push({ kind: "op", text: op, pos: i });
      i += op.length;
      continue;
    }
    const start = i;
    while (i < input.length && !WORD_STOP.test(input[i]!)) i++;
    tokens.push({ kind: "word", text: input.slice(start, i), pos: start });
  }
  tokens.push({ kind: "eof", text: "", pos: input.length });
  return tokens;
}
