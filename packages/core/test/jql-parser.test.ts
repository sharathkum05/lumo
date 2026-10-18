import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJql } from "../src/jql/parser.ts";
import { tokenize } from "../src/jql/lexer.ts";

test("lexer keeps issue keys, dates and relative durations as single words", () => {
  const words = tokenize("key = WEB-12 AND created >= -7d AND due < 2026-10-01")
    .filter((t) => t.kind === "word")
    .map((t) => t.text);
  assert.deepEqual(words, ["key", "WEB-12", "AND", "created", "-7d", "AND", "due", "2026-10-01"]);
});

test("lexer unescapes quoted strings", () => {
  const [t] = tokenize(String.raw`"say \"hi\""`);
  assert.deepEqual(t, { kind: "string", text: 'say "hi"', pos: 0 });
});

test("simple comparison", () => {
  assert.deepEqual(parseJql("project = WEB").where, {
    kind: "compare",
    field: "project",
    op: "=",
    operand: { kind: "value", value: "WEB" },
  });
});

test("AND binds tighter than OR", () => {
  const q = parseJql("a = 1 OR b = 2 AND c = 3");
  assert.equal(q.where?.kind, "or");
  if (q.where?.kind !== "or") return;
  assert.equal(q.where.clauses[1]?.kind, "and");
});

test("parentheses, NOT, IN lists and functions", () => {
  const q = parseJql('NOT (status IN ("To Do", Done) OR assignee = currentUser())');
  assert.deepEqual(q.where, {
    kind: "not",
    clause: {
      kind: "or",
      clauses: [
        {
          kind: "compare",
          field: "status",
          op: "in",
          operand: {
            kind: "list",
            items: [
              { kind: "value", value: "To Do" },
              { kind: "value", value: "Done" },
            ],
          },
        },
        { kind: "compare", field: "assignee", op: "=", operand: { kind: "function", name: "currentUser", args: [] } },
      ],
    },
  });
});

test("NOT IN, IS EMPTY and IS NOT NULL", () => {
  const q = parseJql("labels not in (a, b) and assignee is empty and due is not null");
  assert.equal(q.where?.kind, "and");
  if (q.where?.kind !== "and") return;
  assert.deepEqual(
    q.where.clauses.map((c) => (c.kind === "compare" ? c.op : c.kind)),
    ["not in", "is", "is not"],
  );
});

test("quoted field names", () => {
  const q = parseJql('"Story Points" > 3');
  assert.equal(q.where?.kind === "compare" && q.where.field, "Story Points");
});

test("ORDER BY with directions, with and without a filter", () => {
  assert.deepEqual(parseJql("project = WEB ORDER BY priority DESC, created").orderBy, [
    { field: "priority", direction: "desc" },
    { field: "created", direction: "asc" },
  ]);
  assert.deepEqual(parseJql("order by updated desc"), {
    where: null,
    orderBy: [{ field: "updated", direction: "desc" }],
  });
});

test("empty query", () => {
  assert.deepEqual(parseJql("   "), { where: null, orderBy: [] });
});

test("syntax errors say where", () => {
  assert.throws(() => parseJql("project ="), /Expected a value at end of query/);
  assert.throws(() => parseJql("project WEB"), /Expected an operator after field, got "WEB" at position 8/);
  assert.throws(() => parseJql("(a = 1"), /Expected "\)"/);
  assert.throws(() => parseJql('summary ~ "open'), /Unterminated string/);
});
