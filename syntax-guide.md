# RiX Syntax Guide

## Part 1: Syntax → System Function

### Operators

| Syntax | System Function | Example |
|--------|----------------|---------|
| `+` | `ADD` | `3 + 4` |
| `-` | `SUB` | `10 - 3` |
| `*` | `MUL` | `5 * 6` |
| `/` | `DIV` | `7 / 2` → `7/2` |
| `//` | `INTDIV` | `7 // 2` → `3` |
| `%` | `MOD` | `10 % 3` → `1` |
| `^` or `**` | `POW` | `2 ^ 10` → `1024` |
| `==` or `?=` | `EQ` | `x == 5` |
| `!=` | `NEQ` | `x != 0` |
| `<` or `?<` | `LT` | `a < b` |
| `>` or `?>` | `GT` | `a > b` |
| `<=` or `?<=` | `LTE` | `x <= 10` |
| `>=` or `?>=` | `GTE` | `x >= 0` |
| `&&` | `AND` | `a > 0 && b > 0` |
| `||` | `OR` | `x == 0 || y == 0` |
| `!` | `NOT` | `!(x == 0)` |
| `:=` or `=` | `ASSIGN` | `x := 5` or `x = 5` |
| `-` (unary) | `NEG` | `-x` |

### Assignment & Definition

| Syntax | System Function | Example |
|--------|----------------|---------|
| `x := expr` | `ASSIGN` | `x := 42` |
| `x = expr` | `ASSIGN` | `x = 42` |
| `F(x) -> body` | `FUNCDEF` | `Sq(x) -> x ^ 2` |
| `(x) -> body` | `LAMBDA` | `(x) -> x + 1` |

### Brace Containers

| Syntax | System Function | Description |
|--------|----------------|-------------|
| `{ a; b; c }` | `BLOCK` | Sequential execution, returns last value |
| `{; a; b; c }` | `BLOCK` | Sequential execution (explicit block) |
| `{? c1 ? v1; c2 ? v2; default }` | `CASE` | Conditional branching (if/elseif/else) |
| `{@ init; cond; body; update }` | `LOOP` | Loop with init, condition, body, update |
| `{$ eq1; eq2 }` | `SYSTEM` | Mathematical system (equations/assertions) |
| `{= k1=v1, k2=v2 }` | `MAP` | Map/object literal |
| `{\| a, b, c }` | `SET` | Set literal |
| `{: a, b, c }` | `TUPLE` | Tuple literal |
| `{+ a, b, c }` | `ADD` | N-ary addition or concatenation |
| `{* a, b, c }` | `MUL` | N-ary multiplication |
| `{&& a, b, c }` | `AND` | N-ary logical AND (short-circuits on falsy) |
| `{\|\| a, b, c }` | `OR` | N-ary logical OR (short-circuits on truthy) |
| `{\/ a, b, c }` | `NARY_UNION` | N-ary set union / interval hull |
| `{/\ a, b, c }` | `NARY_INTERSECT` | N-ary set intersection / interval overlap |
| `{++ a, b, c }` | `NARY_CONCAT` | N-ary concatenation |
| `{<< a, b, c }` | `MIN` | N-ary minimum (`null` args ignored) |
| `{>> a, b, c }` | `MAX` | N-ary maximum (`null` args ignored) |
| `{/pattern/flags?mode}` | `REGEX` | Regular expression literal |

### Deferred Syntax & System Aliases

| Syntax | Description | Example |
|--------|-------------|---------|
| `@{; ... }` | Deferred block (returns AST tree, does not evaluate) | `f = @{; x + 1 }` |
| `@{= ... }` | Deferred map | `lazyMap = @{= a=1 }` |
| `@+, @*, @<`, etc | System function retrieval | `f = @+; f(10, 20)` evaluates to `30` |

### Set & Interval Algebra

