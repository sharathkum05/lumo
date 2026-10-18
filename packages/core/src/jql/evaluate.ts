import { LumoError } from "../errors.ts";
import type { Clause, Operand, OrderBy, Query } from "./ast.ts";

export type Scalar = string | number | null;

/**
 * - `string`: exact, case-insensitive match (status, project, labels, users)
 * - `text`: `~` matches when every word of the value appears (summary, description)
 * - `date`: ISO timestamps; operands may be dates, datetimes or relative offsets like -7d
 * - `number`: numeric comparison
 * - `ordinal`: ordered list of names, so `priority > Medium` works
 */
export type FieldType = "string" | "text" | "date" | "number" | "ordinal";

export interface FieldDef<R> {
  /** The canonical name first, then aliases. Matched case-insensitively. */
  names: string[];
  type: FieldType;
  get(record: R): Scalar | Scalar[];
  /** For `ordinal` fields: values from lowest to highest. */
  order?: readonly string[];
  /** Overrides the sort value used by ORDER BY. */
  sortValue?(record: R): string | number | null;
}

export interface JqlContext {
  /** Every value that identifies the current user (id, username, email, ...), or null if anonymous. */
  currentUser: string[] | null;
  now: Date;
}

export interface CompiledQuery<R> {
  matches(record: R): boolean;
  compare(a: R, b: R): number;
}

export function compileJql<R>(query: Query, fields: FieldDef<R>[], ctx: JqlContext): CompiledQuery<R> {
  const byName = new Map<string, FieldDef<R>>();
  for (const f of fields) for (const n of f.names) byName.set(n.toLowerCase(), f);
  const lookup = (name: string): FieldDef<R> => {
    const f = byName.get(name.toLowerCase());
    if (!f) throw new LumoError("jql_syntax", `Field "${name}" does not exist`);
    return f;
  };

  const predicate = query.where ? compileClause(query.where, lookup, ctx) : () => true;
  const sorters = query.orderBy.map((o) => compileSort(o, lookup(o.field)));
  return {
    matches: predicate,
    compare(a, b) {
      for (const s of sorters) {
        const c = s(a, b);
        if (c !== 0) return c;
      }
      return 0;
    },
  };
}

type Predicate<R> = (record: R) => boolean;

function compileClause<R>(clause: Clause, lookup: (n: string) => FieldDef<R>, ctx: JqlContext): Predicate<R> {
  switch (clause.kind) {
    case "and": {
      const parts = clause.clauses.map((c) => compileClause(c, lookup, ctx));
      return (r) => parts.every((p) => p(r));
    }
    case "or": {
      const parts = clause.clauses.map((c) => compileClause(c, lookup, ctx));
      return (r) => parts.some((p) => p(r));
    }
    case "not": {
      const inner = compileClause(clause.clause, lookup, ctx);
      return (r) => !inner(r);
    }
    case "compare":
      return compileCompare(clause, lookup(clause.field), ctx);
  }
}

function compileCompare<R>(
  clause: Extract<Clause, { kind: "compare" }>,
  field: FieldDef<R>,
  ctx: JqlContext,
): Predicate<R> {
  const values = (r: R): Scalar[] => {
    const v = field.get(r);
    return (Array.isArray(v) ? v : [v]).filter((x) => x !== null && x !== "");
  };
  const { op } = clause;

  if (op === "is" || op === "is not") {
    return op === "is" ? (r) => values(r).length === 0 : (r) => values(r).length > 0;
  }
  if (clause.operand.kind === "empty") {
    if (op === "=" || op === "in") return (r) => values(r).length === 0;
    if (op === "!=" || op === "not in") return (r) => values(r).length > 0;
    throw new LumoError("jql_syntax", `Operator "${op}" cannot be used with EMPTY`);
  }

  const operands = resolveOperand(clause.operand, field, ctx);
  if (clause.operand.kind === "list" && op !== "in" && op !== "not in") {
    throw new LumoError("jql_syntax", `Use IN or NOT IN with a list of values`);
  }
  const test = matcher(field, op, operands, ctx.now.getTime());
  // Negative operators only match issues that have a value, as in Jira: `assignee != bob` skips unassigned issues.
  if (op === "!=" || op === "not in" || op === "!~") {
    return (r) => {
      const vs = values(r);
      return vs.length > 0 && !vs.some(test);
    };
  }
  return (r) => values(r).some(test);
}

function resolveOperand<R>(operand: Operand, field: FieldDef<R>, ctx: JqlContext): string[] {
  switch (operand.kind) {
    case "value":
      return [operand.value];
    case "list":
      return operand.items.flatMap((o) => resolveOperand(o, field, ctx));
    case "empty":
      return [];
    case "function":
      return callFunction(operand.name, operand.args, ctx);
  }
}

