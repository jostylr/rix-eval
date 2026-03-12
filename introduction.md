# RiX Language Introduction

RiX (Rational Interval Expression Language) is a language for exact numeric computation, functional data transformation, and symbolic reasoning. This document introduces its core concepts with emphasis on the pipe operator system.

## Collections

RiX has four primary collection kinds:

| Kind | Literal syntax | Description |
|------|----------------|-------------|
| Sequence (array) | `[1, 2, 3]` | Ordered, 1-based indexed |
| String | `"hello"` | Unicode code-point sequence |
| Tuple | `{: a, b, c }` | Fixed-arity positional group |
| Map | `{= a=1, b=2 }` | Key-value, canonicalized string keys |

Arrays and maps are **mutable by default** (`mutable=1`). Other collections are immutable.

Map keys are canonicalized via `KEYOF`: integers become their decimal string, strings stay as-is, and arbitrary values may supply a `.key` meta property.

## Pipe Operators

Pipes pass values through transformations. All collection-pipe operators return **new** collections and never mutate the source.

### Plain pipe

```rix
val |> fn        ## pipe val as first arg to fn
val ||> fn(_1)   ## explicit placeholder form
```

### Collection traversal pipes

The following pipes traverse elements of a collection and invoke a callback on each. They support sequences, strings, and (for the traversal/fold operators) maps.

```rix
coll |>> fn      ## PMAP:    map fn over elements
coll |>? pred    ## PFILTER: keep elements where pred passes
coll |>&& pred   ## PALL:    every element passes (short-circuits)
coll |>|| pred   ## PANY:    any element passes (short-circuits)
coll |>: fn      ## PREDUCE: fold, first element/value as init
coll |:> init >: fn   ## PREDUCE: fold with explicit initial value
coll |>/| sep    ## PSPLIT:  split by delimiter, regex, or predicate
coll |>#| n      ## PCHUNK:  chunk by size or predicate boundary
coll |>< fn      ## Not a pipe; |>< is PREVERSE (reverse)
coll |<> fn      ## PSORT:   sort with comparator
```

### Callback contract

For **traversal pipes** (`|>>`, `|>?`, `|>&&`, `|>||`, predicate form of `|>/|`, predicate form of `|>#|`):

```
callback(val, locator, src)
```

For **reduce** (`|>:` and `|:> init >: fn`):

```
callback(acc, val, locator, src)
```

For **sort** (`|<>`), the comparator receives only:

```
comparator(a, b)
```

**Locator** is the native indexing/key form for the source collection kind:
- **Sequences and strings**: 1-based integer position (position 1 is the first element)
- **Maps**: the canonical map key as a RiX string
- **Tensors**: a 1-based index tuple

Callbacks that declare fewer parameters simply ignore the extra arguments.

### Examples — sequences

```rix
## Map with value only (backward-compatible)
[1, 2, 3] |>> (x) -> x * x         ## [1, 4, 9]

## Map with value + locator
[10, 20, 30] |>> (v, k) -> k        ## [1, 2, 3]  (1-based positions)

## Map using all three args (value, locator, source)
[10, 20, 30] |>> (v, k, s) -> {: v, k, .LEN(s) }
## [{: 10, 1, 3 }, {: 20, 2, 3 }, {: 30, 3, 3 }]

## Filter by locator (keep even-indexed elements)
[10, 20, 30, 40] |>? (v, k) -> k % 2 == 0    ## [20, 40]

## Reduce summing locators (1+2+3)
[10, 20, 30] |:> 0 >: (acc, v, k) -> acc + k  ## 6

## Reduce — implicit init (first element is accumulator)
[1, 2, 3, 4] |>: (acc, v) -> acc + v           ## 10
```

### Examples — strings

Strings are traversed as Unicode code points. The locator is the 1-based code-point position.

```rix
"abc" |>> (ch, k) -> k        ## [1, 2, 3]  (code-point positions)
"😀a😃" |>> (ch) -> ch        ## "😀a😃"  (identity map returns string)
"aAbBc" |>? (ch) -> ch != "A" ## "aBbc"  (filter on char value)
```

### Examples — maps

Maps support `|>>`, `|>?`, `|>&&`, `|>||`, `|>:`, and `|:> init >: fn`. Maps are **unordered** — no iteration-order guarantee is exposed to users.

For map traversal, callbacks receive `(value, key, sourceMap)`. The key is the canonical map key string.

`|>>` on a map **preserves original keys and transforms only values**. For structural reshaping, use reduce.

