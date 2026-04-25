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
| `==` | `EQ` | `x == 5` (value equality) |
| `===` | `SAME_CELL` | `x === y` (identity — same cell) |
| `!=` | `NEQ` | `x != 0` |
| `<` | `LT` | `a < b` |
| `>` | `GT` | `a > b` |
| `<=` | `LTE` | `x <= 10` |
| `>=` | `GTE` | `x >= 0` |
| `&&` | `AND` | `a > 0 && b > 0` |
| `||` | `OR` | `x == 0 || y == 0` |
| `?|` | `HOLE_COALESCE` | `a[2] ?| 9` — returns left if not a hole, else right |
| `!` | `NOT` | `!(x == 0)` |
| `x ? :name` | `SEMANTIC_HAS` | Checks `.__type`, `._type`, and `.__traits` |
| `x ~: :type` | `SEMANTIC_CONVERT_SOFT` | Convert or return `_` |
| `x ~!: :type` | `SEMANTIC_CONVERT_STRICT` | Convert or throw |
| `=` | `ASSIGN` | `y = x` (alias/rebind) |
| `:=` | `ASSIGN_COPY` | `x := 5` (fresh copy) |
| `~=` | `ASSIGN_UPDATE` | `x ~= 9` (in-place) |
| `::=` | `ASSIGN_DEEP_COPY` | `y ::= x` (deep copy) |
| `~~=` | `ASSIGN_DEEP_UPDATE` | `x ~~= val` (deep in-place) |
| `[a, b] = rhs` | `DESTRUCTURE_ASSIGN` | Destructure with outer `=` as the default per-entry binding mode |
| `{= a, b[:x] } := rhs` | `DESTRUCTURE_ASSIGN` | Map destructuring with outer `:=` as the default per-entry binding mode |
| `-` (unary) | `NEG` | `-x` |

### Implicit Multiplication & Callable Application

When two expressions appear adjacent with no binary operator between them, RiX interprets the adjacency as either **implicit multiplication** or **implicit callable application**.

#### Implicit Multiplication

Adjacent expressions that are not callable produce multiplication:

| Syntax | Equivalent | Notes |
|--------|-----------|-------|
| `3a` | `3 * a` | Number × identifier |
| `3 a` | `3 * a` | Space does not change semantics |
| `a b` | `a * b` | Two lowercase variables |
| `3(7+x)` | `3 * (7+x)` | Number × parenthesized expression |
| `(x+1)(x+2)` | `(x+1) * (x+2)` | Two groupings |
| `3x^2` | `3 * (x^2)` | Exponentiation binds tighter |

`ab` is a single identifier, not `a * b`. Only separate tokens produce implicit multiplication.

#### Implicit Callable Application

An uppercase-leading callable identifier (like `F`, `G`) followed by an adjacent expression consumes the **maximal multiplicative chunk** as its argument:

| Syntax | Equivalent | Notes |
|--------|-----------|-------|
| `F 3` | `F(3)` | Simple application |
| `F x` | `F(x)` | Identifier argument |
| `F 3x` | `F(3*x)` | Chunk includes implicit mul |
| `F 3x^2` | `F(3*(x^2))` | Chunk includes exponentiation |
| `F 3*x + 7` | `F(3*x) + 7` | Chunk stops at `+` |
| `F 3/x + 7` | `F(3/x) + 7` | Chunk includes `/` |
| `F (3x + 7)` | `F(3*x + 7)` | Parens extend argument past chunk |

**Nested application** chains right-to-left through callables:

| Syntax | Equivalent | Notes |
|--------|-----------|-------|
| `F G 7` | `F(G(7))` | Nested callable consumption |
| `3 F G 7` | `3 * F(G(7))` | Number prefix is multiplication |
| `3 F G 7 H 9` | `3 * F(G(7 * H(9)))` | Full chain |

#### Precedence

From loosest to tightest:
1. Addition/subtraction (`+`, `-`)
2. Explicit multiplication (`*`, `/`, `//`, `%`)
3. Implicit multiplication (adjacency of non-callable expressions)
4. Implicit application (adjacency where left is callable)
5. Exponentiation (`^`)

#### Key rules

- `3 F` does **not** implicitly call `F` — it is `3 * F`, which errors if `F` is a bare function value.
- `F` alone is just variable retrieval, not a call.
- `F + 1` does not auto-call `F`.
- Explicit call syntax `F(args)` is always available and unchanged.
- Uppercase identifiers are callable; lowercase identifiers are not.
- `3 < 7` remains an ordinary comparison — comparison operators are not affected.

### Assignment & Definition

Variables name **cells** — mutable containers holding a value and meta properties. Different assignment operators produce different cell semantics.

| Syntax | System Function | Semantics |
|--------|----------------|-----------|
| `x = expr` | `ASSIGN` | Alias/rebind — if rhs is a variable, share its cell; otherwise create a fresh cell |
| `x := expr` | `ASSIGN_COPY` | Fresh copy — shallow-copy value + all meta into a new cell |
| `x ~= expr` | `ASSIGN_UPDATE` | In-place value replacement — preserve cell identity and ordinary meta |
| `x ::= expr` | `ASSIGN_DEEP_COPY` | Deep copy — like `:=` but recursively copies nested collections |
| `x ~~= expr` | `ASSIGN_DEEP_UPDATE` | Deep in-place — like `~=` but deep-copies the rhs value |
| `x += expr` | `ASSIGN_UPDATE` | Combo ops desugar to `x ~= x op expr` (cell-preserving) |
| `x ++= expr` | `ASSIGN_UPDATE` | Concatenation assignment — delegates to `x ++ expr` then updates in place |
| `x \/= expr` | `ASSIGN_UPDATE` | Union assignment — delegates to `x \/ expr` then updates in place |
| `x /\= expr` | `ASSIGN_UPDATE` | Intersection assignment — delegates to `x /\ expr` then updates in place |
| `x \= expr` | `ASSIGN_UPDATE` | Difference assignment — delegates to `x \ expr` then updates in place |
| `x **= expr` | `ASSIGN_UPDATE` | `**`-assignment — delegates to the existing `x ** expr` semantics, then updates in place |
| `x /^= expr` | `ASSIGN_UPDATE` | Ceiling-division assignment — delegates to `x /^ expr` then updates in place |
| `x /~= expr` | `ASSIGN_UPDATE` | Rounded-division assignment — delegates to `x /~ expr` then updates in place |
| `F(x) -> body` | `FUNCDEF` | `Sq(x) -> x ^ 2` |
| `(x) -> body` | `LAMBDA` | `(x) -> x + 1` |
| `F(x) ?- [prep] -> body` | `FUNCDEF` | Soft prep phase before body |
| `(x) ?!- [prep] -> body` | `LAMBDA` | Strict prep phase before body |
| `F(x) => body` | `MULTIFUNCDEF` | Append variant to multifunction |
| `F(x) ^=> body` | `MULTIFUNCDEF` | Prepend variant to multifunction |
| `(x) /Name/ -> body` | `LAMBDA` | Name a variant with `variant.__name` |

**Key distinctions:**
- `=` shares a cell (aliases track mutations); `:=` creates an independent copy.
- `~=` replaces the value inside an existing cell, so aliases see the change. `=` rebinds to a different cell.
- Combo operators (`+=`, `-=`, `*=`, `/=`, `//=`, `%=`, `^=`, `++=`, `\/=`, `/\=`, `\=`, `**=`, `/^=`, `/~=`) use `~=` semantics — they preserve cell identity.

#### Function Prep Phase

Prep runs after parameter binding and before the function body:

```rix
(x, y) ?- [
  xr = x ~: :rational,
  yr = y ~: :rational,
  sum = xr + yr,
  sum > 0
] -> sum
```

Rules:

- Prep entries execute left-to-right.
- Prep shares the function's local scope.
- Prep-created bindings are visible to later prep entries and to the body.
- In `?-`, a prep entry that returns `_` or throws makes the call return `_`.
- In `?!-`, the same failures throw.

Prep is meant for validation, conversion, destructuring, and local setup. RiX does not currently restrict mutation or IO in prep.

#### Multifunctions

