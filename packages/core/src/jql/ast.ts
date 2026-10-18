export type Operator = "=" | "!=" | "~" | "!~" | ">" | ">=" | "<" | "<=" | "in" | "not in" | "is" | "is not";

export type Operand =
  | { kind: "value"; value: string }
  | { kind: "function"; name: string; args: string[] }
  | { kind: "list"; items: Operand[] }
  | { kind: "empty" };

export type Clause =
  | { kind: "and"; clauses: Clause[] }
  | { kind: "or"; clauses: Clause[] }
  | { kind: "not"; clause: Clause }
  | { kind: "compare"; field: string; op: Operator; operand: Operand };

export interface OrderBy {
  field: string;
  direction: "asc" | "desc";
}

export interface Query {
  where: Clause | null;
  orderBy: OrderBy[];
}
