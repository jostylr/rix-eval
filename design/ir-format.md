# RiX IR Format Reference

The Intermediate Representation (IR) is the output of the lowering pass. Every IR node is a system function call:

```javascript
{ fn: "SYSTEM_FUNC_NAME", args: [...] }
```

Args can contain other IR nodes (nested calls), literal strings, numbers, or structured objects (for params, metadata).

---

## Complete System Function Catalog

### Variables & Assignment

| IR fn | Source syntax | Args | Description |
|-------|-------------|------|-------------|
| `LITERAL` | `42`, `3/4`, `0xFF` | `[value_string]` | Number literal (parsed at eval time) |
| `STRING` | `"hello"` | `[value_string]` | String literal |
| `NULL` | `_` | `[]` | Null value |
| `RETRIEVE` | `x`, `PI` | `[name]` | Variable/constant lookup |
| `ASSIGN` | `x = 5`, `x := 5` | `[name, value_ir]` | Variable assignment |
| `PLACEHOLDER` | `_1`, `_2` | `[place_number]` | Pipe placeholder |

### Arithmetic

| IR fn | Source | Args |
|-------|--------|------|
| `ADD` | `a + b` | `[left, right]` |
| `SUB` | `a - b` | `[left, right]` |
| `MUL` | `a * b`, `f(x)` | `[left, right]` |
| `DIV` | `a / b` | `[left, right]` |
| `INTDIV` | `a // b` | `[left, right]` |
| `MOD` | `a % b` | `[left, right]` |
| `POW` | `a ^ b` | `[left, right]` |
| `NEG` | `-x` | `[operand]` |

### Comparison

| IR fn | Source | Args |
|-------|--------|------|
| `EQ` | `a == b` | `[left, right]` |
| `NEQ` | `a != b` | `[left, right]` |
| `LT` | `a < b` | `[left, right]` |
| `GT` | `a > b` | `[left, right]` |
| `LTE` | `a <= b` | `[left, right]` |
| `GTE` | `a >= b` | `[left, right]` |

### Logic

| IR fn | Source | Args |
|-------|--------|------|
| `AND` | `a AND b` | `[left, right]` |
| `OR` | `a OR b` | `[left, right]` |
| `NOT` | `NOT a` | `[operand]` |

### Control Flow

| IR fn | Source | Args | Notes |
|-------|--------|------|-------|
| `BLOCK` | `{; a; b; c }`, `{{ a; b }}` | `[stmt1, stmt2, ...]` | Sequential execution |
| `CASE` | `{? cond1; cond2 }` | `[DEFER(c1), DEFER(c2), ...]` | Case/conditional with deferred args |
| `LOOP` | `{@ init; cond; body; upd }` | `[DEFER(init), DEFER(cond), ...]` | Loop with deferred args |
| `TERNARY` | `c ?? t ?: f` | `[condition, DEFER(true), DEFER(false)]` | Ternary conditional |
| `DEFER` | `@{...}` | `[body_ir]` | Deferred (lazy) computation |

### Functions

| IR fn | Source | Args |
|-------|--------|------|
| `CALL` | `F(x, y)` | `[name, arg1, arg2, ...]` |
| `CALL_EXPR` | `expr(x)` | `[expr_ir, arg1, ...]` |
| `FUNCDEF` | `f(x) :-> body` | `[name, params, body]` |
| `LAMBDA` | `(x) -> x^2` | `[params, body]` |
| `PATTERNDEF` | `g :=> [...]` | `[name, patterns]` |
| `KWARG` | `; a := 4` | `[key, value]` |
| `SYSREF` | `@_ASSIGN` | `[name]` |

### Collections

| IR fn | Source | Args |
|-------|--------|------|
| `ARRAY` | `[1, 2, 3]` | `[elem1, elem2, ...]` |
| `SET` | `{| 1, 2, 3 }` | `[elem1, elem2, ...]` |
| `MAP` | `{= a, b, c }` | `[elem1, elem2, ...]` |
| `TUPLE` | `{: a, b }`, `(a, b)` | `[elem1, elem2, ...]` |
| `INTERVAL` | `a : b` | `[low, high]` |
| `MATRIX` | matrix literal | `[row1, row2, ...]` |
| `TENSOR` | tensor literal | `[elem1, ...]` |

### Property Access

Two distinct concepts: **meta properties** (external annotations on any object, stored in `obj._ext`) and **collection indices/keys** (actual content of sequences and maps).

