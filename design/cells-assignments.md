Below is a one-page mini-spec for the RiX assignment system based on our discussion. It is written so it can serve as both a design reference and an implementation guide.

⸻

RiX Assignment and Cell Semantics (Mini-Spec)

Overview

In RiX, variables refer to cells, not directly to values.

A cell is the fundamental storage unit:

Cell = {
  value,
  meta
}

	•	value is the current stored data.
	•	meta is a map of metadata describing the cell and/or its value.

Assignment operators control:
	1.	Whether the lhs name is rebound to a different cell.
	2.	Whether the existing lhs cell is preserved and its value replaced.
	3.	Whether the rhs value/meta are copied shallowly or deeply.

⸻

1. Meta Property Classes

Meta keys fall into three semantic classes.

1.1 Cell Identity / Policy Meta

Keys not beginning with _

Examples:

.key
.mutable
.frozen
.immutable
.origin

Properties:
	•	Describe the identity or policy of the cell
	•	Survive in-place updates (~= / ~~=)

Example:

x.key = "temperature"
x ~= 21

x.key remains "temperature".

⸻

1.2 Ephemeral Value Meta

Keys beginning with exactly one underscore

._spec
._deriv
._source

Properties:
	•	Describe the current value occupant
	•	Replaced wholesale during ~= / ~~= updates.

Example:

f._spec = "sensor formula"
f ~= 21

f._spec disappears unless the rhs supplies one.

⸻

1.3 Sticky Value-Interpretation Meta

Keys beginning with two underscores

.__units
.__dimension
.__frame

Properties:
	•	Describe interpretation of the value stream
	•	Preserved across updates unless rhs explicitly supplies them.

Example:

t.__units = "C"
t ~= 21

.__units remains "C".

Example with overwrite:

a.__units = "C"
b.__units = "F"
a ~= b

Result:

a.__units == "F"


⸻

2. Primitive Runtime Model

Environment:

Env : Name -> Cell

Evaluation:

eval(expr, Env) -> Cell

Some expressions return existing cells (e.g. variable references).
Others produce fresh temporary cells (e.g. literals, arithmetic).

⸻

3. Assignment Operators

3.1 Alias / Rebinding

x = expr

Semantics:

R = eval(expr)
bind(x, R)

Effects:
	•	x now refers to the same cell as expr.
	•	No copying occurs.

Example:

x := 5
y = x
x += 1

Result:

x == 6
y == 6

Both names share the same cell.

⸻

3.2 Fresh Shallow Copy Assignment

x := expr

Semantics:

R = eval(expr)

newCell = {
    value = shallowCopy(R.value)
    meta  = shallowCopy(R.meta)
}

bind(x, newCell)

Effects:
	•	Creates a new independent cell
	•	Copies value and all meta

Example:

x := 5
y := x
x += 1

Result:

x == 6
y == 5


⸻

3.3 In-Place Shallow Update

x ~= expr

Semantics (existing x):

lhs = Env[x]
rhs = eval(expr)

lhs.value = shallowCopy(rhs.value)

lhs.meta =
    ordinary(lhs.meta)
    ∪ ephemeral(rhs.meta)
    ∪ stickyMerge(lhs.meta, rhs.meta)

Meta rules:

meta type	behavior
ordinary	preserved
._*	replaced from rhs
.__*	preserved unless rhs supplies value

Example:

t.key = "temperature"
t.__units = "C"
t._spec = "sensor"

t ~= 21

Result:

t.key == "temperature"
t.__units == "C"
t._spec absent


⸻

3.4 Fresh Deep Copy Assignment

x ::= expr

Semantics:

R = eval(expr)

newCell = {
    value = deepCopy(R.value)
    meta  = deepCopy(R.meta)
}

bind(x, newCell)

Creates a fresh cell with deep-copied value and meta.

⸻

3.5 In-Place Deep Update

x ~~= expr

Semantics:

lhs = Env[x]
rhs = eval(expr)

lhs.value = deepCopy(rhs.value)

lhs.meta =
    ordinary(lhs.meta)
    ∪ deepCopy(ephemeral(rhs.meta))
    ∪ stickyMerge(lhs.meta, deepCopy(sticky(rhs.meta)))

Identical to ~= except value and incoming meta are deep-copied.

⸻

4. Undefined LHS with ~= or ~~=

If the lhs variable does not yet exist:

x ~= expr

creates a new cell:

value = shallowCopy(rhs.value)
meta  = ephemeral(rhs.meta) ∪ sticky(rhs.meta)

Ordinary meta from rhs is not inherited.

This keeps ~= conceptually an update operator, not a cloning operator.

⸻

5. Combo Assignment Operators

Compound assignments rewrite to ~= updates.

x += y

rewrites to:

x ~= x + y

General rule:

x op= y   →   x ~= x op y

Examples:

x += y   → x ~= x + y
x -= y   → x ~= x - y
x *= y   → x ~= x * y
x /= y   → x ~= x / y
x ^= y   → x ~= x ^ y

Effects:
	•	Cell identity preserved
	•	Aliases observe updates

Example:

a := 5
b = a
a += 1

Result:

a == 6
b == 6


⸻

6. Copy Depth

operator	copy depth
:=	shallow
::=	deep
~=	shallow
~~=	deep


⸻

7. Summary Table