Multifunctions are callable arrays marked with `._type = :multifunction`. RiX automatically applies that mark when an uppercase identifier is assigned an array.

```rix
F = [
  (x) ?- [x > 0] /Positive/ -> x,
  (x) /Fallback/ -> -x
]
```

Dispatch model:

- variants are considered in array order
- prep success selects the variant
- prep failure (`_` or soft prep error) moves to the next variant
- body errors propagate
- body return values are final, including `_`
- if nothing matches, the result is `_`

`?!-` keeps its strict meaning inside multifunctions: a thrown prep error propagates, while a prep result of `_` still counts as "try the next variant".

Append and prepend forms mutate the multifunction definition:

```rix
F(x) => x + 1
F(x) ^=> x * 10
F(x) /Exact/ => x
```

If `F` is undefined, RiX creates a new multifunction. If `F` is a single function, RiX converts it into a multifunction before appending.

Named variants use `/Name/` and can be dispatched directly:

```rix
F[:Exact](7)
$$[:Exact](7)
```

Inside a variant body:

- `$` resolves the current variant
- `$$` resolves the parent multifunction

If execution reaches a variant with no prep and later variants still exist, RiX can emit a configurable warning because the later variants are unreachable from that point.

### Left-Hand Destructuring

RiX supports left-hand destructuring for arrays, tuples, maps, and tensors. Destructuring:

1. evaluates the rhs once
2. extracts the actual stored entries from that source structure
3. binds outward using ordinary RiX assignment semantics

The outer operator sets the default binding mode for all bound targets unless an entry overrides it:

```rix
[a, b] = rhs
[a, b] := rhs
{= a, ~=b[:x] } ~= rhs
```

Patterns:

```rix
[a, b, ...rest]
{: a, b, ...rest }
(a, b, ...rest)
{= a, b[:x], pair[:pt] = [u, v], [:meta] = {: p, q}, ...rest }
{:2x2: [a, b], [c, d]}
```

Failure rules:

- missing simple array/tuple positions bind a hole
- missing simple map keys bind a hole
- missing nested required structure is an error
- extra source contents are ignored unless captured by final `...rest`

Map forms:

- `a` means key `a`, target `a`
- `b[:a]` means key `a`, target `b`
- `a = pattern` means bind whole selected value to `a`, then destructure it
- `[:a] = pattern` means destructure key `a` without binding the whole selected value
- `b[:a] = pattern` means bind the whole selected value to `b`, then destructure it

Per-entry overrides reuse assignment semantics directly:

```rix
[==a, :=b, ~=c, ~~=d]
{: ==a, b, :=c }
{= ==a, b[:x], ~=c[:y] }
```

Target-side semantic wrapping uses `{^ /.../ target}` inside patterns:

```rix
[{^ /::rational/ x}] = [2]
{= p[:pt] = {^ /:= #point ::Point :cartesian/ q} } = m
```

In destructuring headers, `:trait` is a required source-side check. The extracted source value must already satisfy that trait or evaluation fails.

Indexed destructuring extends the same system:

```rix
{.. a[1:3], b[2:4], c[3] } = [10, 20, 30, 40, 50]
{.. picked[-1:1] = [x, y, ...z] } = arr
{.. [2:4] = [u, v, ...w] } = arr
{.. row2[2, 1:3], block[1:2, 1:2] } = tensor
```

Rules:

- indexing applies to the source object being destructured, not to the target
- each indexed entry extracts independently from the same source object
- overlapping and repeated extraction is allowed
- per-entry binding overrides still apply after extraction
- nested `= pattern` forms destructure the extracted subobject, not the original source

Supported entry forms:

- `target[indexSpec]`
- `target[indexSpec] = pattern`
- `[indexSpec] = pattern`

Examples:

```rix
{.. ==a[1:3], ~=b[2:4], :=c[3] } = arr
{= x[:a], y[:b] } = {= a = 1, b = 2 }
{.. row2[2, 1:3], col2[::, 2] } = tensor
```

Tuple bracket slices now produce tuples; sequence bracket slices produce sequences.

For sequence-like values, bracket slices use interval semantics: they are closed (inclusive on both ends), strict, and directed.

```rix
a[2:4]      ## includes indices 2, 3, 4
a[4:2]      ## traverses backward
a[-2:-1]    ## counts from the end
```

This is intentionally different from receiver-first `.Slice(start?, end?)`, whose end bound remains exclusive.

### Headered Outfitting And Constructor Capture

RiX now uses a shared `/ ... /` header zone for value outfitting and constructor defaults:

```rix
{^ 7}
{^ /#len ::Length :meters/ 7}
{= /:= #pt ::Point :cartesian/ x = 3, y = 4}
```

### Semantic Inquiry And Conversion

RiX also has lightweight expression forms for semantic inquiry and explicit conversion:

```rix
x ? :rational
x ~: :rational
x ~!: :rational
```

Rules:

- `x ? :name` succeeds if any of these are true: `x.__type == :name`, `x._type == :name`, or `:name` is contained in `x.__traits`
- successful inquiry returns a non-null truthy value; failure returns `_`
- no trait inheritance or group expansion is applied here
- `x ~: :type` reuses the same semantic type conversion/canonicalization path as `{^ /::type/ x}`
- `x ~: :type` returns the converted value on success, otherwise `_`
- `x ~!: :type` returns the converted value on success and throws on failure
- conversion targets are semantic types, not traits
- these operators return new outfitted values; they do not mutate the original binding unless assigned back

Soft conversion warnings are controlled by runtime config:

```js
warnings: {
  conversion: true
}
```

When `warnings.conversion === true`, failed `~:` emits a structured warning before returning `_`.

RiX now backs these forms with immutable type and trait registries. Types are protocol bundles: they can define conversion, normalization, validation, default traits, proto methods, export/import hooks, and operator variants. Traits can imply other traits and contribute proto methods. Implied traits are materialized into `.__traits`, so `x ? :trait` remains a direct membership check.

See `types-and-traits-guide.md` for the full registry, conversion, export/import, and system multifunction installation model.

```rix
{.. /::=/ a, ==b, ~=c}
{: /#pair/ a, b}
{:2x2: /#M ::Matrix :square/ 1, 2; 3, 4}
```

The header vocabulary is:

- capture mode: `==`, `:=`, `~=`, `::=`, `~~=`
- sticky name: `#name`
- sticky semantic type: `::TypeName`
- sticky traits: `:trait`

Container construction follows the same cell/copy model as assignment. Every inserted entry uses one effective capture mode, chosen in this order:

1. Per-entry override
2. Constructor default
3. Runtime default (`defaultConstructorCaptureMode`, currently `deep_copy`)

The five constructor capture modes are assignment-analogues:

| Constructor mode | Meaning in constructors |
|------------------|-------------------------|
| `==` | Alias capture — keep the source value live like `=` on an existing cell source |
| `:=` | Fresh shallow copy |
| `~=` | Fresh "refreshing" shallow copy — same meta transfer rules as `x ~= rhs` when `x` is undefined |
| `::=` | Fresh deep copy |
| `~~=` | Fresh "refreshing" deep copy — same meta transfer rules as `x ~~= rhs` when `x` is undefined |

Maps can override capture per entry:

```rix
{::= a = x, b == y, c ~= z}
```

For non-map advanced brace constructors, an entry-level override uses prefix form:

```rix
{.. 1, == x, := y}
```

Advanced brace constructors set a constructor-wide default in the shared header:

```rix
{.. 1, 2, 3}
{.. /:=/ x, y}
{: /::=/ a, b, c}
{| /==/ item1, item2 |}
{:2x2: /::=/ a, b; c, d}
```

`[...]`, `{= ...}`, `{: ...}`, `{| ...}`, and tensor literals without an explicit constructor header still participate in this model; they simply fall back to the runtime default capture mode.

Value outfitting uses the same header but applies to the resulting value itself after capture:

1. evaluate the source expression
2. apply capture mode (header or runtime default)
3. assign sticky `.__name` if present
4. apply semantic type processing / canonicalization
5. apply traits in textual order
6. build semantic `.__proto`
7. rebuild ephemeral `._type` and `._proto`