| IR fn | Source | Args | Notes |
|-------|--------|------|-------|
| `META_GET` | `obj.a` | `[object, property_name]` | Returns null if absent |
| `META_SET` | `obj.a = 7` | `[object, prop, value]` | null value = delete; respects immutable/frozen flags |
| `META_ALL` | `obj..` | `[object]` | Returns read-only copy of all meta properties as map |
| `META_MERGE` | `obj .= map` | `[object, map_ir]` | Bulk merge map into meta properties (null values = delete) |
| `INDEX_GET` | `arr[i]`, `arr[:key]` | `[object, index_ir]` | 1-based for sequences/strings; string or value keys for maps |
| `INDEX_SET` | `arr[i] = v` | `[object, index_ir, value]` | Requires `mutable=true` meta flag |
| `KEYS` | `obj.\|` | `[object]` | Returns set of map keys |
| `VALUES` | `obj\|.` | `[object]` | Returns set of map values |

**Syntax notes:**
- `obj.name` → `META_GET(obj, "name")` — meta/external properties, separate from map keys
- `obj[expr]` → `INDEX_GET(obj, expr)` — collection index or map key lookup
- `obj[:name]` → `INDEX_GET(obj, "name")` — string key literal syntax (KeyLiteral)
- `obj..name` → **parse error** (use `obj.name` for meta access)
- `obj..` → `META_ALL(obj)` — returns read-only copy of all meta properties
- `obj.Method(args)` → `CALL_EXPR(META_GET(obj, "Method"), obj, args...)` — method call desugaring

**Removed:** `DOT`, `INDEX`, `DOT_ASSIGN`, `INDEX_ASSIGN`, `EXTGET`, `EXTSET`, `EXTALL`

### Mutation

| IR fn | Source | Args |
|-------|--------|------|
| `MUTCOPY` | `obj{= +a=3 }` | `[target, operations]` |
| `MUTINPLACE` | `obj{! +a=3 }` | `[target, operations]` |

Operations array: `[{action: "add"|"remove", key: string, value: ir|null}]`

### Pipes

| IR fn | Source | Args |
|-------|--------|------|
| `PIPE` | `x \|> F` | `[value, fn]` |
| `PIPE_EXPLICIT` | `(a,b) \|\|> f(_2,_1)` | `[value, template]` |
| `PMAP` | `xs \|>> f` | `[collection, fn]` |
| `PFILTER` | `xs \|>? f` | `[collection, fn]` |
| `PREDUCE` | `xs \|>: f` | `[collection, fn]` |

### Solve / Assertions

| IR fn | Source | Args |
|-------|--------|------|
| `SOLVE` | `x :=: expr` | `[left, right]` |
| `ASSERT_LT` | `x :<: 5` | `[left, right]` |
| `ASSERT_GT` | `x :>: 5` | `[left, right]` |
| `ASSERT_LTE` | `x :<=: 5` | `[left, right]` |
| `ASSERT_GTE` | `x :>=: 5` | `[left, right]` |

### Calculus

| IR fn | Source | Args |
|-------|--------|------|
| `DERIVATIVE` | `f'`, `f''` | `[fn, order]` |
| `INTEGRAL` | `'expr` | `[expression]` |

### Interval Operations

| IR fn | Source | Args |
|-------|--------|------|
| `STEP` | `a:b :+ s` | `[interval, step]` |
| `DIVIDE` | `a:b :: n` | `[interval, count]` |
| `PARTITION` | `a:b :/: n` | `[interval, count]` |
| `MEDIANTS` | `a:b :~ n` | `[interval, levels]` |
| `RANDOM` | `a:b :% n` | `[interval, count]` |
| `INFSEQ` | `a ::+ s` | `[start, step]` |

### Units

| IR fn | Source | Args |
|-------|--------|------|
| `UNIT` | `3.2~[m]` | `[expr, unit_string]` |
| `MATHUNIT` | `2~{sqrt2}` | `[expr, unit_string]` |

### Postfix / Metadata

| IR fn | Source | Args |
|-------|--------|------|
| `AT` | `expr@(eps)` | `[target, arg]` |
| `ASK` | `expr?(key)` | `[target, arg]` |
| `WITH_META` | `[expr, k:=v]` | `[expr, metadata_obj]` |

### Meta / REPL

| IR fn | Source | Args |
|-------|--------|------|
| `COMMAND` | `HELP topic` | `[command_name, arg1, ...]` |
| `NOP` | `# comment` | `[]` |
| `EMBEDDED` | `` `lang code` `` | `[language, code]` |

---

## Parameter Format

Function parameters are lowered as:

```javascript
{
  positional: [{ name: "x", default: null }, { name: "n", default: IR_NODE }],
  keyword: [{ name: "a", default: IR_NODE }],
  conditionals: [IR_NODE, ...],
  metadata: {}
}
```

---

## Key Design Principles

1. **Flat tree** — every node is `{ fn, args }`, no special cases
2. **Deferred** — lazy args wrapped in `DEFER` nodes (CASE, LOOP, TERNARY branches)
3. **Direct mapping** — `@_ADD(a,b)` lowers to `{fn:"ADD", args:[...]}` with no indirection
4. **Name-based dispatch** — evaluator looks up `fn` in a registry to execute
5. **Configurable** — any system function can be swapped out for debugging/profiling