| Syntax | System Function | Example | Description |
|--------|----------------|---------|-------------|
| `A \/ B` | `UNION` | `S1 \/ S2` | Set union or interval hull |
| `A /\ B` | `INTERSECT` | `S1 /\ S2` | Set intersection or interval overlap |
| `A \ B` | `SET_DIFF` | `S1 \ S2` | Set/Map difference |
| `A <> B` | `SET_SYMDIFF` | `S1 <> S2` | Symmetric difference |
| `x ? S` | `MEMBER` | `5 ? 1:10` | Membership test (returns 1/null) |
| `x !? S` | `NOT_MEMBER` | `x !? S` | Non-membership test |
| `A ?& B` | `INTERSECTS` | `A ?& B` | Intersects predicate |
| `A ** B` | `SET_PROD` | `S1 ** S2` | Cartesian product |
| `A ++ B` | `CONCAT` | `[1,2] ++ [3,4]` | Concatenation (ordered collections/strings) |

N-ary brace notes:
- `{\/ X}` and `{/\ X}` return `X`.
- `{\/ }` and `{/\ }` return the empty set `{| |}`.
- `{++ X}` returns `X`, but `{++ }` is an error.
- `{<< X}`/`{>> X}` return `X`; `{<< }`/`{>> }` are errors.
- `<>` is binary only (no brace n-ary form).
- `<<`/`>>` in brace form are min/max, not bit shifts.

### Pipe Operators

Note that in the text version below there is a leading escape slash in front of the pipes for markdown table compatibility. In actual use, do not use the escape slash.

Collections in pipes are arrays, tuples (become arrays), and strings. 

| Syntax | System Function | Description |
|--------|----------------|-------------|
| `x \|> F` | `PIPE` | Pipe `x` as first arg to `F` (or concrete call if `F` is partial) |
| `x \|\|> F(_1)` | `PIPE_EXPLICIT` | Alias for `PIPE`; used with placeholders for clarity |
| `coll \|>/ i:j` | `PSLICE_STRICT` | Strict slice a collection based on interval; `null` if bounds are non-integers or invalid |
| `coll \|>// i:j` | `PSLICE_CLAMP` | Clamped slice a collection based on interval; clamps exactly without failing |
| `coll \|>\| sep` | `PSPLIT` | Split string or collection by delimiter string, regex or predicate |
| `coll \|>#\| nOrFn`| `PCHUNK` | Chunk string or collection by integer size or predicate boundary |
| `coll \|>> fn` | `PMAP` | Map `fn` over collection |
| `coll \|>? pred` | `PFILTER` | Filter collection by predicate |
| `coll \|>: fn` | `PREDUCE` | Reduce (first element as init) |
| `coll \|:> init >: fn` | `PREDUCE` | Reduce with explicit initial value |
| `coll \|><` | `PREVERSE` | Reverse collection (new copy) |
| `coll \|<> fn` | `PSORT` | Sort with comparator (new copy) |
| `coll \|>&& pred` | `PALL` | Every: last item if all pass, `null` on first failure or empty (short-circuits) |
| `coll \|>\|\| pred` | `PANY` | Any/Some: first passing item, `null` if none pass or empty (short-circuits) |

All pipe operators return **new** collections; they never mutate the original.

### Partial Functions & Placeholders

| Syntax | Description | Example |
|--------|-------------|---------|
| `_1`, `_2`, ... | Argument placeholders (1-indexed) | `Double = @*(_1, 2)` |
| `__1`, `__2`, ... | Alternative placeholder syntax | `Double = @*(__1, 2)` |

Partial application occurs when a function is called with one or more placeholders. This returns a `[Partial: N]` object (where `N` is the arity).

- **Reordering**: `@-(_2, _1)` creates a function that subtracts its first argument from its second.
- **Duplication**: `F(_1, _1)` calls `F` with the same argument in both slots.
- **Integration**: Works seamlessly with pipes: `[1, 2, 3] |>> @*(_1, 10)` → `[10, 20, 30]`.
- **Automatic Appending**: Any arguments passed to a partial that aren't consumed by placeholders are appended. For example, if `F(a, b, c)` is called via `G = F(_1, _2)`, then `G(1, 2, 3)` becomes `F(1, 2, 3)`.