```rix
m = {= a=2, b=3 }

## Map values (preserve keys)
m |>> (v, k) -> v * 10          ## {= a=20, b=30 }

## Map — callback can use the key
m |>> (v, k) -> k ++ "=" ++ v   ## {= a="a=2", b="b=3" }

## Filter by value
{= a=2, b=7, c=1 } |>? (v, k) -> v > 1    ## {= a=2, b=7 }

## Filter by key
{= a=2, b=7, c=1 } |>? (v, k) -> k == "b" ## {= b=7 }

## All values positive?
{= a=2, b=7 } |>&& (v) -> v > 0   ## 7  (last value; null if any fail)

## Any value > 5?
{= a=2, b=7 } |>|| (v) -> v > 5   ## 7  (first passing value)

## Explicit-init reduce over values
{= a=2, b=7 } |:> 0 >: (acc, v) -> acc + v  ## 9

## Implicit-init reduce (first value encountered is accumulator; order unspecified)
{= a=2, b=7 } |>: (acc, v) -> acc + v       ## 9  (result, order unspecified)
```

Maps do **not** support `|>/|` (split), `|>#|` (chunk), or `|<>` (sort).

### Examples — tensors

Tensor literals use an explicit shape header and row-major order:

```rix
m := {:2x3: 1, 2, 3; 4, 5, 6 }
m[2, 3]            ## 6
m[1, ::]           ## tensor view of the first row
m^^                ## transpose view, shape {: 3, 2 }
```

Tensor traversal pipes use the index tuple as the locator:

```rix
{:2x3:} |>> (v, idx) -> idx[1] * 10 + idx[2]
## {:2x3: 11, 12, 13; 21, 22, 23 }
```

This is the preferred fill idiom. Assignment loops are usually unnecessary because tuple pipes already unpack index tuples:

```rix
{:2x3x7:} |>> (v, idx) -> (idx |> SomeFormula)
```

### Reduce syntax — two forms

RiX has two distinct reduce forms with intentionally different semantics:

| Form | Syntax | Init source |
|------|--------|-------------|
| Implicit init | `coll \|>: fn` | First element/value of `coll` |
| Explicit init | `coll \|:> init >: fn` | `init` expression |

Both forms pass `(acc, val, locator, src)` to the callback.

### Backward compatibility with partial functions

Existing partial callbacks continue to work. When a partial is invoked via a traversal pipe, it receives only as many arguments as needed to satisfy its placeholders. Extra locator/src arguments are not forwarded to partials to avoid unintended behavior with N-ary system functions.

```rix
## These all work as before
[1, 2, 3] |>> @*(_1, 10)           ## [10, 20, 30]
[1, 2, 3] |>: @+(_1, _2)           ## 6
[1, 2, 3] |>? @>(_1, 0)            ## [1, 2, 3]
```

To access the locator or source in a partial, use explicit placeholder positions:

```rix
## _1 = val, _2 = locator, _3 = src
[10, 20, 30] |>> @+(_1, _2)   ## [11, 22, 33]  (value + 1-based position)
```

## Arity-Capped Callable Views

The syntax `fn[n]` produces a **callable wrapper** that forwards only the first `n` arguments to `fn` and silently discards any extras.

```rix
fn[n]
```

This is useful when a pipe callback supplies extra context arguments (locator, source) that a bare system function would misinterpret.

**This is not partial application.** It does not bind arguments, reorder them, or select arbitrary positions — it simply truncates the incoming argument list to the first `n`.

### Examples

```rix
## Reduce with bare @+ — without arity cap, @+ would receive (acc, val, locator, src)
## and MUL would try to use the sequence object in arithmetic.
[1, 2, 3] |>: @+[2]        ## 6   (only acc and val forwarded to @+)
[1, 2, 3] |:> 0 >: @+[2]   ## 6

## Map and filter with a user function
double := (x) -> x * 2
[1, 2, 3] |>> double[1]     ## [2, 4, 6]   (locator dropped)

isEven := (x) -> x % 2 == 0
[1, 2, 3, 4] |>? isEven[1]  ## [2, 4]

## Works on maps too
{= a=2, b=3 } |>> double[1]   ## {= a=4, b=6 }

## General call context (not pipe-specific)
G := @+[2]
G(10, 20, 99, 99)   ## 30  (only 10 and 20 forwarded)

## Zero-arity cap
C := () -> 42
C[0](1, 2, 3)       ## 42  (no args forwarded)

## Nested caps — outer cap wins
@+[3][2](1, 2, 3, 4)   ## 3  (at most 2 args reach @+)
```

