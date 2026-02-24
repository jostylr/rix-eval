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
| `AND` or `&&` | `AND` | `a > 0 && b > 0` |
| `OR` or `\|\|` | `OR` | `x == 0 \|\| y == 0` |
| `NOT` or `!` | `NOT` | `!(x == 0)` |
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
| `{; a; b; c }` | `BLOCK` | Sequential execution, returns last value |
| `{? c1 ? v1; c2 ? v2; default }` | `CASE` | Conditional branching (if/elseif/else) |
| `{@ init; cond; body; update }` | `LOOP` | Loop with init, condition, body, update |
| `{= k1=v1, k2=v2 }` | `MAP` | Map/object literal |
| `{\| a, b, c }` | `SET` | Set literal |
| `{: a, b, c }` | `TUPLE` | Tuple literal |
| `{+ a, b, c }` | `ADD` | N-ary addition or concatenation |
| `{* a, b, c }` | `MUL` | N-ary multiplication |
| `{&& a, b, c }` | `AND` | N-ary logical AND (short-circuits on falsy) |
| `{\|\| a, b, c }` | `OR` | N-ary logical OR (short-circuits on truthy) |
| `{/pattern/flags?mode}` | `REGEX` | Regular expression literal |

### Deferred Syntax & System Aliases

| Syntax | Description | Example |
|--------|-------------|---------|
| `@{; ... }` | Deferred block (returns AST tree, does not evaluate) | `f = @{; x + 1 }` |
| `@{= ... }` | Deferred map | `lazyMap = @{= a=1 }` |
| `@+, @*, @<`, etc | System function retrieval | `f = @+; f(10, 20)` evaluates to `30` |

### Pipe Operators

Note that in the text version below there is a leading escape slash in front of the pipes for markdown table compatibility. In actual use, do not use the escape slash.

| Syntax | System Function | Description |
|--------|----------------|-------------|
| `x \|> F` | `PIPE` | Pipe `x` as first arg to `F` |
| `x \|\|> F(_1)` | `PIPE_EXPLICIT` | Pipe with explicit placeholder |
| `coll \|>/ i:j` | `PSLICE_STRICT` | Strict slice a collection based on interval; `null` if bounds are non-integers or invalid |
| `coll \|>// i:j` | `PSLICE_CLAMP` | Clamped slice a collection based on interval; clamps exactly without failing |
| `coll \|>> fn` | `PMAP` | Map `fn` over collection |
| `coll \|>? pred` | `PFILTER` | Filter collection by predicate |
| `coll \|>: fn` | `PREDUCE` | Reduce (first element as init) |
| `coll \|:> init >: fn` | `PREDUCE` | Reduce with explicit initial value |
| `coll \|><` | `PREVERSE` | Reverse collection (new copy) |
| `coll \|<> fn` | `PSORT` | Sort with comparator (new copy) |
| `coll |>&& pred` | `PALL` | Every: last item if all pass, `null` on first failure or empty (short-circuits) |
| `coll |>\|\| pred` | `PANY` | Any/Some: first passing item, `null` if none pass or empty (short-circuits) |

All pipe operators return **new** collections; they never mutate the original.

### Sequence Generation (inside `[...]`)

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

### Number Base Literals

| Prefix | Base System | Example | System Function |
|--------|-------------|---------|-----------------|
| `0x` | Hexadecimal (16) | `0xFF` | `LITERAL` |
| `0b` | Binary (2) | `0b1010` | `LITERAL` |
| `0o` | Octal (8) | `0o755` | `LITERAL` |
| `0t` | Ternary (3) | `0t121` | `LITERAL` |
| `0z[N]` | Base N | `0z[32]abc` | `LITERAL` |

Other registered prefixes: `0q` (Base 4), `0f` (5), `0s` (7), `0d` (12), `0v` (20), `0u` (36), `0m` (60), `0y` (64).

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

### Logic

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `AND(a, b)` | Logical AND | `a AND b` |
| `OR(a, b)` | Logical OR | `a OR b` |
| `NOT(a)` | Logical NOT | `NOT(expr)` or prefix `NOT expr` |

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
| `BLOCK(stmts...)` | Execute sequentially, return last | `{; a; b; c }` |
| `CASE(branches...)` | If/elseif/else branching | `{? cond ? val; default }` |
| `LOOP(init, cond, body, update)` | Loop | `{@ init; cond; body; update }` |
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
| `LEN(coll)` | Length of collection/string | — |
| `FIRST(coll)` | First element | — |
| `LAST(coll)` | Last element | — |
| `GETEL(coll, i)` | Get element at 1-based index | — |
| `IRANGE(start, end)` | Integer range `[start, end]` | — |

### Functional / Pipes

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `PIPE(val, fn)` | Pipe value into function | `val \|> fn` |
| `PIPE_EXPLICIT(val, fn)` | Pipe value into function explicitly | `val ||> fn` |
| `PSLICE_STRICT(coll, i:j)` | Strict slice collection | `coll |>/ i:j` |
| `PSLICE_CLAMP(coll, i:j)` | Clamped slice collection | `coll |>// i:j` |
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

*Note: Combo assignments (`+=`, `-=`, `*=`, `/=`, `//=`, `%=`, `^=`, `**=`) automatically desugar into `ASSIGN(x, OP(RETRIEVE(x), y))` or their `OUTER` equivalents if prefixed with `@`.*