| Syntax | Description | Example |
|--------|-------------|---------|
| `\|+n` | Add `n` to previous (arithmetic) | `[2, \|+2, \|; 5]` → `[2,4,6,8,10]` |
| `\|*n` | Multiply previous by `n` (geometric) | `[1, \|*3, \|; 4]` → `[1,3,9,27]` |
| `\|:f` | Generator by index | `[\|: (i) -> i^2, \|; 5]` → `[0,1,4,9,16]` |
| `\|>f` | Pipe previous values (recursion) | `[1,1, \|>(a,b)->a+b, \|; 7]` |
| `\|?p` | Filter predicate | `[1,2,3,4, \|? (x)->x%2==0]` |
| `\|;n` | Stop after `n` elements (eager) | `[2, \|+2, \|; 5]` |
| `\|;f` | Stop when `f` returns true | `[2, \|+2, \|; (x)->x>10]` |
| `\|^n` | Lazy generator, limit `n` | `[1, \|+1, \|^ 1000]` |
| `\|^f` | Lazy, stop when `f` true | `[2, \|+2, \|^ (x)->x>100]` |

### Collection Syntax

| Syntax | System Function | Example |
|--------|----------------|---------|
| `[a, b, c]` | `ARRAY` | `[1, 2, 3]` |
| `a:b` | `INTERVAL` | `1:10` (RationalInterval) |
| `a:b:c:d...` | `INTERVAL` | `2:3:5:7` (n-ary betweenness) |
| `a:(b:c):d` | `INTERVAL` | `2:(3:4):5` (nested betweenness) |
| `a:{|b:c|}:d` | `INTERVAL` | `2:{|3:4|}:5` (set unpacking) |

### Special Number Literals

These formats all produce exact rational values parsed by `LITERAL`.

#### Repeating Decimals (`#`)

The `#` separates the non-repeating fractional part from the (infinitely) repeating part.

| Syntax | Value | Notes |
|--------|-------|-------|
| `1.23#45` | 1.234̄5̄… | non-repeating `23`, repeating `45` |
| `0.#3` | 1/3 | no non-repeating fractional digits |
| `1.#6` | 5/3 | integer + immediate repeating |
| `5#3` | 16/3 | integer part with repeating decimal |

#### Radix Shift (`_^`)

`n_^k` multiplies `n` by `10^k`. Positive exponent shifts the decimal right; negative shifts left.

| Syntax | Value | Notes |
|--------|-------|-------|
| `1_^2` | 100 | 1 × 10² |
| `3.14_^2` | 314 | 3.14 × 10² |
| `1_^-2` | 1/100 | 1 × 10⁻² |
| `1/3_^2` | 100/3 | 1/3 × 10² |

#### Continued Fractions (`.~`)

A continued fraction `[a₀; a₁, a₂, …]` is written as `a₀.~a₁~a₂~…`.

**Implicit-start** — unsigned integer part, no leading `~`:

| Syntax | Value |
|--------|-------|
| `3.~7~15~1` | 355/113 |
| `1.~2` | 3/2 |

**Explicit-start** — leading `~` marker, allows a signed integer part:

| Syntax | Value | Notes |
|--------|-------|-------|
| `~1.~2` | 3/2 | same as `1.~2` |
| `~-1.~2` | −1/2 | first coefficient is −1 |
| `~-2.~1~2~2` | −9/7 | |

**Negating the CF value** — unary minus on an explicit-start CF:

| Syntax | Value | Notes |
|--------|-------|-------|
| `-~1.~2` | −3/2 | negate the value of `~1.~2` (= 3/2) |

**Forbidden — syntax error:**
```
-1.~2      ## ❌  ambiguous: write ~-1.~2 (neg. coefficient) or -~1.~2 (negate value)
```

### Number Base Literals

| Prefix | Base System | Example | System Function |
|--------|-------------|---------|-----------------|
| `0x` | Hexadecimal (16) | `0xFF` | `LITERAL` |
| `0b` | Binary (2) | `0b1010` | `LITERAL` |
| `0o` | Octal (8) | `0o755` | `LITERAL` |
| `0t` | Ternary (3) | `0t121` | `LITERAL` |
| `0z[N]` | Base N | `0z[32]abc` | `LITERAL` |

Other registered prefixes: `0q` (Base 4), `0f` (5), `0s` (7), `0d` (12), `0v` (20), `0u` (36), `0m` (60), `0y` (64).

Custom uppercase prefixes can be defined at runtime:
- `0A = "0123456789ABCDEF"`
- `0B = {: 2, "01" }`