Sticky semantic metadata lives in `.__name`, `.__type`, `.__traits`, and `.__proto`. Ephemeral runtime metadata lives in `._type` and `._proto`.

Semantic `.__proto` is layered:

1. `.__proto[:traits]`
2. `.__proto[:type]`
3. `._proto`

Method lookup therefore checks direct meta first, then semantic trait methods, then semantic type methods, then builtin/runtime methods. `x._proto` still exposes the builtin layer directly.

On `~=` / `~~=` updates, sticky semantic metadata is preserved unless explicitly replaced. If a value has a sticky semantic type, the new raw rhs is processed through that type again before installation. Traits are sticky augmentations in this version; they do not transform values. Automatic trait validation only runs when enabled globally or when the sticky `:verify` trait is present.

Examples:
```rix
xs := [1, 2]
ys = xs
xs ++= [3]
## ys is now [1, 2, 3]

s := {| 1, 2 |}
s \/= {| 2, 3 |}
## s is now {| 1, 2, 3 |}

t := {| 1, 2, 3 |}
t /\= {| 2, 3, 4 |}
## t is now {| 2, 3 |}

u := {| 1, 2, 3 |}
u \= {| 2 |}
## u is now {| 1, 3 |}
```

### Brace Containers

| Syntax | System Function | Description |
|--------|----------------|-------------|
| `{ a; b; c }` | `BLOCK` | Sequential execution, returns last value. Optional top-of-block import header: `{ <...> ... }` |
| `{; a; b; c }` | `BLOCK` | Sequential execution (explicit block). Optional top-of-block import header: `{; <...> ... }` |
| `{? c1 ? v1; c2 ? v2; default }` | `CASE` | Conditional branching (if/elseif/else) |
| `{@ init; cond; body; update }` | `LOOP` | Loop with init, condition, body, update. Loop headers also support `{@name@ ... }`, `{@:100@ ... }`, `{@name:100@ ... }`, `{@::@ ... }`, and `{@name::@ ... }`. Optional top-of-block import header: `{@ <...> ... }` |
| `{! expr }` | `BREAK` | Break the nearest matching block/case/loop and use `expr` as that target's final value |
| `{#x,y:z# p = x + y }` | `SYSTEM_SPEC` | Symbolic system spec literal. Optional top-of-block import header: `{#x,y:z# <...> ... }` |
| `{= k1=v1, (expr)=v2 }` | `MAP` | Map/object literal (`k1` identifier sugar or parenthesized key expression) |
| `{.. a, b, c }` | `ARRAY_CAPTURE` | Brace-form array literal with constructor capture controls |
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

### System Context (`.` Dot Syntax)

The leading `.` refers to the **system capability object** — a frozen, sandboxable map of all built-in functions. System functions may only be called through this object.

| Syntax | IR Node | Description | Example |
|--------|---------|-------------|---------|
| `.` | `SYS_OBJ` | The system context as a RiX value (copy) | `sys := .` |
| `.Name` | `SYS_GET` | Get a system capability reference | `fn := .ADD` |
| `.Name(args)` | `SYS_CALL` | Call a system capability | `.ADD(3, 4)` → `7` |
| `.Eval(ast_or_str, b?, m?)`| `SYS_CALL` | Evaluates a deferred AST or code string at runtime with optional bindings map and mode (`:inherit` or `:fresh`) | `.Eval("1 + 2")` |
| `.FREEZE = 1` | `SYS_SET` | Freeze the system context | `.FREEZE = 1` |
| `@_Name(args)` | `SYS_CALL` | Alternative call syntax (identical to `.Name(args)`) | `@_ADD(3, 4)` → `7` |

System context meta-methods (called via dot syntax):
- `.Withhold("NAME")` — return a copy with a capability removed (for sandboxing loaded scripts)
- `.With("NAME", fn)` — return a copy with an added or replaced capability

### Deferred Syntax & Operator Aliases

| Syntax | Description | Example |
|--------|-------------|---------|
| `@{; ... }` | Deferred block (returns AST tree, does not evaluate) | `f = @{; x + 1 }` |
| `@{= ... }` | Deferred map | `lazyMap = @{= a=1 }` |
| `@{#x:p# p = x + 1 }` | Deferred symbolic system spec | `lazySpec = @{#x:p# p = x + 1 }` |
| `@@expr` | Evaluate a deferred AST node or code string at runtime directly in the caller's scope (sugar for `.Eval(expr)`) | `f = @{; x = 2 }; @@f` → sets `x=2` locally |
| `@+, @*, @<`, etc | Retrieve operator's system capability (alias for `.ADD`, `.MUL`, etc.) | `f = @+; f(10, 20)` → `30` |

#### Built-in methods on deferred values

Deferred values (`@{...}`) have built-in methods for evaluation, introspection, and debugging:

| Method | Description |
|--------|-------------|
| `d.Eval()` | Evaluate the deferred block in the current (caller's) scope. Identical to `.Eval(d)`. |
| `d.Eval(bindings)` | Evaluate with extra variable bindings injected into the scope. |
| `d.Eval(bindings, :fresh)` | Evaluate in a fresh isolated scope (no access to outer variables). |
| `d.Desugar()` | Return a string showing the full raw IR tree. `BLOCK` nodes and complex children are rendered with each argument on its own indented line. |
| `d.Desugar(n)` | Return the IR tree up to depth `n`; nodes beyond that depth render as `FN(...)`. `n = -1` (default) is unlimited. `n = 0` gives just `DEFER(...)`. |
| `d.Inspect()` | Run in a fresh isolated scope and return a report: inputs, a full execution trace, and the final output. |
| `d.Inspect(bindings)` | Same but inject `bindings` as the input variables. |
| `d.Inspect(bindings, depth)` | Control trace depth: `depth = -1` (default) traces everything; `depth = 0` disables the trace (inputs + output only); `depth = n` traces `n` levels into the call tree. |

**Notes:**
- `d.Eval()` inherits the surrounding scope and can read/write outer variables (same as `@@d`).
- `d.Eval(_, :fresh)` creates an isolated scope — outer variables are inaccessible and assignments do not escape.
- `d.Inspect()` always runs in a fresh isolated scope regardless of bindings; outer variables are never visible.
- `d.Desugar()` shows the underlying IR (e.g. `ADD`, `RETRIEVE`, `LITERAL`, `BLOCK`) — useful for understanding how expressions are lowered.
- The trace in `d.Inspect()` evaluates `BLOCK` statements once each (no double-evaluation). For other node types, tracing sub-expressions involves a second evaluation of those sub-expressions, which is safe for pure arithmetic and variable reads but may produce duplicate entries for side-effectful operations (mutations, `.Warn`, etc.). Use `depth = 0` to suppress the trace for such code.

Operator alias mapping:

| Operator Alias | System Capability |
|----------------|------------------|
| `@+` | `.ADD` |
| `@-` | `.SUB` |
| `@*` | `.MUL` |
| `@/` | `.DIV` |
| `@//` | `.INTDIV` |
| `@%` | `.MOD` |
| `@^` | `.POW` |
| `@==` | `.EQ` |
| `@!=` | `.NEQ` |
| `@<` | `.LT` |
| `@>` | `.GT` |
| `@<=` | `.LTE` |
| `@>=` | `.GTE` |
| `@&&` | `.AND` |
| `@\|\|` | `.OR` |
| `@!` | `.NOT` |

### Loop Headers And Break Blocks

Loop max syntax:

- `{@ ... }` or `{@name@ ... }` uses the runtime default loop max.
- `{@:100@ ... }` or `{@name:100@ ... }` sets an explicit finite max.
- `{@::@ ... }` or `{@name::@ ... }` disables max checking.

The current runtime default is `defaultLoopMax = 10000` unless the host changes it. The max check happens after the loop condition succeeds and before the next body execution, so a max of `100` permits exactly 100 iterations.

If a finite cap is exceeded, evaluation throws:

```text
Loop exceeded max iteration count: 100
```

Break block targeting:

- `{! expr }` — nearest enclosing breakable construct of any supported kind
- `{!; expr }` — nearest enclosing block (`{ ... }` or `{; ... }`)
- `{!@ expr }` — nearest enclosing loop
- `{!? expr }` — nearest enclosing case block
- `{!name! expr }` — nearest enclosing breakable construct named `name`
- `{!;name! expr }`, `{!@name! expr }`, `{!?name! expr }` — typed named targeting

Breakable constructs are plain blocks, explicit blocks, case blocks, and loops. The break value becomes the target construct's final result, and any remaining code inside that target is skipped.

Examples:

```rix
{;
    a := 1
    {! 5}
    99
}
## => 5

{@:100@
    i := 0;
    i < 10;
    {? i < 3 ? _; {!@ i} };
    i += 1
}
## => 3

{;outer;
    {;inner;
        {!outer! 5}
    };
    9
}
## => 5
```

Scoping inside a break block is intentionally asymmetric:

- Plain reads can see the immediate surrounding scope without `@`.
- Writes stay local unless you use `@name` to write to that surrounding scope explicitly.

### Code Blocks in Construct Positions (Scope Sharing)

When a scope-creating construct (loop, `.Test`, etc.) evaluates a sub-part that is itself a code block, that block **shares the construct's scope** rather than creating an additional isolated scope. This means code blocks in these positions act as grouping (for multi-statement parts) without introducing a scope boundary.

```rix
## These are equivalent — the init block shares the loop's scope:
{@ x = 1; x < 4; x; x += 1 }          ## => 3
{@ {; x = 1 }; x < 4; x; x += 1 }     ## => 3

## All four loop parts can be code blocks:
{@ {; i = 0; j = 10 }; {; i < 3 }; {; i + j }; {; i += 1 } }  ## => 12
```

To get a genuinely isolated block inside a construct position, use nested braces. The outer block shares the construct's scope, but the inner block creates its own:

```rix
{@ { { x = 1 } }; x < 4; x; x += 1 }   ## Error: x is undefined in loop scope
```

This scope-sharing applies to any lazy construct that manages its own scope and evaluates sub-parts within it. Currently this includes loop sub-parts (init, condition, body, update) and `.Test` setup/test expressions.

### Scoped Block Import Headers

Scoped execution blocks may begin with one optional import header immediately after the opening brace form:

```rix
{;
    < a~x, b=y, z=, r >
    ...body...
}
```

Supported only for scoped execution blocks:
- `{ ... }`
- `{; ... }`
- `{@ ... }`
- `{# ... }`

Not supported for:
- `{? ... }`
- `{= ... }`
- `{| ... }`
- `{: ... }`

Grammar:

```text
importHeader := "<" importSpec ("," importSpec)* ">"
importSpec :=
    IDENT
  | IDENT "~"
  | IDENT "~" IDENT
  | IDENT "="
  | IDENT "=" IDENT
```

Semantics:
- `name` means `name~name`: create a new local `name` with a copy of outer `name`
- `name~` also means `name~name`
- `local~outer` creates a new local `local` initialized from the current outer value of `outer`
- `name=` means `name=name`: local `name` aliases the outer binding `name`
- `local=outer` creates a local alias `local` to the same outer binding as `outer`

Resolution rules:
- The left side is always the local name introduced in the block.
- The right side is always resolved against the enclosing scope chain.
- Sources do not resolve progressively within the same header.
- Example: `< a~x, b~a >` makes `b` read the enclosing `a`, not the newly introduced local `a`.

Assignment behavior:
- Copy imports remain ordinary locals after initialization.
- Alias imports write through to the referenced outer binding.
- `@name` still explicitly reads or writes the outer scope chain and is not changed by imports.

For `{# ... }`, imports affect symbolic name interpretation only. The spec literal stays symbolic: it does not copy concrete values during creation, and consumers such as `Poly` decide how to interpret those references later.

Errors:
- Empty headers are invalid: `<>`
- Duplicate local targets in one header are invalid: `< x, x= >`
- Missing outer sources are errors
- Malformed specs such as `< a~~x >`, `< a==x >`, or `< a~x, >` are errors
- A header only has meaning in the top-of-block position for supported scoped blocks

### Script Import Expressions

Script execution uses the angle-call form:

```text
< "path" /capMods/ inputs ; outputs >
```

Examples:

```rix
<"math/square">
<"math/square" x>
<"worker" state=data>
<"net/fetch" /-All,+Core,+Net/ >
<"poly" x ; p=result, d=deriv>
```

The path is resolved relative to the current script directory, or the current execution base directory for a top-level run. If the path has no suffix, `.rix` is appended.

Behavior:
- Every call creates a fresh execution state. There is no module singleton caching.
- If the script has an explicit export declaration, the expression returns an export bundle.
- Otherwise the expression returns the final expression value of the script body.
- Caller-side `; outputs` are only valid when the imported script declared explicit exports.
- Output bindings happen before any surrounding assignment or enclosing expression consumes the returned value.
- Active cycles are rejected. `a.rix -> b.rix -> a.rix` is an error.

#### Script Input Bindings

Inputs and outputs use the same binding family:

```text
bindingSpec :=
    IDENT
  | IDENT "=" [source]
  | IDENT "~" [source]
  | IDENT ":" [source]
  | IDENT "~~" [source]
  | IDENT "::" [source]
```

Modes:
- `name` or `name~source` means shallow copy without meta.
- `name:source` means shallow copy with meta.
- `name~~source` means deep copy without meta.
- `name::source` means deep copy with meta.
- `name=source` means alias/live cell sharing.

Caller-side source lookup rules:
- Bare `source` reads only from the immediate scope where the import expression appears.
- `@source` reads only from ancestor scopes, skipping that immediate scope.
- This is different from ordinary RiX name lookup, which normally searches outward automatically.

#### Capability Modifiers

Capability modifiers live between slashes and are applied left-to-right:

```rix
<"child" /-All,+Core,+@MAP/ >
```

Rules:
- `All` is a pseudo-group meaning every capability currently available to the caller.
- Plain names such as `Core` or `Arith` are group names.
- `@Name` names a single capability directly.
- Nested scripts cannot gain capabilities their parent script does not currently have.

Default policy:
- Imported scripts start from the configured default script capability base.
- `Imports` is enabled by default.
- `Net` and `Files` are not granted unless explicitly enabled and already available to the parent.

#### Script-Side Contracts and Exports

The first statement of an imported script may be an input contract:

```rix
< x, state=, cache:: >
```

This declares the local names the script expects. At runtime:
- Missing declared inputs are errors.
- Alias declarations (`name=`) require alias passing.
- Copy-style declarations reject alias passing.

The last statement of an imported script may be an export declaration:

```rix
< result=r, deriv=d, state=cache, raw >
```

Semantics:
- Left side is the exported/public name.
- Right side is the script-local source name.
- The operator controls whether the exported bundle entry is live or copied.
- Live exported cells may outlive the script frame and keep working after the script returns.

Example:

```rix
< x >
r := x * x
< result=r >
```

Caller:

```rix
y = <"square" x ; z=result>
```

### Set & Interval Algebra

| Syntax | System Function | Example | Description |
|--------|----------------|---------|-------------|
| `A \/ B` | `UNION` | `S1 \/ S2` | Set union or interval hull |
| `A /\ B` | `INTERSECT` | `S1 /\ S2` | Set intersection or interval overlap |
| `A \ B` | `SET_DIFF` | `S1 \ S2` | Set/Map difference |
| `A <> B` | `SET_SYMDIFF` | `S1 <> S2` | Symmetric difference |
| `x ? S` | `MEMBER` | `5 ? 1:10`, `"a" ? m` | Membership test (sets/intervals) or map key existence test |
| `x !? S` | `NOT_MEMBER` | `x !? S` | Non-membership / key absence test |
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

Collection-traversing pipes support arrays, tuples (become arrays), strings, maps (for the traversal/fold operators only — see below), and tensors. All pipe operators return **new** collections; they never mutate the original.

| Syntax | System Function | Description |
|--------|----------------|-------------|
| `x \|> F` | `PIPE` | Pipe `x` as first arg to `F` (or concrete call if `F` is partial) |
| `x \|\|> F(_1)` | `PIPE_EXPLICIT` | Alias for `PIPE`; used with placeholders for clarity |
| `coll \|>/ i:j` | `PSLICE_STRICT` | Strict slice a collection based on interval; `null` if bounds are non-integers or invalid |
| `coll \|>// i:j` | `PSLICE_CLAMP` | Clamped slice a collection based on interval; clamps exactly without failing |
| `coll \|>\| sep` | `PSPLIT` | Split string or collection by delimiter string, regex or predicate (sequences/strings only) |
| `coll \|>#\| nOrFn`| `PCHUNK` | Chunk string or collection by integer size or predicate boundary (sequences/strings only) |
| `coll \|>> fn` | `PMAP` | Map `fn` over collection; for maps: preserves keys, transforms values |
| `coll \|>? pred` | `PFILTER` | Filter collection by predicate |
| `coll \|>: fn` | `PREDUCE` | Reduce (first element/value as init) |
| `coll \|:> init >: fn` | `PREDUCE` | Reduce with explicit initial value |
| `coll \|><` | `PREVERSE` | Reverse collection (new copy; sequences/strings only) |
| `coll \|<> fn` | `PSORT` | Sort with comparator (new copy; sequences/strings only) |
| `coll \|>&& pred` | `PALL` | Every: last item/value if all pass, `null` on first failure or empty (short-circuits) |
| `coll \|>\|\| pred` | `PANY` | Any/Some: first passing item/value, `null` if none pass or empty (short-circuits) |

#### Callback contract for collection-traversing pipes

For traversal pipes (`|>>`, `|>?`, `|>&&`, `|>||`, predicate forms of `|>/|` and `|>#|`), the callback receives:

```
(val, locator, src)
```

For reduce (`|>:` and `|:> init >: fn`), the callback receives:

```
(acc, val, locator, src)
```

For sort (`|<>`), the comparator receives only:

```
(a, b)
```

The **locator** is the native indexing/key form for the source collection kind:
- **sequences and strings**: 1-based integer position
- **maps**: the map key (as a canonical string, consistent with `KEYOF` and `INDEX_GET`)
- **tensors**: 1-based index tuple

Callbacks that declare fewer parameters simply ignore the extra arguments — existing one-arg and two-arg callbacks continue to work without modification.

#### Map-specific behavior

Maps support the traversal/fold pipe operators `|>>`, `|>?`, `|>&&`, `|>||`, `|>:`, and `|:> init >: fn`. Maps are **unordered** — no iteration-order guarantee is made.

For map traversal, callbacks receive `(value, key, sourceMap)`. The key is the canonical map key string.

- **`map |>>`** — transforms values only, preserves original keys. For reshaping map structure, use reduce.
- **`map |>?`** — keeps entries whose predicate passes; returns a new map.
- **`map |>&&`** — returns last value if all pass; `null` on first failure or empty.
- **`map |>||`** — returns first passing value; `null` if none pass or empty.
- **`map |>:`** — implicit-init: first traversed value as accumulator; order is unspecified.
- **`map |:> init >: fn`** — explicit init; order is unspecified.

#### Tensor-specific behavior

- **Tensor literal**: `{:d1xd2x...: elems }` creates a dense tensor in row-major order. `{:d1xd2x...:}` creates an empty mutable tensor filled with holes.
- **Tensor indexing**: `A[i, j]`, `A[::, 2]`, `A[-1:1, ::]`. Indices are 1-based; negative indices count from the end; `0` is invalid.
- **Tensor slices**: bracket slices are strict, closed, and directed. `::` is sugar for the full forward slice.
- **Transpose**: `A^^` swaps the two axes of a rank-2 tensor as a view.
- **`tensor |>>`** — callback receives `(value, indexTuple, tensor)` and returns a new tensor with the same shape.
- **`tensor |>?`** — callback receives `(value, indexTuple, tensor)` and returns a sequence of `{: value, indexTuple }` pairs for matches.
- **`tensor |>:` / `tensor |:> init >: fn`** — reducer receives `(acc, value, indexTuple, tensor)`.

Maps do **not** support `|>/|` (split), `|>#|` (chunk), or `|<>` (sort) — these require ordered sequences.

Examples:

```rix
m = {= a=2, b=3 }
m |>> (v, k) -> v * 10        ## {= a=20, b=30 }
m |>? (v, k) -> v > 1         ## {= a=2, b=3 }
m |>? (v, k) -> k == "a"      ## {= a=2 }
m |:> 0 >: (acc, v) -> acc+v  ## 5

[10,20,30] |>> (v, k) -> k    ## [1, 2, 3]  (1-based locators)
[10,20,30] |:> 0 >: (acc, v, k) -> acc+k   ## 6  (sum of locators 1+2+3)
```

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

### Arity-Capped Callable Views

`fn[n]` produces a **callable wrapper** that forwards only the first `n` arguments to `fn`, silently discarding any extras.

```
fn[n]
```

**This is not partial application.** It does not bind, reorder, or select arguments — it simply truncates the incoming argument list to the first `n`.

| Syntax | Semantics |
|--------|-----------|
| `fn[0]` | Call `fn()` regardless of how many args are provided |
| `fn[1]` | Call `fn(a1)` — discard everything after first arg |
| `fn[2]` | Call `fn(a1, a2)` — discard everything after second arg |
| `fn[n][m]` | Equivalent to `fn[min(n,m)]` — caps compose |

**Primary use case**: Collection-pipe callbacks receive enriched argument lists `(val, locator, src)` or `(acc, val, locator, src)`. Bare system functions like `@+` are N-ary and would fail if they receive non-numeric locator/src values. Arity capping avoids this cleanly:

```rix
## Without cap, @+ in reduce receives (acc, val, locator, src) and fails on the sequence object
[1, 2, 3] |>: @+[2]           ## 6  — only acc and val forwarded
[1, 2, 3] |:> 0 >: @+[2]      ## 6

## Map and filter
double := (x) -> x * 2
[1, 2, 3] |>> double[1]        ## [2, 4, 6]   — locator dropped

isEven := (x) -> x % 2 == 0
[1, 2, 3, 4] |>? isEven[1]    ## [2, 4]

## Map values in a map
{= a=2, b=3 } |>> double[1]   ## {= a=4, b=6 }

## General call context
G := @+[2]
G(10, 20, 99, 99)              ## 30  (only 10 and 20 forwarded)
```

**Comparison with placeholders**:

| Approach | Example | When to use |
|---|---|---|
| Arity cap | `fn[n]` | Forward first `n` args |
| Placeholder | `@+(_1, _2)` | Explicit selection / reordering |

Arity cap is simpler when you just want to drop trailing context args. Placeholders are more powerful when you need specific positions or reordering.

**Rules**:
- `n` must be a non-negative integer. Non-integer or negative values error.
- If fewer than `n` arguments are available, all are forwarded (no padding or defaults).
- Works on any callable: lambdas, named functions, system references (`@+`, `.LEN`, etc.), partials, or nested arity-capped callables.
- Ordinary collection indexing `collection[i]` is unaffected.

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

### Colon-Strings

A colon in prefix position (where a value is expected) followed by an identifier or number produces a string literal. The colon must not follow a value — after a value, `:` remains the interval operator.

| Syntax | Result | Notes |
|--------|--------|-------|
| `:hello` | `"hello"` | Lowercase identifier |
| `:World` | `"World"` | Case is preserved (not uppercased) |
| `:some_key` | `"some_key"` | Underscores allowed |
| `:123` | `"123"` | Number becomes string |
| `a:b` | interval | `:` in infix position = interval |
| `a :b` | interval | Whitespace doesn't change infix `:` |

Colon-strings work anywhere a value is expected: in arrays (`[:a, :b]`), as function arguments, after `=` or `:=`, after commas, etc. They are syntactic sugar for quoted strings and evaluate identically.

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
| `obj[:name]` | `INDEX_GET` | Map access by key literal (`:name`, `:1`, `:"1"`) |
| `obj[i] = val` | `INDEX_SET` | Set collection index (requires `._mutable` value meta; arrays/maps/tensors default to mutable) |
| `obj.\|` | `KEYS` | Get set of map keys |
| `obj\|.` | `VALUES` | Get set of map values |
| `obj.Method(args)` | `CALL_METHOD` | Receiver-first method call |
| `obj.Method!(args)` | `CALL_METHOD` | Receiver-first mutating method call |

**Note:** `obj..name` is a **parse error** — use `obj.name` for meta access.

**Method-call semantics:**
- Only `obj.Method(...)` and `obj.Method!(...)` trigger method resolution.
- Plain property access like `x = obj.Method` stays a direct `META_GET`; it does not consult `_proto`.
- `CALL_METHOD(target, name, ...args)` resolves methods in this order:
  1. `target.name`
  2. `target.__name`
  3. `target._name`
  4. `target._proto[:name]`
  5. `target._proto[:__name]`
  6. `target._proto[:_name]`
- If a direct meta match is found and is not callable, evaluation errors immediately and does not fall back to `_proto`.
- If no callable is found, evaluation raises `Method not found`.
- The receiver is always passed as the first argument: `fn(target, ...args)`.
- Names ending in `!` are the mutating variants. They require a mutable receiver and raise `Cannot mutate immutable value` when `._mutable` is absent or the value is frozen/immutable.
- `_proto` is a reserved meta property. It must be a map or null. Built-in prototypes are frozen and do not prototype-chain in v1.
- The built-in method surface is documented in [methods-guide.md](./methods-guide.md).

**Map Key Resolution (`.KEYOF`):**
- string -> same key
- integer -> canonical integer string
- otherwise -> use `.key` meta property (must be string/integer)

Expression map keys must be parenthesized in literals:
- `a = {= id=5, (expr)=9 }`
- `{= 1=2 }` is invalid; use `{= (1)=2 }`

Map literals reject duplicate keys after canonicalization:
- `{= a=1, ("a")=2 }` -> error
- `{= (1)=1, ("1")=2 }` -> error

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

> **Note:** Functions in this reference that are marked with a leading `.` (e.g., `.ADD`, `.RAND_NAME`) are **system capabilities** accessible only via the dot syntax or `@_` prefix. Functions without a leading `.` are **internal IR operations** dispatched automatically by operator syntax — they are not directly callable by name.

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
| `EQ(a, b)` | Value equality (returns 1 or null) | `a == b` |
| `SAME_CELL(a, b)` | Identity — same cell (returns 1 or null) | `a === b` |
| `NEQ(a, b)` | Not equal | `a != b` |
| `LT(a, b)` | Less than | `a < b` |
| `GT(a, b)` | Greater than | `a > b` |
| `LTE(a, b)` | Less or equal | `a <= b` |
| `GTE(a, b)` | Greater or equal | `a >= b` |
| `MIN(args...)` | N-ary minimum (numbers or strings; null args ignored) | `{<< a, b, c }` |
| `MAX(args...)` | N-ary maximum (numbers or strings; null args ignored) | `{>> a, b, c }` |

### Logic

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `AND(a, b)` | Logical AND (internal) | `a && b`, `.AND(a,b)`, `@&&` |
| `OR(a, b)` | Logical OR (internal) | `a \|\| b`, `.OR(a,b)`, `@\|\|` |
| `NOT(a)` | Logical NOT (internal) | `!a`, `.NOT(a)`, `@!` |

### Assertions & Constraints

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `SOLVE(name, expr)` | Solve/constrain variable | `:=:` |
| `ASSERT_LT(a, b)` | Assert `a < b` | `:<:` |
| `ASSERT_GT(a, b)` | Assert `a > b` | `:>:` |
| `ASSERT_LTE(a, b)` | Assert `a <= b` | `:<=:` |
| `ASSERT_GTE(a, b)` | Assert `a >= b` | `:>=:` |

### Symbolic Specs

`{# ... }` builds a symbolic specification object instead of executing a runtime block.

Supported header forms:

```rix
{# ... }
{#x,y,z# ... }
{#:p,q# ... }
{#x,y,z:p,q# ... }
```

Meaning:

- names before `:` are declared inputs
- names after `:` are declared outputs
- both sides may be omitted
- header names must be bare identifiers

Current body rules:

- only `name = expr` symbolic assignments are supported
- the left-hand side must be a bare identifier
- `=` inside `{# ... }` is symbolic assignment, not ordinary `ASSIGN`
- if outputs are declared, every assignment target must be one of them and each must appear exactly once
- if outputs are omitted, outputs are inferred from top-level assignment targets in encounter order

Result shape:

```rix
{=
  kind = "systemSpec",
  syntax = "#",
  inputs = {: "x", "y" },
  outputs = {: "p" },
  statements = {:
    {=
      kind = "assign",
      target = "p",
      expr = ...
    }
  }
}
```

The `expr` field stores a structural symbolic tree. It is not evaluated eagerly and it is not stored as a raw source string.

Current minimal consumers:

- `Poly(spec)` returns a callable for a restricted polynomial subset
- `Deriv(spec, "x")` returns another compatible spec for that same subset

Current supported subset for `Poly` and `Deriv`:

- constants
- identifiers
- `+`
- `-`
- `*`
- `^` with a nonnegative integer literal exponent

Constraint forms such as `:=:`, `:<:`, and `:>:` remain separate and are not part of `{# ... }` semantics yet.

### Control Flow

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `BLOCK(stmts...)` | Execute sequentially, return last | `{ a; b }`, `{; a; b }` |
| `CASE(branches...)` | If/elseif/else branching | `{? cond ? val; default }` |
| `LOOP(init, cond, body, update)` | Loop with optional name/max metadata | `{@ init; cond; body; update }`, `{@name:100@ ... }`, `{@::@ ... }` |
| `BREAK(meta, value)` | Structured break that exits the nearest matching target | `{! value }`, `{!@ value }`, `{!?name! value }` |
| `SYSTEM_SPEC(meta)` | Create a symbolic system spec value | `{#x,y:p# p = x + y }` |
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
| `TENSOR_LITERAL(shape, elems...)` | Create tensor with explicit shape | `{:2x3: 1, 2, 3; 4, 5, 6 }` |
| `ARRAY_CAPTURE(elems...)` | Create array with brace-form constructor capture controls | `{.. 1, 2, 3 }`, `{.. /:=/ x, y }` |
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
| `.RAND_NAME(len?, alphabet?)` | Random string generator | `.RAND_NAME()`, `.RAND_NAME(8, "abc")` |
| `.TGEN(shape, fn)` | Generate tensor by index tuple | `.TGEN({: 2, 3 }, idx -> idx[1] * 10 + idx[2])` |

### Functional / Pipes

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `PIPE(val, fn)` | Pipe value into function | `val \|> fn` |
| `PIPE_EXPLICIT(val, fn)` | Pipe value into function explicitly | `val \|\|> fn` |
| `PSLICE_STRICT(coll, i:j)` | Strict slice collection | `coll \|>/ i:j` |
| `PSLICE_CLAMP(coll, i:j)` | Clamped slice collection | `coll \|>// i:j` |
| `PSPLIT(coll, sep)` | Split collection by delimiter | `coll \|>/\| sep` |
| `PCHUNK(coll, n)` | Chunk collection by size or predicate | `coll \|>#\| nOrFn` |
| `PMAP(coll, fn)` | Map function over collection (arrays/strings/maps/tensors); maps preserve keys; tensors preserve shape | `coll \|>> fn`, `MAP(coll, fn)` |
| `PFILTER(coll, pred)` | Filter by predicate (arrays/strings/maps/tensors) | `coll \|>? pred`, `FILTER(coll, pred)` |
| `PREDUCE(coll, fn, init)` | Reduce/fold (arrays/strings/maps/tensors) | `coll \|>: fn`, `coll \|:> init >: fn`, `REDUCE(coll, fn, init)` |
| `PREVERSE(coll)` | Reverse collection (new copy) | `coll \|><` |
| `PSORT(coll, fn)` | Sort with comparator (new copy) | `coll \|<> fn` |

### Functions

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `FUNCDEF(name, params, body)` | Define named function | `Name(params) -> body` |
| `LAMBDA(params, body)` | Anonymous function | `(params) -> body` |
| `CALL(name, args...)` | Call a user-defined function | `Name(args)` |

Function-call lookup note:
- `Name(args)` searches outward for a callable binding even across scoped block boundaries.
- Bare retrieval `Name` still follows normal lexical variable lookup rules.
- This means `{; F(2) }` can call an outer `F`, while `{; G = F }` requires `{; G = @F }` if `F` is outside the block.

| `UPPER(str)` | Convert to uppercase |
| `SUBSTR(str, start, len)` | Get substring |

### Property & Meta Access

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `META_GET(obj, name)` | Get meta property (null if absent) | `obj.name` |
| `META_SET(obj, name, val)` | Set meta property (null = delete; blocked by `.immutable`; blocked by `.frozen` for non-frozen keys) | `obj.name = val` |
| `META_ALL(obj)` | Get all meta properties as read-only map | `obj..` |
| `META_MERGE(obj, map)` | Bulk merge map into meta (null values = delete) | `obj .= map` |
| `CALL_METHOD(obj, name, args...)` | Resolve and invoke a receiver-first method | `obj.Method(args)`, `obj.Method!(args)` |
| `INDEX_GET(obj, key)` | Index into collection (1-based for sequences/strings; normalized keys for maps) | `obj[expr]`, `obj[:name]`, `obj[:1]` |
| `INDEX_SET(obj, key, val)` | Set index (requires `._mutable` value flag) | `obj[i] = val` |
| `BRACKET_GET(obj, specs...)` | Tensor-aware bracket indexing and slicing | `obj[i, ::]` |
| `BRACKET_SET(obj, specs..., val)` | Tensor-aware bracket assignment | `obj[::, 1] = val` |
| `.KEYOF(x)` | Resolve canonical map key string | `.KEYOF(x)` |
| `.KEYS(obj)` | Get keys of map as set | `obj.\|`, `.KEYS(obj)` |
| `.VALUES(obj)` | Get values of map as set | `obj\|.`, `.VALUES(obj)` |

**Meta Property Categories:**

Meta properties are classified by key prefix, which controls how they behave during `~=` / `~~=` (in-place value replacement):

| Prefix | Category | Examples | Survives `~=`? |
|--------|----------|----------|----------------|
| *(none)* | **Ordinary** | `.key`, `.lock`, `.frozen`, `.immutable` | Yes — preserved from lhs |
| `_` | **Ephemeral** (runtime facts) | `._mutable`, `._spec`, `._deriv`, `._type`, `._proto` | Replaced/rebuilt from the concrete rhs |
| `__` | **Sticky** (semantic interpretation) | `.__units`, `.__format`, `.__name`, `.__type`, `.__traits`, `.__proto` | Preserved unless rhs supplies same key |

- `:=` / `::=` copy **all** meta categories into the new cell.
- `~=` / `~~=` preserve ordinary, replace ephemeral, merge sticky (lhs wins unless rhs overrides).
- `=` (alias) shares the cell entirely — no meta copying occurs.

**Cell-level protections** (ordinary meta — govern whole-value *replacement*):

- **`.lock`**: Blocks `~=`, `~~=`, and combo operators. Does **not** block `=`/`:=` (rebind/copy) or in-place index mutation of a mutable value.
- **`.frozen`**: Blocks `~=`/`~~=` *and* ordinary meta edits (except unsetting `.frozen` itself). Does **not** block `=`/`:=` or in-place index mutation.
- **`.immutable`**: Like `.frozen` but permanent — cannot be unset. Blocks all meta edits and `~=`/`~~=`.
- **`.key` identity**: `.key` must be string/integer and is effectively write-once (idempotent same-value writes allowed; changing value is an error). Used by `KEYOF` for map keys.

**Value-level mutability** (ephemeral meta — governs in-place *structural mutation*):

- **`._mutable`**: When truthy, composite values (arrays, maps, tensors) allow index/bracket assignment (`arr[i] = v`). Arrays, maps, and tensors default to `._mutable = 1`. Remove with `obj._mutable = _` to make the value structurally immutable. Because `._mutable` is ephemeral, it is replaced wholesale when you do `~=` — so the lhs adopts the rhs's `._mutable` state.

**Important:** cell protections (`.lock`, `.frozen`, `.immutable`) and value mutability (`._mutable`) are **independent**. A locked cell may hold a mutable array; a `~=` can replace a locked value (error) but a `[i] = v` succeeds if `._mutable` is set.

```rix
x := [1, 2, 3]
x.lock = 1         ## cell locked against ~=
x ~= [9, 9, 9]    ## ERROR: cell is locked
x[1] = 9          ## OK: ._mutable controls index assignment, not .lock
```

**DeepMutable system function** — recursively set or remove `._mutable` throughout a nested value:

| Call | Effect |
|------|--------|
| `.DeepMutable(value, 1)` | Set `._mutable` on all nested arrays/maps/tensors |
| `.DeepMutable(value, _)` | Remove `._mutable` from all nested arrays/maps/tensors |

The flag `_` (null) means "remove"; any non-null value (including `0`) means "add". Only `_` is false in RiX.

### Regex

| Function | Description | Syntax Aliases |
|----------|-------------|----------------|
| `REGEX(pat, fl, mode)` | Create regex matching function | `{/pat/fl?mode}` |

### I/O

| Function | Description |
|----------|-------------|
| `PRINT(args...)` | Print each argument on a separate line |

### Variables

| Function | Description | Syntax |
|----------|-------------|--------|
| `ASSIGN(name, val)` | Alias/rebind — share rhs cell or create fresh | `name = val` |
| `ASSIGN_COPY(name, val)` | Fresh cell with shallow-copied value + all meta | `name := val` |
| `ASSIGN_UPDATE(name, val)` | In-place value replacement (cell-preserving) | `name ~= val`, `name += val` |
| `ASSIGN_DEEP_COPY(name, val)` | Deep-copied fresh cell | `name ::= val` |
| `ASSIGN_DEEP_UPDATE(name, val)` | In-place deep value replacement | `name ~~= val` |
| `GLOBAL(name, val)` | Set global variable | — |
| `RETRIEVE(name)` | Look up variable | `name` |
| `OUTER_ASSIGN(name, val)` | Rebind an existing outer scope variable | `@name = val` |
| `OUTER_UPDATE(name, val)` | In-place update of outer variable | `@name += val`, `@name ~= val` |
| `OUTER_RETRIEVE(name)` | Look up an outer scope variable | `@name` |

Scope note:
- `RETRIEVE(Name)` remains lexical even for capitalized names.
- Only direct call syntax `Name(...)` uses outward callable lookup.
- Combo operators (`+=`, `-=`, `*=`, `/=`, `//=`, `%=`, `^=`, `++=`, `\/=`, `/\=`, `\=`, `**=`, `/^=`, `/~=`) desugar to `ASSIGN_UPDATE` / `OUTER_UPDATE`, preserving cell identity so aliases track changes.

### Future Extensions (Stubs)

| Function | Description |
|----------|-------------|
| `DERIVATIVE(expr, var)` | Symbolic derivative (future) |
| `INTEGRAL(expr, var)` | Symbolic integral (future) |
| `GENERATOR(args...)` | Sequence generator (future) |
| `STEP(start, end, step)` | Step/range generator (future) |
| `MATRIX(rows...)` | Matrix literal |
| `TENSOR(data...)` | Legacy tensor constructor |
| `TENSOR_LITERAL(shape, elems...)` | Explicit-shape tensor literal |
| `TENSOR_TRANSPOSE(t)` | Rank-2 tensor transpose view |
| `UNIT(val, unit)` | Scientific unit annotation |
| `MATHUNIT(val, unit)` | Mathematical unit annotation |

*Note: Combo assignments (`+=`, `-=`, `*=`, `/=`, `//=`, `%=`, `^=`, `++=`, `\/=`, `/\=`, `\=`, `**=`, `/^=`, `/~=`) automatically desugar into `ASSIGN_UPDATE(x, OP(RETRIEVE(x), y))` or `OUTER_UPDATE(x, OP(OUTER_RETRIEVE(x), y))`, preserving the original cell.*

---

## Part 3: REPL Dot-Commands

### Holes and Undefined

| Syntax | Meaning |
|--------|---------|
| `[1,,3]` | Array with a hole at position 2 |
| `[,1]` | Array with leading hole |
| `[1,]` | Array with trailing hole |
| `[,]` | Two holes |
| `F(,7)` | Call F with hole as first arg, 7 as second |
| `F(1,,3)` | Call F with hole as second arg |
| `a ?| b` | Hole-coalesce: returns `a` if non-hole, else `b` (expression-level) |
| `(x ?= 2, a) -> ...` | Param `x` defaults to `2` when caller omits it or passes a hole |

**Key rules:**
- Holes are **not assignable** — they arise from syntax only.
- Standard arithmetic/comparison operations **error** when given a hole.
- `?|` is lazy — the right side is not evaluated if left is not a hole.
- At the REPL, a bare unbound identifier shows `undefined` (not an error). Expressions *using* an unbound identifier still error.
- `null` (`_`) is a regular value; holes are distinct.

REPL-specific commands use all-lowercase dot notation. They are not part of the RiX language itself but provide tooling and reflection.

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

> **Disambiguation:** `.help`, `.vars`, etc. are REPL shell commands (all lowercase). Any dot expression that starts with an **uppercase** letter (e.g., `.ADD(3,4)`, `.RAND_NAME()`) is a **system capability call** and is evaluated as RiX code, not a REPL command.

**Ctrl-C Behavior:**
- If the current line is non-empty, Ctrl-C clears the line.
- If the current line is empty, Ctrl-C exits the REPL.

## Part 4: Diagnostics, Testing, and Debugging

All diagnostic system capabilities produce structured RiX map values with at minimum: `kind`, `label`, `file`, `time`, `data`.

### `.Warn(label, dataMap ?= {=})`

Emits a `kind="warn"` event. Returns the event object.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `label` | string | required | Warning label |
| `dataMap` | map | `{=}` | Structured payload |

### `.Info(label, level ?= 1, dataMap ?= {=})`

Emits a `kind="info"` event with a severity level. Returns the event object.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `label` | string | required | Info label |
| `level` | integer | `1` | Severity/verbosity level |
| `dataMap` | map | `{=}` | Structured payload |

### `.Error(label, dataMap ?= {=})`

Emits a `kind="error"` event and **aborts** evaluation. Does not return normally.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `label` | string | required | Error label |
| `dataMap` | map | `{=}` | Structured payload |

### `.Stop(label, condition, dataMap ?= {=})`

Conditional abort. If `condition` is null (`_`), returns null and emits nothing. If `condition` is non-null, emits a `kind="stop"` event and aborts.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `label` | string | required | Stop label |
| `condition` | any | required | Abort if non-null |
| `dataMap` | map | `{=}` | Structured payload |

### `.Test(label, setup, tests)`

Runs a test group. Returns a rich result map. Two modes:

**Sequential mode** (third arg is array `[...]`):
- Setup runs once; tests run in order in shared state
- Null result = failure; stops remaining tests
- Runtime error = error; stops remaining tests

```rix
.Test("group", {; x := 1 }, [
    x == 1,
    {; x ~= x + 1; x == 2 }
])
```

**Isolated mode** (third arg is map `{= ... }`):
- Setup reruns fresh for each labeled test
- All tests are attempted regardless of individual failures

```rix
.Test("group", {; x := 5 }, {=
    add = x + 1 == 6,
    mul = x * 2 == 10
})
```

**Result shape** (both modes):

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `"test"` | Event kind |
| `label` | string | Test group label |
| `mode` | `"sequential"` or `"isolated"` | Test mode |
| `file` | string | Source file path |
| `passed` | `1` or `_` | Overall pass/fail |
| `results` | array or map | Per-test outcomes |
| `summary` | map | `{= total, passed, failed, errored, skipped }` |

**Pass/fail semantics:** null (`_`) = failure, any non-null = pass.

**Duplicate labels:** Two `.Test(...)` calls with the same label in the same file produce an error.

### `.TestError(label, setup, expr)`

Tests that a single expression aborts with an error. Passes when `expr` aborts via `.Error(...)` or any runtime/interpreter error. The setup block runs first; if setup aborts for any reason, the entire test fails.

| Parameter | Type | Description |
|-----------|------|-------------|
| `label` | string | Test label (unique per file) |
| `setup` | block | Runs once before the tested expression |
| `expr` | expression | The single expression expected to abort with an error |

**Pass criteria:**
- Setup completes normally, AND
- `expr` aborts with `.Error(...)` → outcome `"error"`, OR
- `expr` aborts with a runtime error → outcome `"runtimeError"`

**Fail criteria:**
- Setup aborts for any reason
- `expr` returns normally (including returning `_`)
- `expr` aborts with `.Stop(...)` instead of an error kind

```rix
.TestError("division by zero", {;
    x := 10;
    y := 0
}, x / y)

.TestError("explicit error", {;
    x := 5
}, .Error("bad input", {= x = x }))
```

**Result shape:**

| Field | Type | Description |
|-------|------|-------------|
| `kind` | `"test"` | Event kind |
| `testKind` | `"error"` | Abort test kind |
| `label` | string | Test label |
| `file` | string | Source file path |
| `passed` | `1` or `_` | Overall pass/fail |
| `expected` | `"error"` | Expected abort kind |
| `setup` | map | `{ passed, outcome, value?, abort?, error? }` |
| `expr` | map | `{ passed, outcome, value?, abort?, error? }` |
| `summary` | map | `{ expected, setupPassed, exprOutcome }` |

Outcome values: `"returned"`, `"error"`, `"stop"`, `"runtimeError"`.

**Duplicate labels:** Two `.TestError(...)` (or `.Test(...)` / `.TestStop(...)`) calls with the same label in the same file produce an error.

### `.TestStop(label, setup, expr)`

Tests that a single expression aborts via `.Stop(...)`. Passes only when `expr` triggers a stop-kind abort. The setup block runs first; if setup aborts for any reason, the entire test fails.

| Parameter | Type | Description |
|-----------|------|-------------|
| `label` | string | Test label (unique per file) |
| `setup` | block | Runs once before the tested expression |
| `expr` | expression | The single expression expected to abort via `.Stop(...)` |

**Pass criteria:**
- Setup completes normally, AND
- `expr` aborts with `.Stop(...)` → outcome `"stop"`

**Fail criteria:**
- Setup aborts for any reason
- `expr` returns normally (including returning `_`)
- `expr` aborts with `.Error(...)` or a runtime error instead of stop

```rix
.TestStop("negative guard", {;
    x := -3
}, .Stop("negative", x < 0, {= x = x }))
```

The result shape is the same as `.TestError(...)` with `testKind = "stop"` and `expected = "stop"`.

### `.Debug(label, expr)`

AST-aware debug inspection. Captures the expression's IR/source structure, evaluates it once, and **returns the evaluated value** (not the event). Also emits a `kind="debug"` event.

```rix
x := .Debug("check", a + b)   ## x gets the value of a + b
```

Debug data payload includes `exprSource`, `ast`, and `final`.

### `.Trace(label, depth, trackedVars ?= [], thunkOrCallable)`

Execution tracing wrapper. Establishes a trace context, invokes the callable, and **returns the callable's result**. Emits a `kind="trace"` event.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `label` | string | required | Trace label |
| `depth` | integer | required | Max call depth to trace |
| `trackedVars` | array of strings | `[]` | Variable names to track |
| `thunkOrCallable` | callable | required | Code to trace |

```rix
.Trace("fib", 3, ["n", "acc"], () -> Fib(10))
```

Trace data payload includes `depth`, `trackedVars`, `calls` (array of enter/exit/write events), and `final`.

### CLI: `rix test`

Test discovery and execution from the command line.

```
bun rix/tools/rix.js test [filters...]
```

- **No filters:** recursively discovers all `*.test.rix` files from the current directory
- **With filters:** only runs files whose path contains one of the filter strings (case-insensitive)
- Each file runs in a fresh runtime context
- **Exit code 0** if all test files pass; **nonzero** if any fail or error
- Output includes per-file pass/fail status, per-test-group summaries, and diagnostic event counts