function callFunction(name: string, args: string[], ctx: JqlContext): string[] {
  const fn = name.toLowerCase();
  if (fn === "currentuser") return ctx.currentUser ?? [];
  if (fn !== "now" && fn !== "startofday" && fn !== "endofday") {
    throw new LumoError("jql_syntax", `Unknown function "${name}()"`);
  }
  const offset = args[0] ? parseRelative(args[0]) : 0;
  if (offset === null) throw new LumoError("jql_syntax", `Invalid offset "${args[0]}" for ${name}()`);
  const day = new Date(ctx.now);
  day.setUTCHours(0, 0, 0, 0);
  switch (fn) {
    case "now":
      return [new Date(ctx.now.getTime() + offset).toISOString()];
    case "startofday":
      return [new Date(day.getTime() + offset).toISOString()];
    default:
      return [new Date(day.getTime() + DAY - 1 + offset).toISOString()];
  }
}

function matcher<R>(field: FieldDef<R>, op: string, operands: string[], now: number): (value: Scalar) => boolean {
  switch (field.type) {
    case "string":
    case "text": {
      const wanted = operands.map((o) => o.toLowerCase());
      if (op === "~" || op === "!~") {
        const terms = wanted.flatMap((w) => w.split(/\s+/).filter(Boolean));
        return (v) => {
          const s = String(v).toLowerCase();
          return terms.every((t) => s.includes(t));
        };
      }
      if (op === "=" || op === "!=" || op === "in" || op === "not in") {
        return (v) => wanted.includes(String(v).toLowerCase());
      }
      throw unsupported(field, op);
    }
    case "number": {
      const nums = operands.map((o) => {
        const n = Number(o);
        if (Number.isNaN(n)) throw new LumoError("jql_syntax", `"${o}" is not a number for field "${field.names[0]}"`);
        return n;
      });
      return (v) => nums.some((n) => compareOp(op, Number(v), n, n, field));
    }
    case "ordinal": {
      const order = (field.order ?? []).map((o) => o.toLowerCase());
      const rank = (s: string): number => {
        const i = order.indexOf(s.toLowerCase());
        if (i < 0) {
          throw new LumoError("jql_syntax", `The value "${s}" does not exist for field "${field.names[0]}"`);
        }
        return i;
      };
      const ranks = operands.map(rank);
      return (v) => {
        const r = order.indexOf(String(v).toLowerCase());
        return r >= 0 && ranks.some((n) => compareOp(op, r, n, n, field));
      };
    }
    case "date": {
      const ranges = operands.map((o) => {
        const range = parseDateOperand(o, now);
        if (!range) throw new LumoError("jql_syntax", `"${o}" is not a valid date for field "${field.names[0]}"`);
        return range;
      });
      return (v) => {
        const t = Date.parse(String(v));
        return !Number.isNaN(t) && ranges.some(([start, end]) => compareOp(op, t, start, end, field));
      };
    }
  }
}

/** Compares `x` against the half-open range [start, end); for points, end === start (+1 for dates). */
function compareOp<R>(op: string, x: number, start: number, end: number, field: FieldDef<R>): boolean {
  const hi = end === start ? end : end - 1;
  switch (op) {
    case "=":
    case "!=":
    case "in":
    case "not in":
      return x >= start && x <= hi;
    case ">":
      return x > hi;
    case ">=":
      return x >= start;
    case "<":
      return x < start;
    case "<=":
      return x <= hi;
    default:
      throw unsupported(field, op);
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const UNITS: Record<string, number> = { m: MINUTE, h: HOUR, d: DAY, w: 7 * DAY };

function parseRelative(s: string): number | null {
  const parts = /^([+-]?)(\d+)([mhdw])$/i.exec(s.trim());
  if (!parts) return null;
  const ms = Number(parts[2]) * UNITS[parts[3]!.toLowerCase()]!;
  return parts[1] === "-" ? -ms : ms;
}

/** Returns the [start, end) range a date operand covers. A bare date covers the whole (UTC) day. */
function parseDateOperand(s: string, now: number): [number, number] | null {
  const rel = parseRelative(s);
  if (rel !== null) return [now + rel, now + rel];
  const dateOnly = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(s);
  if (dateOnly) {
    const start = Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return [start, start + DAY];
  }
  const t = Date.parse(s.replace(/^(\d{4})\/(\d{2})\/(\d{2})/, "$1-$2-$3").replace(" ", "T"));
  return Number.isNaN(t) ? null : [t, t];
}

function compileSort<R>(order: OrderBy, field: FieldDef<R>): (a: R, b: R) => number {
  const key = (r: R): string | number | null => {
    if (field.sortValue) return field.sortValue(r);
    const raw = field.get(r);
    const v = Array.isArray(raw) ? (raw[0] ?? null) : raw;
    if (v === null || v === "") return null;
    if (field.type === "ordinal") return (field.order ?? []).findIndex((o) => o.toLowerCase() === String(v).toLowerCase());
    if (field.type === "date") return Date.parse(String(v));
    if (field.type === "number") return Number(v);
    return String(v).toLowerCase();
  };
  const dir = order.direction === "desc" ? -1 : 1;
  return (a, b) => {
    const x = key(a);
    const y = key(b);
    // Empty values sort last in both directions.
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    if (x < y) return -dir;
    if (x > y) return dir;
    return 0;
  };
}

function unsupported<R>(field: FieldDef<R>, op: string): LumoError {
  return new LumoError("jql_syntax", `Operator "${op}" is not supported for field "${field.names[0]}"`);
}