Base conversion operators:
- `_>`: `value _> baseSpec` returns a string in that base.
- `<_`: `string <_ baseSpec` parses into an exact rational/integer.

Quoted prefixed literals are also valid:
- `0A"4A.F"`

### Property & Meta Access

RiX separates two distinct access concepts: **meta properties** (external annotations on any value, accessed with `.`) and **collection indices/keys** (actual content of sequences and maps, accessed with `[...]`).

| Syntax | System Function | Description |
|--------|----------------|-------------|
| `obj.name` | `META_GET` | Get meta property (returns null if absent) |
| `obj.name = val` | `META_SET` | Set meta property (null value = delete; respects immutable/frozen) |
| `obj..` | `META_ALL` | Get all meta properties as read-only map |
| `obj .= map` | `META_MERGE` | Bulk merge map into meta properties (null values = delete) |
| `obj[expr]` | `INDEX_GET` | Index into collection (1-based for sequences/strings; key for maps) |
| `obj[:name]` | `INDEX_GET` | Map access by string key literal |
| `obj[i] = val` | `INDEX_SET` | Set collection index (allowed by default for arrays and maps; requires `mutable=1`) |
| `obj.\|` | `KEYS` | Get set of map keys |
| `obj\|.` | `VALUES` | Get set of map values |
| `obj.Method(args)` | `CALL_EXPR` | Method call — desugars to `CALL_EXPR(META_GET(obj,"Method"), obj, args...)` |

**Note:** `obj..name` is a **parse error** — use `obj.name` for meta access.

### Assertions

| Syntax | System Function | Description |
|--------|----------------|-------------|
| `:=:` | `SOLVE` | Solve/assert equality (assigns to variable to satisfy expr) |
| `:<:` | `ASSERT_LT` | Assert less than |
| `:>:` | `ASSERT_GT` | Assert greater than |
| `:<=:` | `ASSERT_LTE` | Assert less or equal |
| `:>=:` | `ASSERT_GTE` | Assert greater or equal |

### Comments

| Syntax | Description | Example |
|--------|-------------|---------|
| `## text` | Line comment | `## This is a comment` |
| `/* text */` | Block comment | `/* multi-line */` |
| `##TAG## ... ##TAG##` | Tagged multi-line | `##NOTE## long comment ##NOTE##` |

### Division Variants

| Syntax | System Function | Description |
|--------|----------------|-------------|
| `/^` | `DIVUP` | Ceiling division |
| `/~` | `DIVROUND` | Rounded division |
| `/%` | `DIVMOD` | Division with remainder |

### Ternary Operator

| Syntax | System Function | Example |
|--------|----------------|---------|
| `cond ?? trueVal ?: falseVal` | `TERNARY` | `x > 0 ?? "pos" ?: "neg"` |

---

## Part 2: System Function Reference

### Core

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `LITERAL(str)` | Parse number literal string (with base prefixes) | — |
| `STRING(val)` | Create string value | `"..."` |
| `NULL()` | Null value | `_` |
| `ASSIGN(name, val)` | Local assignment | `x = 5`, `x := 5` |
| `RETRIEVE(name)` | Variable lookup | `x` |

### Arithmetic

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `ADD(a, b)` | Addition | `a + b` |
| `SUB(a, b)` | Subtraction | `a - b` |
| `MUL(a, b)` | Multiplication | `a * b` |
| `DIV(a, b)` | Rational division | `a / b` |
| `INTDIV(a, b)` | Integer (floor) division | `a // b` |
| `MOD(a, b)` | Modulo | `a % b` |
| `POW(a, b)` | Exponentiation | `a ^ b`, `a ** b` |
| `NEG(a)` | Negation | `-a` |
| `ABS(a)` | Absolute value | — |
| `SQRT(a)` | Square root | — |

### Comparison

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `EQ(a, b)` | Equal (returns 1 or null _ ) | `a == b`, `a ?= b` |
| `NEQ(a, b)` | Not equal | `a != b` |
| `LT(a, b)` | Less than | `a < b`, `a ?< b` |
| `GT(a, b)` | Greater than | `a > b`, `a ?> b` |
| `LTE(a, b)` | Less or equal | `a <= b`, `a ?<= b` |
| `GTE(a, b)` | Greater or equal | `a >= b`, `a ?>= b` |
| `MIN(args...)` | N-ary minimum (numbers or strings; null args ignored) | `{<< a, b, c }` |
| `MAX(args...)` | N-ary maximum (numbers or strings; null args ignored) | `{>> a, b, c }` |