operator	cell identity	value copy	meta behavior
=	rebind to rhs	none	rhs meta
:=	new cell	shallow	copy all
::=	new cell	deep	deep copy
~=	preserve lhs cell	shallow	preserve ordinary, replace ._, merge .__
~~=	preserve lhs cell	deep	same meta rules


⸻

8. Design Rationale

The assignment system separates three concepts:
	1.	Cell identity
	2.	Value replacement
	3.	Metadata propagation

This allows:
	•	explicit aliasing (=)
	•	explicit copying (:=, ::=)
	•	explicit in-place updates (~=, ~~=)
	•	controlled metadata behavior for symbolic or annotated values.

The system supports:
	•	alias-visible mutation
	•	stable cell identity (.key)
	•	ephemeral value metadata
	•	persistent interpretation metadata (.__units, etc.).

⸻

Excellent. These kinds of edge-case tables are where language semantics either prove themselves or reveal hidden gremlins. The goal here is to stress the system in ways real programs will.

Below are 12 canonical tests that probe aliasing, copy depth, metadata propagation, and assignment edge cases.

⸻

RiX Assignment Semantics — Edge Case Examples

Each example shows:
	•	code
	•	expected result
	•	what semantic rule it validates

⸻

1. Alias propagation through mutation

x := 5
y = x
x += 1

Expected:

x == 6
y == 6

Reason:

= aliases the same cell.

+= rewrites to:

x ~= x + 1

so the same cell is updated, affecting all aliases.

⸻

2. Copy isolation with :=

x := 5
y := x
x += 1

Expected:

x == 6
y == 5

Reason:

:= creates a new cell with copied value/meta.

⸻

3. Shallow structure sharing

a := [1,2]
b := a
a ~= a
a[1] = 9

Expected:

b[1] == 2

Reason:

:= copied the array reference shallowly into a new cell, but the array itself was not deep-copied.

If the array itself was copied internally depends on your array semantics; this test clarifies that.

⸻

4. Deep copy isolation

a := [1,2]
b ::= a
a[1] = 9

Expected:

b[1] == 1

Reason:

::= deep-copies the structure.

⸻

5. Ordinary meta survives ~=

t.key = "temperature"
t.mutable = 1

t ~= 25

Expected:

t.key == "temperature"
t.mutable == 1

Reason:

ordinary meta is cell identity metadata.

⸻

6. Ephemeral meta wiped by update

f._spec = "original spec"

f ~= 7

Expected:

f._spec   absent

Reason:

._* metadata is replaced wholesale from rhs.

Since rhs has none, it disappears.

⸻

7. Ephemeral meta replaced by rhs

f._spec = "old"

g._spec = "new"

f ~= g

Expected:

f._spec == "new"

Reason:

ephemeral meta replaced from rhs.

⸻

8. Sticky meta preserved

t.__units = "C"

t ~= 21

Expected:

t.__units == "C"

Reason:

.__* metadata persists unless overwritten.

⸻

9. Sticky meta overwritten

a.__units = "C"

b.__units = "F"

a ~= b

Expected:

a.__units == "F"

Reason:

rhs sticky metadata overrides lhs.

⸻

10. := copies all meta classes

x.key = "velocity"
x._spec = "formula"
x.__units = "m/s"

y := x

Expected:

y.key == "velocity"
y._spec == "formula"
y.__units == "m/s"

Reason:

:= clones all meta.

⸻

11. ~= with undefined lhs

x ~= 5

Expected:

x.value == 5
x.meta contains only value meta copied from rhs

Meaning:
	•	no ordinary meta
	•	ephemeral copied if rhs had it
	•	sticky copied if rhs had it

This confirms that ~= creates a fresh cell when needed.

⸻

12. Alias chain update

a := 1
b = a
c = b

a += 4

Expected:

a == 5
b == 5
c == 5

Reason:

all three names reference the same cell.

⸻

13. Alias broken by rebinding

a := 5
b = a

a := 7

Expected:

a == 7
b == 5

Reason:

:= rebinds a to a new cell, leaving b unchanged.

⸻

14. In-place update preserves alias

a := 5
b = a

a ~= 9

Expected:

a == 9
b == 9

Reason:

~= mutates the existing cell.

⸻

15. Deep update preserves alias

a := [1,2]
b = a

a ~~= [3,4]

Expected:

b == [3,4]

Reason:

~~= preserves cell identity but deep copies rhs value.

⸻

16. Sticky meta persistence across multiple updates

t.__units = "C"

t ~= 10
t ~= 11
t ~= 12

Expected:

t.__units == "C"

Sticky metadata remains stable.

⸻

17. Sticky overwritten once

t.__units = "C"

u.__units = "K"

t ~= u
t ~= 300

Expected:

t.__units == "K"

The overwrite sticks.

⸻

18. Ephemeral cleared then reintroduced

f._spec = "old"

f ~= 5

g._spec = "new"

f ~= g

Expected:

f._spec == "new"

Demonstrates ephemeral lifecycle.

⸻

Why these tests matter

These tests collectively verify:

property	tested by
alias vs copy	1,2,12,13
cell mutation vs rebinding	13,14
deep vs shallow copy	3,4
meta propagation rules	5–10
sticky meta behavior	8–9,16–17
ephemeral lifecycle	6–7,18
undefined lhs semantics	11


