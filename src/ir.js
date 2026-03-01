/**
 * IR Node constructors for the RiX lowering pass.
 *
 * IR format: { fn: "SYSTEM_FUNC_NAME", args: [...] }
 *
 * args can contain:
 *   - Other IR nodes (nested calls)
 *   - Literal strings (for variable names, etc.)
 *   - Literal numbers (preserved as strings for exact parsing)
 */

export function ir(fn, ...args) {
  return { fn, args };
}

// Convenience constructors for common IR nodes

export const IR = {
  // Literals & variables
  literal: (value) => ir("LITERAL", value),
  retrieve: (name) => ir("RETRIEVE", name),
  assign: (name, value) => ir("ASSIGN", name, value),
  global: (name, value) => ir("GLOBAL", name, value),

  // Arithmetic
  add: (a, b) => ir("ADD", a, b),
  sub: (a, b) => ir("SUB", a, b),
  mul: (a, b) => ir("MUL", a, b),
  div: (a, b) => ir("DIV", a, b),
  intdiv: (a, b) => ir("INTDIV", a, b),
  mod: (a, b) => ir("MOD", a, b),
  pow: (a, b) => ir("POW", a, b),
  neg: (a) => ir("NEG", a),

  // Comparison
  eq: (a, b) => ir("EQ", a, b),
  neq: (a, b) => ir("NEQ", a, b),
  lt: (a, b) => ir("LT", a, b),
  gt: (a, b) => ir("GT", a, b),
  lte: (a, b) => ir("LTE", a, b),
  gte: (a, b) => ir("GTE", a, b),

  // Logic
  and: (a, b) => ir("AND", a, b),
  or: (a, b) => ir("OR", a, b),
  not: (a) => ir("NOT", a),

  // Control flow
  block: (...stmts) => ir("BLOCK", ...stmts),
  cond: (...args) => ir("CASE", ...args),
  loop: (...args) => ir("LOOP", ...args),

  // Collections
  array: (...elems) => ir("ARRAY", ...elems),
  set: (...elems) => ir("SET", ...elems),
  map: (...pairs) => ir("MAP", ...pairs),
  tuple: (...elems) => ir("TUPLE", ...elems),
  interval: (lo, hi) => ir("INTERVAL", lo, hi),

  // Functions
  call: (name, ...args) => ir("CALL", name, ...args),
  lambda: (params, body) => ir("LAMBDA", params, body),
  pipe: (value, fn) => ir("PIPE", value, fn),
  pmap: (collection, fn) => ir("PMAP", collection, fn),
  pfilter: (collection, fn) => ir("PFILTER", collection, fn),
  preduce: (collection, fn, init) => ir("PREDUCE", collection, fn, init),

  // Deferred (lazy)
  defer: (body) => ir("DEFER", body),

  // Property / meta access
  metaGet: (obj, prop) => ir("META_GET", obj, prop),
  metaSet: (obj, prop, val) => ir("META_SET", obj, prop, val),
  metaAll: (obj) => ir("META_ALL", obj),
  metaMerge: (obj, map) => ir("META_MERGE", obj, map),
  indexGet: (obj, idx) => ir("INDEX_GET", obj, idx),
  indexSet: (obj, idx, val) => ir("INDEX_SET", obj, idx, val),
  keys: (obj) => ir("KEYS", obj),
  values: (obj) => ir("VALUES", obj),

  // Mutation
  mutcopy: (target, ops) => ir("MUTCOPY", target, ops),
  mutinplace: (target, ops) => ir("MUTINPLACE", target, ops),

  // Meta / REPL
  help: (...args) => ir("HELP", ...args),
  load: (...args) => ir("LOAD", ...args),
  unload: (...args) => ir("UNLOAD", ...args),
  command: (name, ...args) => ir("COMMAND", name, ...args),

  // System direct call (from @_ syntax)
  sys: (name, ...args) => ir(name, ...args),

  // Solve / assertions
  solve: (name, expr) => ir("SOLVE", name, expr),
  assertLt: (a, b) => ir("ASSERT_LT", a, b),
  assertGt: (a, b) => ir("ASSERT_GT", a, b),

  // Calculus
  derivative: (fn, order) => ir("DERIVATIVE", fn, order),
  integral: (fn) => ir("INTEGRAL", fn),

  // Null
  null: () => ir("NULL"),

  // Grouping (transparent — just passes through its content)
  identity: (val) => val,

  // Ternary
  ternary: (cond, ifTrue, ifFalse) => ir("TERNARY", cond, ifTrue, ifFalse),

  // Function definition
  funcdef: (name, params, body) => ir("FUNCDEF", name, params, body),
  patterndef: (name, patterns) => ir("PATTERNDEF", name, patterns),

  // Stepping / generators
  step: (start, end, stepSize) => ir("STEP", start, end, stepSize),
};