### Logic

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `AND(a, b)` | Logical AND | `&&` |
| `OR(a, b)` | Logical OR | `||` |
| `NOT(a)` | Logical NOT | `!` |

### Assertions & Constraints

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `SOLVE(name, expr)` | Solve/constrain variable | `:=:` |
| `ASSERT_LT(a, b)` | Assert `a < b` | `:<:` |
| `ASSERT_GT(a, b)` | Assert `a > b` | `:>:` |
| `ASSERT_LTE(a, b)` | Assert `a <= b` | `:<=:` |
| `ASSERT_GTE(a, b)` | Assert `a >= b` | `:>=:` |

### Control Flow

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `BLOCK(stmts...)` | Execute sequentially, return last | `{ a; b }`, `{; a; b }` |
| `CASE(branches...)` | If/elseif/else branching | `{? cond ? val; default }` |
| `LOOP(init, cond, body, update)` | Loop | `{@ init; cond; body; update }` |
| `SYSTEM(stmts...)` | Mathematical system container | `{$ eq1; eq2 }` |
| `TERNARY(cond, t, f)` | Ternary conditional | `cond ?? t ?: f` |
| `IF(cond, t, f)` | If-then-else (stdlib) | — |
| `MULTI(a, b, c...)` | Evaluate all, return last (stdlib) | — |

### Collections

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `ARRAY(elems...)` | Create sequence | `[a, b, c]` |
| `SET(elems...)` | Create set | `{\| a, b, c \|}` |
| `TUPLE(elems...)` | Create tuple | `{: a, b, c }` |
| `MAP(pairs...)` | Create map/object | `{= k=v, ... }` |
| `INTERVAL(args...)` | Create interval or check n-ary betweenness (unpacks nested intervals/sets) | `a:b` or `a:b:c...` |
| `UNION(a, b)` | Binary set union / interval hull | `A \/ B` |
| `INTERSECT(a, b)` | Binary set intersection / interval overlap | `A /\ B` |
| `CONCAT(a, b)` | Binary concatenation | `A ++ B` |
| `NARY_UNION(args...)` | N-ary set union / interval hull | `{\/ A, B, C }` |
| `NARY_INTERSECT(args...)` | N-ary set intersection / interval overlap | `{/\ A, B, C }` |
| `NARY_CONCAT(args...)` | N-ary concatenation | `{++ A, B, C }` |
| `LEN(coll)` | Length of collection/string | — |
| `FIRST(coll)` | First element | — |
| `LAST(coll)` | Last element | — |
| `GETEL(coll, i)` | Get element at 1-based index | — |
| `IRANGE(start, end)` | Integer range `[start, end]` | — |

### Functional / Pipes

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `PIPE(val, fn)` | Pipe value into function | `val \|> fn` |
| `PIPE_EXPLICIT(val, fn)` | Pipe value into function explicitly | `val \|\|> fn` |
| `PSLICE_STRICT(coll, i:j)` | Strict slice collection | `coll \|>/ i:j` |
| `PSLICE_CLAMP(coll, i:j)` | Clamped slice collection | `coll \|>// i:j` |
| `PSPLIT(coll, sep)` | Split collection by delimiter | `coll \|>/\| sep` |
| `PCHUNK(coll, n)` | Chunk collection by size or predicate | `coll \|>#\| nOrFn` |
| `PMAP(coll, fn)` | Map function over collection | `coll \|>> fn`, `MAP(coll, fn)` |
| `PFILTER(coll, pred)` | Filter by predicate | `coll \|>? pred`, `FILTER(coll, pred)` |
| `PREDUCE(coll, fn, init)` | Reduce/fold | `coll \|>: fn`, `coll \|:> init >: fn`, `REDUCE(coll, fn, init)` |
| `PREVERSE(coll)` | Reverse collection (new copy) | `coll \|><` |
| `PSORT(coll, fn)` | Sort with comparator (new copy) | `coll \|<> fn` |