### Relationship to placeholders

| Approach | Syntax | Purpose |
|---|---|---|
| Arity cap | `fn[n]` | Forward only first `n` args |
| Placeholder | `@+(_1, _2)` | Explicit selection / reordering |

Use `fn[n]` when you want "first N args only"; use placeholders when you need anything more specific.

### Rules

- `n` must be a non-negative integer literal. Negative or non-integer values error.
- If fewer than `n` arguments are supplied at call time, all are forwarded (no padding).
- Works on any callable value: lambdas, named functions (uppercase), system references, partials, or already-capped callables.
- Does not affect ordinary collection indexing — `collection[i]` continues to index as before.

## Map Keys

Map keys are canonicalized strings:
- Plain identifiers in literals (`a=1`) use the identifier name as key
- Parenthesized expressions (`(1)=2`) use `KEYOF` to canonicalize: integers become `"1"`, `"2"`, etc.
- Strings use their value

```rix
m = {= a=5, (1)=10, ("x")=20 }
m["a"]   ## 5
m[1]     ## 10   (integer 1 → key "1")
m["x"]   ## 20
```

When a map callback receives a key locator `k`, it is a RiX string value consistent with `KEYOF` and `INDEX_GET`.

## Sort

The sort comparator receives `(a, b)` only — no locator or source. Sort does not support maps.

```rix
[3, 1, 2] |<> (a, b) -> a - b   ## [1, 2, 3]  ascending
```

## Holes and Undefined

RiX has an explicit **hole** value distinct from `null`. Holes arise from two sources:
1. **Omitted syntax** — explicit gaps in array or function-call argument lists.
2. **Unbound identifiers at the REPL** — typing a bare name that has not been assigned displays `undefined` instead of an error.

### null vs hole

| | `null` (`_`) | hole |
|---|---|---|
| Literal syntax | `_` | `[1,,3][2]`, `F(,7)` |
| Assignable? | yes | no |
| Falsy? | yes | — |
| Standard ops | accepted | **error** |
| `?|` coalescing | left side kept | right side used |

### Array hole syntax

Consecutive or trailing commas produce holes:

```rix
[1,,3]      ## sequence with hole at position 2
[,1]        ## hole then 1
[1,]        ## 1 then hole
[,]         ## two holes
[,,]        ## three holes
[1,,3][2]   ## → hole
```

### Hole-coalescing operator `?|`

`left ?| right` — returns `left` if it is not a hole, otherwise evaluates and returns `right`.

```rix
a := [1,,3]
a[2] ?| 9      ## → 9  (position 2 is a hole)
a[1] ?| 9      ## → 1  (position 1 is not a hole)
a[2] ?| a[3]   ## → 3  (chains naturally: left-associative)
```

`?|` is lazy — the right side is not evaluated when the left side is not a hole.

### Omitted call arguments

Pass a hole explicitly by omitting a positional argument:

```rix
F(,7)      ## first arg is a hole
F(1,,3)    ## second arg is a hole
F(,)       ## both args are holes
```

### Parameter defaults with `?|`

Parameters can declare a **hole default** using `?|`. The default is used when the caller explicitly passes a hole or when the argument is omitted entirely:

```rix
F := (x ?| 2, a) -> a ^ x
F(, 7)     ## → 49   (hole for x → x defaults to 2, 7^2)
F(3, 7)    ## → 343  (explicit 3, 7^3)
F(0, 7)    ## → 1    (explicit 0, 7^0; holeDefault not triggered)
```

### Holes in pipes

Holes in sequences are passed through to callbacks. Use `?|` inside the callback to handle them:

```rix
[1,,3] |>> (x -> (x ?| 0) + 1)   ## → [2, 1, 4]
```

Standard reduction/arithmetic pipes will **throw** if they encounter a hole:

```rix
[1,,3] |>: @+[2]   ## error: Cannot use undefined/hole value in computation
```

### REPL unbound identifiers

In the interactive REPL, entering a bare unbound identifier displays `undefined` (rather than raising an error). Expressions that *use* an unbound identifier still throw:

```
rix> x
undefined
rix> x + 1
Error: Undefined variable: x
```

## Tensor Notes

- Tensor indices are 1-based; negative indices count from the end; index `0` is invalid.
- Bracket slices are strict, closed, and directed. `::` is sugar for the full forward slice.
- Tensor `|>>` returns a new dense tensor with the same shape.
- Tensor `|>?` returns a sequence of `{: value, indexTuple }` pairs.