### Functions

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `FUNCDEF(name, params, body)` | Define named function | `Name(params) -> body` |
| `LAMBDA(params, body)` | Anonymous function | `(params) -> body` |
| `CALL(name, args...)` | Call a function | `Name(args)` |

| `UPPER(str)` | Convert to uppercase |
| `SUBSTR(str, start, len)` | Get substring |

### Property & Meta Access

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `META_GET(obj, name)` | Get meta property (null if absent) | `obj.name` |
| `META_SET(obj, name, val)` | Set meta property (null = delete; respects immutable/frozen) | `obj.name = val` |
| `META_ALL(obj)` | Get all meta properties as read-only map | `obj..` |
| `META_MERGE(obj, map)` | Bulk merge map into meta (null values = delete) | `obj .= map` |
| `INDEX_GET(obj, key)` | Index into collection (1-based for sequences/strings; string/value keys for maps) | `obj[expr]`, `obj[:name]` |
| `INDEX_SET(obj, key, val)` | Set index (requires `mutable=1` meta flag) | `obj[i] = val` |
| `KEYS(obj)` | Get keys of map as set | `obj.\|` |
| `VALUES(obj)` | Get values of map as set | `obj\|.` |

**Mutability & Locking:**
- **`mutable`**: By default, **arrays** and **maps** are created with `mutable=1`. This allows modification after creation using `INDEX_SET` (e.g., `arr[1] = 99`). To lock an object against further modification, set `obj.mutable = _`.
- **`frozen`**: When `frozen=1`, no meta properties can be changed except for `frozen` itself. This provides a "temporary lock" on meta settings.
- **`immutable`**: When `immutable=1`, the object is permanently locked. No meta properties (including `immutable` or `frozen`) can be changed.

### Regex

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `REGEX(pat, fl, mode)` | Create regex matching function | `{/pat/fl?mode}` |

### I/O

| Function | Description |
|----------|-------------|
| `PRINT(args...)` | Print each argument on a separate line |

### Variables

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `ASSIGN(name, val)` | Set local variable | `name := val`, `name = val` |
| `GLOBAL(name, val)` | Set global variable | — |
| `RETRIEVE(name)` | Look up variable | `name` |
| `OUTER_ASSIGN(name, val)` | Set an existing outer scope variable | `@name = val`, `@name += val`, etc. |
| `OUTER_RETRIEVE(name)` | Look up an outer scope variable | `@name` |

### Future Extensions (Stubs)

| Function | Description |
|----------|-------------|
| `DERIVATIVE(expr, var)` | Symbolic derivative (future) |
| `INTEGRAL(expr, var)` | Symbolic integral (future) |
| `GENERATOR(args...)` | Sequence generator (future) |
| `STEP(start, end, step)` | Step/range generator (future) |
| `MATRIX(rows...)` | Matrix literal |
| `TENSOR(data...)` | Tensor literal |
| `UNIT(val, unit)` | Scientific unit annotation |
| `MATHUNIT(val, unit)` | Mathematical unit annotation |

*Note: Combo assignments (`+=`, `-=`, `*=`, `/=`, `//=`, `%=`, `^=`) automatically desugar into `ASSIGN(x, OP(RETRIEVE(x), y))` or their `OUTER` equivalents if prefixed with `@`.*

---

## Part 3: REPL Dot-Commands

REPL-specific commands start with a dot. They are not part of the RiX language itself but provide tooling and reflection.

| Command | Description | Example |
|---------|-------------|---------|
| `.help` | Show help message | `.help` |
| `.exit` | Exit REPL | `.exit` |
| `.load[pkg]` | Load a package/file | `.load[:stats]` |
| `.vars` | List all variables in current context | `.vars` |
| `.fns` | List all registered system functions | `.fns` |
| `.reset` | Clear the current context | `.reset` |
| `.ast[expr]` | Show AST for an expression | `.ast[1 + 2]` |
| `.tokens[expr]`| Show tokens for an expression | `.tokens[x = 5]` |
| `.Name(args)` | Call a capitalized command (function-style) | `.Print(1, 2, 3)` |

**Ctrl-C Behavior:**
- If the current line is non-empty, Ctrl-C clears the line.
- If the current line is empty, Ctrl-C exits the REPL.
