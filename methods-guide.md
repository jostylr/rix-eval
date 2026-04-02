# RiX Methods Guide

RiX methods are receiver-first sugar over callable values:

```rix
obj.Method(a, b)
obj.Method!(a, b)
```

- `Method` is the non-mutating form. It returns a new value.
- `Method!` is the mutating form. It modifies the receiver in place and requires a mutable receiver.
- Method lookup rules and `_proto` semantics are defined in [syntax-guide.md](./syntax-guide.md).

## General rules

- Methods are not a class system. They are sugar over callables that receive the receiver as argument 1.
- Read-only methods only exist without `!`.
- Some methods are mutation-only extractors, such as `Pop!()` and `Shift!()`.
- Some methods come in pairs, such as `Push` / `Push!`.
- Built-in prototypes are frozen. There is no prototype chaining in v1.

## Generic Reduce

Collections with a `Reduce` method use this callback shape:

```rix
obj.Reduce((acc, value, keyOrIndex, obj) -> nextAcc, initial?)
```

- The receiver is always the last callback argument.
- Extra callback arguments can be ignored with arity caps such as `@+[2]`.
- If `initial` is omitted, RiX creates an empty mutable accumulator suited to the receiver type.

Default `Reduce` accumulators:

| Receiver | Default accumulator |
|----------|---------------------|
| Array | `[]` |
| Map | `{= }` |
| Set | `{| |}` |
| String | `""` |
| Tuple | Empty mutable tuple with the same arity, filled with holes |
| Tensor | Empty mutable tensor with the same shape, filled with holes |

Examples:

```rix
[1, 2, 3].Reduce((acc, v) -> acc.Push!(v * 2))
"ab".Reduce((acc, ch) -> acc.Concat(ch.Upper()))
{: 1, 3 }.Reduce((acc, v, k) -> acc.Set(k, v * 10))
{:2x2: 1, 2; 3, 4 }.Reduce((acc, v, idx) -> acc.Set!(idx, v))
```

## Arrays

Read-only:
`Len`, `IsEmpty`, `Get`, `First`, `Last`, `Includes`, `IndexOf`, `LastIndexOf`, `HasAt`, `Slice`, `Join`, `DropFirst`, `DropLast`, `Map`, `Filter`, `Any`, `All`, `Count`, `Find`, `FindIndex`, `Reduce`

Paired:
`Push` / `Push!`, `Unshift` / `Unshift!`, `Set` / `Set!`, `Insert` / `Insert!`, `RemoveAt` / `RemoveAt!`, `Concat` / `Concat!`, `Reverse` / `Reverse!`, `Sort` / `Sort!`, `Distinct` / `Distinct!`, `Flatten` / `Flatten!`

Mutation-only:
`Pop!`, `Shift!`

Notes:

- `Pop!()` removes and returns the last element. Empty arrays return RiX's undefined hole value.
- `Shift!()` removes and returns the first element. Empty arrays return the hole value.
- `RemoveAt(index)` returns a shortened array.
- `RemoveAt!(index)` leaves a hole in place instead of shortening the receiver.
- Array callbacks receive `(value, index, array)`.

## Maps

Read-only:
`Len`, `IsEmpty`, `Has`, `Get`, `Keys`, `Values`, `Entries`, `MapValues`, `ReduceKeys`, `Filter`, `Any`, `All`, `Count`, `Reduce`

Paired:
`Set` / `Set!`, `Remove` / `Remove!`, `Merge` / `Merge!`, `Update` / `Update!`, `Default` / `Default!`, `Keep` / `Keep!`, `Omit` / `Omit!`

Notes:

- `MapValues` callback receives `(value, key, map)`.
- `ReduceKeys` callback receives `(acc, key, value, map)`.
- `Filter`, `Any`, `All`, `Count`, and `Reduce` use `(value, key, map)`.

## Sets

Read-only:
`Len`, `IsEmpty`, `Has`, `Values`, `SubsetOf`, `SupersetOf`, `Disjoint`, `Filter`, `Any`, `All`, `Count`, `Reduce`

Paired:
`Add` / `Add!`, `Remove` / `Remove!`, `Union` / `Union!`, `Intersect` / `Intersect!`, `Diff` / `Diff!`, `SymDiff` / `SymDiff!`

Notes:

- Set callbacks receive `(value, value, set)`.
- The second callback argument repeats the set value so generic reducers can treat it as a key/index slot.

## Strings

Read-only:
`Len`, `IsEmpty`, `Get`, `First`, `Last`, `Includes`, `StartsWith`, `EndsWith`, `IndexOf`, `LastIndexOf`, `Slice`, `Concat`, `Split`, `Trim`, `TrimStart`, `TrimEnd`, `Upper`, `Lower`, `Replace`, `ReplaceAll`, `PadLeft`, `PadRight`, `Repeat`, `Reduce`

Notes:

- Strings only have non-mutating methods.
- String callbacks receive `(char, index, string)`.
- `Reduce` defaults to an empty string accumulator for concatenation-style folds.

## Tuples

Read-only:
`Len`, `Get`, `First`, `Last`, `Slice`, `Set`, `ToArray`, `Reduce`

Notes:

- Tuples currently only have non-mutating methods.
- Tuple callbacks receive `(value, index, tuple)`.
- `Set` returns a new tuple.

## Tensors

Read-only:
`Shape`, `Rank`, `Size`, `Get`, `Set`, `Reshape`, `Flatten`, `Transpose`, `Permute`, `Map`, `Sum`, `Mean`, `Dot`, `MatMul`, `Reduce`

Paired:
`Set` / `Set!`

Mutation-only:
`Fill!`

Notes:

- Tensor callbacks receive `(value, indexTuple, tensor)`.
- `Set!` accepts either separate selectors or a single tuple index.
- `Transpose` is currently rank-2 only.
- `Permute` expects a tuple of axes.
- `Dot` expects equal-length rank-1 tensors.
- `MatMul` expects compatible rank-2 tensors.

## Full Documentation of methods

This section is the reference version of the built-in method surface. Signatures are written in receiver-first form.

### Arrays

`Len()`
- Signature: `array.Len() -> Integer`
- Purpose: Return the number of slots in the array.
- Example:
```rix
[1, 2, 3].Len()   ## 3
```

`IsEmpty()`
- Signature: `array.IsEmpty() -> 1 | null`
- Purpose: Return truthy when the array has no elements.
- Example:
```rix
[ ].IsEmpty()
```

`Get(index)`
- Signature: `array.Get(index) -> value | null`
- Purpose: Return the element at a 1-based index. Negative indices count from the end.
- Example:
```rix
[10, 20, 30].Get(2)    ## 20
[10, 20, 30].Get(-1)   ## 30
```

`First()`, `Last()`
- Signature: `array.First() -> value | null`, `array.Last() -> value | null`
- Purpose: Return the first or last element.
- Example:
```rix
[10, 20, 30].First()   ## 10
[10, 20, 30].Last()    ## 30
```

`Includes(value)`
- Signature: `array.Includes(value) -> 1 | null`
- Purpose: Test whether the array contains a value.
- Example:
```rix
[1, 2, 3].Includes(2)
```

`IndexOf(value)`, `LastIndexOf(value)`
- Signature: `array.IndexOf(value) -> Integer | null`, `array.LastIndexOf(value) -> Integer | null`
- Purpose: Return the first or last 1-based position where the value occurs.
- Example:
```rix
[1, 2, 2].IndexOf(2)       ## 2
[1, 2, 2].LastIndexOf(2)   ## 3
```

`HasAt(index)`
- Signature: `array.HasAt(index) -> 1 | null`
- Purpose: Test whether the array has a non-hole value at the given index.
- Example:
```rix
[1,,3].HasAt(2)   ## null
```

`Slice(start?, end?)`
- Signature: `array.Slice(start?, end?) -> Array`
- Purpose: Return a non-mutating slice. Start is inclusive, end is exclusive, using RiX's 1-based indexing.
- Note: Bracket slicing uses different semantics: `array[i:j]` is inclusive on both ends and may run backward.
- Example:
```rix
[1, 2, 3, 4].Slice(2, 4)   ## [2, 3]
[1, 2, 3, 4][2:4]          ## [2, 3, 4]
[1, 2, 3, 4][4:2]          ## [4, 3, 2]
```

`Join(separator?)`
- Signature: `array.Join(separator?) -> String`
- Purpose: Convert array elements to strings and join them.
- Example:
```rix
[1, 2, 3].Join("-")   ## "1-2-3"
```

`Push(values...)`, `Push!(values...)`
- Signature: `array.Push(values...) -> Array`, `array.Push!(values...) -> Array`
- Purpose: Append values to the end. `Push` returns a new array. `Push!` mutates and returns the receiver.
- Example:
```rix
a := [1, 2]
b := a.Push(3)
a.Push!(3, 4)
```

`Unshift(values...)`, `Unshift!(values...)`
- Signature: `array.Unshift(values...) -> Array`, `array.Unshift!(values...) -> Array`
- Purpose: Add values to the front.
- Example:
```rix
[2, 3].Unshift(1)     ## [1, 2, 3]
```

`Set(index, value)`, `Set!(index, value)`
- Signature: `array.Set(index, value) -> Array`, `array.Set!(index, value) -> Array`
- Purpose: Write a value at the given index. Out-of-range writes clamp and can extend the array.
- Example:
```rix
[1, 2].Set(2, 9)   ## [1, 9]
```

`Insert(index, value)`, `Insert!(index, value)`
- Signature: `array.Insert(index, value) -> Array`, `array.Insert!(index, value) -> Array`
- Purpose: Insert a value before the given index.
- Example:
```rix
[1, 3].Insert(2, 2)   ## [1, 2, 3]
```

`RemoveAt(index)`, `RemoveAt!(index)`
- Signature: `array.RemoveAt(index) -> Array`, `array.RemoveAt!(index) -> Array`
- Purpose: Remove a slot at an index. `RemoveAt` shortens the returned array. `RemoveAt!` leaves a hole in the receiver.
- Example:
```rix
[1, 2, 3].RemoveAt(2)   ## [1, 3]
a := [1, 2, 3]
a.RemoveAt!(2)          ## a is [1,,3]
```

`Swap(i, j)`, `Swap!(i, j)`
- Signature: `array.Swap(i, j) -> Array`, `array.Swap!(i, j) -> Array`
- Purpose: Exchange two existing slots. Negative indices count from the end.
- Example:
```rix
[10, 20, 30].Swap(1, 3)   ## [30, 20, 10]
```

`Move(indexOrInterval, targetIndex)`, `Move!(indexOrInterval, targetIndex)`
- Signature: `array.Move(indexOrInterval, targetIndex) -> Array`, `array.Move!(indexOrInterval, targetIndex) -> Array`
- Purpose: Remove one element or an inclusive interval, then reinsert it elsewhere.
- Semantics:
  Positive `targetIndex` inserts before that 1-based position in the post-removal array.
  Negative `targetIndex` inserts after that position counting from the end of the post-removal array.
- Example:
```rix
[1, 2, 3, 4, 5, 6, 7].Move(4:6, 2)   ## [1, 4, 5, 6, 2, 3, 7]
[1, 2, 3, 4].Move(1, -1)             ## [2, 3, 4, 1]
[1, 2, 3, 4].Move(2, -2)             ## [1, 3, 2, 4]
```

`Concat(valuesOrCollections...)`, `Concat!(valuesOrCollections...)`
- Signature: `array.Concat(items...) -> Array`, `array.Concat!(items...) -> Array`
- Purpose: Concatenate arrays or append plain values.
- Example:
```rix
[1, 2].Concat([3, 4])   ## [1, 2, 3, 4]
```

`Reverse()`, `Reverse!()`
- Signature: `array.Reverse() -> Array`, `array.Reverse!() -> Array`
- Purpose: Reverse element order.
- Example:
```rix
[1, 2, 3].Reverse()   ## [3, 2, 1]
```

`Sort()`, `Sort!()`
- Signature: `array.Sort() -> Array`, `array.Sort!() -> Array`
- Purpose: Sort values using RiX's built-in value ordering.
- Example:
```rix
[3, 1, 2].Sort()   ## [1, 2, 3]
```

`Distinct()`, `Distinct!()`
- Signature: `array.Distinct() -> Array`, `array.Distinct!() -> Array`
- Purpose: Remove duplicate values while keeping first occurrence order.
- Example:
```rix
[1, 2, 2, 3].Distinct()   ## [1, 2, 3]
```

`Flatten(depth?)`, `Flatten!(depth?)`
- Signature: `array.Flatten(depth?) -> Array`, `array.Flatten!(depth?) -> Array`
- Purpose: Flatten nested arrays, tuples, and sets by one level by default, or by the given depth.
- Example:
```rix
[1, [2, 3]].Flatten()   ## [1, 2, 3]
```

`DropFirst(count?)`, `DropLast(count?)`
- Signature: `array.DropFirst(count?) -> Array`, `array.DropLast(count?) -> Array`
- Purpose: Return an array with values removed from the front or back. Default count is `1`.
- Example:
```rix
[1, 2, 3].DropFirst()   ## [2, 3]
[1, 2, 3].DropLast()    ## [1, 2]
```

`Pop!()`, `Shift!()`
- Signature: `array.Pop!() -> value | HOLE`, `array.Shift!() -> value | HOLE`
- Purpose: Remove and return the last or first element. On an empty array they return RiX's hole value.
- Example:
```rix
a := [1, 2, 3]
a.Pop!()    ## 3
a.Shift!()  ## 1
```

`Map(iterator)`
- Signature: `array.Map((value, index, array) -> newValue) -> Array`
- Purpose: Transform each element into a new array.
- Iterator arguments: `(value, index, array)`
- Example:
```rix
[10, 20].Map((v, k) -> v + k)   ## [11, 22]
```

`Filter(iterator)`
- Signature: `array.Filter((value, index, array) -> truthy) -> Array`
- Purpose: Keep only elements whose callback returns truthy.
- Iterator arguments: `(value, index, array)`
- Example:
```rix
[1, 2, 3, 4].Filter((v) -> v > 2)   ## [3, 4]
```

`Any(iterator)`, `All(iterator)`
- Signature: `array.Any((value, index, array) -> truthy) -> 1 | null`, `array.All((value, index, array) -> truthy) -> 1 | null`
- Purpose: Test whether any or all elements satisfy a predicate.
- Iterator arguments: `(value, index, array)`
- Example:
```rix
[1, 2, 3].Any((v) -> v == 2)
[1, 2, 3].All((v) -> v > 0)
```

`Count(iterator?)`
- Signature: `array.Count(iterator?) -> Integer`
- Purpose: Count matching elements, or all elements if no iterator is supplied.
- Iterator arguments: `(value, index, array)`
- Example:
```rix
[1, 2, 3, 4].Count((v) -> v > 2)   ## 2
```

`Find(iterator)`, `FindIndex(iterator)`
- Signature: `array.Find((value, index, array) -> truthy) -> value | null`, `array.FindIndex((value, index, array) -> truthy) -> Integer | null`
- Purpose: Return the first matching value or its index.
- Iterator arguments: `(value, index, array)`
- Example:
```rix
[1, 2, 3].Find((v) -> v == 2)        ## 2
[1, 2, 3].FindIndex((v) -> v == 2)   ## 2
```

`Reduce(iterator, initial?)`
- Signature: `array.Reduce((acc, value, index, array) -> nextAcc, initial?) -> any`
- Purpose: Fold the array into a single result. Without `initial`, the default accumulator is `[]`.
- Iterator arguments: `(acc, value, index, array)`
- Example:
```rix
[1, 2, 3].Reduce((acc, v) -> acc.Push!(v * 10))   ## [10, 20, 30]
```

### Maps

`Len()`, `IsEmpty()`
- Signature: `map.Len() -> Integer`, `map.IsEmpty() -> 1 | null`
- Purpose: Return the number of entries, or whether the map is empty.
- Example:
```rix
{= a=1, b=2 }.Len()   ## 2
```

`Has(key)`, `Get(key)`
- Signature: `map.Has(key) -> 1 | null`, `map.Get(key) -> value | null`
- Purpose: Test for a key or retrieve its value.
- Example:
```rix
m := {= a=1, b=2 }
m.Has("a")
m.Get("b")
```

`Keys()`, `Values()`, `Entries()`
- Signature: `map.Keys() -> Set`, `map.Values() -> Set`, `map.Entries() -> Array`
- Purpose: Return map keys, values, or key-value entry tuples.
- Example:
```rix
{= a=1, b=2 }.Entries()   ## [{: "a", 1 }, {: "b", 2 }]
```

`Set(key, value)`, `Set!(key, value)`
- Signature: `map.Set(key, value) -> Map`, `map.Set!(key, value) -> Map`
- Purpose: Add or replace an entry.
- Example:
```rix
{= a=1 }.Set("b", 2)
```

`Remove(key)`, `Remove!(key)`
- Signature: `map.Remove(key) -> Map`, `map.Remove!(key) -> Map`
- Purpose: Remove an entry by key.
- Example:
```rix
{= a=1, b=2 }.Remove("a")   ## {= b=2 }
```

`Merge(other)`, `Merge!(other)`
- Signature: `map.Merge(otherMap) -> Map`, `map.Merge!(otherMap) -> Map`
- Purpose: Merge another map, letting later entries win.
- Example:
```rix
{= a=1 }.Merge({= b=2, a=9 })   ## {= a=9, b=2 }
```

`Update(key, updater)`, `Update!(key, updater)`
- Signature: `map.Update(key, (value, key, map) -> newValue) -> Map`, `map.Update!(key, (value, key, map) -> newValue) -> Map`
- Purpose: Compute a new value from the current entry. Missing keys pass `null` as the current value.
- Iterator arguments: `(value, key, map)`
- Example:
```rix
{= a=1 }.Update("a", (v) -> v + 1)   ## {= a=2 }
```

`Default(key, value)`, `Default!(key, value)`
- Signature: `map.Default(key, value) -> Map`, `map.Default!(key, value) -> Map`
- Purpose: Insert a value only if the key is missing.
- Example:
```rix
{= a=1 }.Default("b", 2)   ## {= a=1, b=2 }
```

`Keep(keys)`, `Keep!(keys)`
- Signature: `map.Keep(keys) -> Map`, `map.Keep!(keys) -> Map`
- Purpose: Keep only the specified keys. The argument can be a set, array, tuple, or single key-like value.
- Example:
```rix
{= a=1, b=2, c=3 }.Keep({| "a", "c" |})   ## {= a=1, c=3 }
```

`Omit(keys)`, `Omit!(keys)`
- Signature: `map.Omit(keys) -> Map`, `map.Omit!(keys) -> Map`
- Purpose: Remove the specified keys.
- Example:
```rix
{= a=1, b=2, c=3 }.Omit({| "b" |})   ## {= a=1, c=3 }
```

`MapValues(iterator)`
- Signature: `map.MapValues((value, key, map) -> newValue) -> Map`
- Purpose: Transform values while preserving keys.
- Iterator arguments: `(value, key, map)`
- Example:
```rix
{= a=1, b=2 }.MapValues((v) -> v * 10)   ## {= a=10, b=20 }
```

`ReduceKeys(iterator, initial?)`
- Signature: `map.ReduceKeys((acc, key, value, map) -> nextAcc, initial?) -> any`
- Purpose: Reduce over keys first, then values. Without `initial`, the default accumulator is `{= }`.
- Iterator arguments: `(acc, key, value, map)`
- Example:
```rix
{= a=1, b=2 }.ReduceKeys((acc, k, v) -> acc.Push!({: k, v }), [])
```

`Filter(iterator)`, `Any(iterator)`, `All(iterator)`, `Count(iterator?)`
- Signature: `map.Filter((value, key, map) -> truthy) -> Map`, `map.Any((value, key, map) -> truthy) -> 1 | null`, `map.All((value, key, map) -> truthy) -> 1 | null`, `map.Count(iterator?) -> Integer`
- Purpose: Filter or test map entries.
- Iterator arguments: `(value, key, map)`
- Example:
```rix
{= a=1, b=2 }.Filter((v, k) -> k == "b")   ## {= b=2 }
```

`Reduce(iterator, initial?)`
- Signature: `map.Reduce((acc, value, key, map) -> nextAcc, initial?) -> any`
- Purpose: Reduce over values and keys. Without `initial`, the default accumulator is `{= }`.
- Iterator arguments: `(acc, value, key, map)`
- Example:
```rix
{= a=1, b=2 }.Reduce((acc, v, k) -> acc.Set!(k, v + 1))   ## {= a=2, b=3 }
```

### Sets

`Len()`, `IsEmpty()`, `Has(value)`, `Values()`
- Signature: `set.Len() -> Integer`, `set.IsEmpty() -> 1 | null`, `set.Has(value) -> 1 | null`, `set.Values() -> Array`
- Purpose: Query set size, emptiness, membership, or enumerate its values.
- Example:
```rix
{| 1, 2 |}.Has(2)
```

`Add(value)`, `Add!(value)`
- Signature: `set.Add(value) -> Set`, `set.Add!(value) -> Set`
- Purpose: Insert a value if it is not already present.
- Example:
```rix
{| 1, 2 |}.Add(3)   ## {| 1, 2, 3 |}
```

`Remove(value)`, `Remove!(value)`
- Signature: `set.Remove(value) -> Set`, `set.Remove!(value) -> Set`
- Purpose: Remove a value from the set.
- Example:
```rix
{| 1, 2, 3 |}.Remove(2)   ## {| 1, 3 |}
```

`Union(other)`, `Union!(other)`
- Signature: `set.Union(otherSet) -> Set`, `set.Union!(otherSet) -> Set`
- Purpose: Compute or apply the union of two sets.
- Example:
```rix
{| 1, 2 |}.Union({| 2, 3 |})   ## {| 1, 2, 3 |}
```

`Intersect(other)`, `Intersect!(other)`
- Signature: `set.Intersect(otherSet) -> Set`, `set.Intersect!(otherSet) -> Set`
- Purpose: Compute or apply the intersection.
- Example:
```rix
{| 1, 2 |}.Intersect({| 2, 3 |})   ## {| 2 |}
```

`Diff(other)`, `Diff!(other)`
- Signature: `set.Diff(otherSet) -> Set`, `set.Diff!(otherSet) -> Set`
- Purpose: Compute or apply set difference.
- Example:
```rix
{| 1, 2, 3 |}.Diff({| 2 |})   ## {| 1, 3 |}
```

`SymDiff(other)`, `SymDiff!(other)`
- Signature: `set.SymDiff(otherSet) -> Set`, `set.SymDiff!(otherSet) -> Set`
- Purpose: Compute or apply symmetric difference.
- Example:
```rix
{| 1, 2 |}.SymDiff({| 2, 4 |})   ## {| 1, 4 |}
```

`SubsetOf(other)`, `SupersetOf(other)`, `Disjoint(other)`
- Signature: `set.SubsetOf(otherSet) -> 1 | null`, `set.SupersetOf(otherSet) -> 1 | null`, `set.Disjoint(otherSet) -> 1 | null`
- Purpose: Test set relationships.
- Example:
```rix
{| 1, 2 |}.SubsetOf({| 1, 2, 3 |})
```

`Filter(iterator)`, `Any(iterator)`, `All(iterator)`, `Count(iterator?)`
- Signature: `set.Filter((value, valueAgain, set) -> truthy) -> Set`, `set.Any((value, valueAgain, set) -> truthy) -> 1 | null`, `set.All((value, valueAgain, set) -> truthy) -> 1 | null`, `set.Count(iterator?) -> Integer`
- Purpose: Filter or test set contents.
- Iterator arguments: `(value, value, set)`. The second slot repeats the value so generic reducers can still treat it like a locator slot.
- Example:
```rix
{| 1, 2, 3 |}.Filter((v) -> v > 1)   ## {| 2, 3 |}
```

`Reduce(iterator, initial?)`
- Signature: `set.Reduce((acc, value, valueAgain, set) -> nextAcc, initial?) -> any`
- Purpose: Reduce a set. Without `initial`, the default accumulator is `{| |}`.
- Iterator arguments: `(acc, value, value, set)`
- Example:
```rix
{| 1, 2, 3 |}.Reduce((acc, v) -> acc.Add!(v * 10))
```

### Strings

`Len()`, `IsEmpty()`
- Signature: `string.Len() -> Integer`, `string.IsEmpty() -> 1 | null`
- Purpose: Query string length in code points, or whether the string is empty.
- Example:
```rix
"abc".Len()   ## 3
```

`Get(index)`, `First()`, `Last()`
- Signature: `string.Get(index) -> String | null`, `string.First() -> String | null`, `string.Last() -> String | null`
- Purpose: Read characters by 1-based position.
- Example:
```rix
"abc".Get(2)   ## "b"
```

`Includes(text)`, `StartsWith(prefix)`, `EndsWith(suffix)`
- Signature: `string.Includes(text) -> 1 | null`, `string.StartsWith(prefix) -> 1 | null`, `string.EndsWith(suffix) -> 1 | null`
- Purpose: Standard substring tests.
- Example:
```rix
"abc".StartsWith("a")
```

`IndexOf(text)`, `LastIndexOf(text)`
- Signature: `string.IndexOf(text) -> Integer | null`, `string.LastIndexOf(text) -> Integer | null`
- Purpose: Return the first or last 1-based match position.
- Example:
```rix
"abca".LastIndexOf("a")   ## 4
```

`Slice(start?, end?)`
- Signature: `string.Slice(start?, end?) -> String`
- Purpose: Return a substring using code-point indexing.
- Example:
```rix
"abcd".Slice(2, 4)   ## "bc"
```

`Concat(parts...)`
- Signature: `string.Concat(parts...) -> String`
- Purpose: Concatenate strings or string-like values.
- Example:
```rix
"ab".Concat("cd")   ## "abcd"
```

`Split(separator?)`
- Signature: `string.Split(separator?) -> Array`
- Purpose: Split on a separator. If omitted, split into characters.
- Example:
```rix
sep := ","
"a,b,c".Split(sep)   ## ["a", "b", "c"]
"abc".Split()        ## ["a", "b", "c"]
```

`Trim()`, `TrimStart()`, `TrimEnd()`
- Signature: `string.Trim() -> String`, `string.TrimStart() -> String`, `string.TrimEnd() -> String`
- Purpose: Remove surrounding whitespace.
- Example:
```rix
"  hi  ".Trim()   ## "hi"
```

`Upper()`, `Lower()`
- Signature: `string.Upper() -> String`, `string.Lower() -> String`
- Purpose: Change case.
- Example:
```rix
"abc".Upper()   ## "ABC"
```

`Replace(search, replacement)`, `ReplaceAll(search, replacement)`
- Signature: `string.Replace(search, replacement) -> String`, `string.ReplaceAll(search, replacement) -> String`
- Purpose: Replace the first or all string matches.
- Example:
```rix
"banana".Replace("na", "x")      ## "baxna"
"banana".ReplaceAll("na", "x")   ## "baxx"
```

`PadLeft(length, pad?)`, `PadRight(length, pad?)`
- Signature: `string.PadLeft(length, pad?) -> String`, `string.PadRight(length, pad?) -> String`
- Purpose: Extend a string to a target width.
- Example:
```rix
"7".PadLeft(3, "0")    ## "007"
"7".PadRight(3, "0")   ## "700"
```

`Repeat(count)`
- Signature: `string.Repeat(count) -> String`
- Purpose: Repeat a string.
- Example:
```rix
"ha".Repeat(3)   ## "hahaha"
```

`Reduce(iterator, initial?)`
- Signature: `string.Reduce((acc, char, index, string) -> nextAcc, initial?) -> any`
- Purpose: Reduce a string. Without `initial`, the default accumulator is `""`.
- Iterator arguments: `(acc, char, index, string)`
- Example:
```rix
"ab".Reduce((acc, ch) -> acc.Concat(ch.Upper()))   ## "AB"
```

### Tuples

`Len()`
- Signature: `tuple.Len() -> Integer`
- Purpose: Return tuple arity.
- Example:
```rix
{: 4, 5, 6 }.Len()   ## 3
```

`Get(index)`, `First()`, `Last()`
- Signature: `tuple.Get(index) -> value | null`, `tuple.First() -> value | null`, `tuple.Last() -> value | null`
- Purpose: Read tuple values by 1-based position.
- Example:
```rix
{: 4, 5, 6 }.Get(2)   ## 5
```

`Slice(start?, end?)`
- Signature: `tuple.Slice(start?, end?) -> Tuple`
- Purpose: Return a sliced tuple.
- Example:
```rix
{: 4, 5, 6 }.Slice(2)   ## {: 5, 6 }
```

`Set(index, value)`
- Signature: `tuple.Set(index, value) -> Tuple`
- Purpose: Return a new tuple with the chosen slot replaced.
- Example:
```rix
{: 4, 5, 6 }.Set(2, 9)   ## {: 4, 9, 6 }
```

`ToArray()`
- Signature: `tuple.ToArray() -> Array`
- Purpose: Convert a tuple into a mutable array.
- Example:
```rix
{: 4, 5, 6 }.ToArray()   ## [4, 5, 6]
```

`Reduce(iterator, initial?)`
- Signature: `tuple.Reduce((acc, value, index, tuple) -> nextAcc, initial?) -> any`
- Purpose: Reduce a tuple. Without `initial`, the default accumulator is an empty mutable tuple of the same arity.
- Iterator arguments: `(acc, value, index, tuple)`
- Example:
```rix
{: 4, 5, 6 }.Reduce((acc, v, k) -> acc.Set(k, v * 2))
```

### Tensors

`Shape()`, `Rank()`, `Size()`
- Signature: `tensor.Shape() -> Tuple`, `tensor.Rank() -> Integer`, `tensor.Size() -> Integer`
- Purpose: Inspect tensor dimensions, rank, and total cell count.
- Example:
```rix
t := {:2x3: 1, 2, 3; 4, 5, 6 }
t.Shape()   ## {: 2, 3 }
```

`Get(selectors...)`
- Signature: `tensor.Get(i1, i2, ...) -> value | TensorView`
- Purpose: Read a tensor cell or selection using tensor selector rules.
- Example:
```rix
{:2x2: 1, 2; 3, 4 }.Get(2, 1)   ## 3
```

`Set(selectors..., value)`, `Set!(selectors..., value)`
- Signature: `tensor.Set(i1, i2, ..., value) -> Tensor`, `tensor.Set!(i1, i2, ..., value) -> Tensor`
- Purpose: Write to a tensor cell or selection. `Set` returns a copy. `Set!` mutates.
- Notes: Selectors may also be passed as a single tuple.
- Example:
```rix
t := {:2x2: 1, 2; 3, 4 }
t.Set(1, 2, 9)
t.Set!({: 1, 2 }, 9)
```

`Reshape(shapeTuple)`
- Signature: `tensor.Reshape(shapeTuple) -> Tensor`
- Purpose: Return a reshaped tensor with the same cell data and total size.
- Example:
```rix
{:2x2: 1, 2; 3, 4 }.Reshape({: 4 })
```

`Flatten()`
- Signature: `tensor.Flatten() -> Tensor`
- Purpose: Return a rank-1 tensor containing all cells in row-major order.
- Example:
```rix
{:2x2: 1, 2; 3, 4 }.Flatten()   ## {:4: 1, 2, 3, 4 }
```

`Transpose()`
- Signature: `tensor.Transpose() -> TensorView`
- Purpose: Return a transposed rank-2 view.
- Example:
```rix
{:2x3: 1, 2, 3; 4, 5, 6 }.Transpose()
```

`Permute(orderTuple)`
- Signature: `tensor.Permute(orderTuple) -> TensorView`
- Purpose: Return a view with axes reordered.
- Example:
```rix
t.Permute({: 2, 1 })
```

`Map(iterator)`
- Signature: `tensor.Map((value, indexTuple, tensor) -> newValue) -> Tensor`
- Purpose: Map each tensor cell to a new tensor of the same shape.
- Iterator arguments: `(value, indexTuple, tensor)`
- Example:
```rix
{:2x2: 1, 2; 3, 4 }.Map((v, idx) -> v * idx[1])
```

`Fill!(value)`
- Signature: `tensor.Fill!(value) -> Tensor`
- Purpose: Mutate every tensor cell to the given value.
- Example:
```rix
t := {:2x2: 1, 2; 3, 4 }
t.Fill!(0)
```

`Sum()`, `Mean()`
- Signature: `tensor.Sum() -> NumberLike`, `tensor.Mean() -> NumberLike | null`
- Purpose: Sum all non-hole tensor cells, or compute their arithmetic mean. Empty tensors return `null` from `Mean()`.
- Example:
```rix
{:2x2: 1, 2; 3, 4 }.Sum()    ## 10
{:2x2: 1, 2; 3, 4 }.Mean()   ## 5/2
```

`Dot(other)`
- Signature: `tensor.Dot(otherTensor) -> NumberLike`
- Purpose: Compute the dot product of two equal-length rank-1 tensors.
- Example:
```rix
{:3: 1, 2, 3 }.Dot({:3: 4, 5, 6 })   ## 32
```

`MatMul(other)`
- Signature: `tensor.MatMul(otherTensor) -> Tensor`
- Purpose: Perform rank-2 matrix multiplication.
- Example:
```rix
{:2x3: 1, 2, 3; 4, 5, 6 }.MatMul({:3x2: 7, 8; 9, 10; 11, 12 })
```

`Reduce(iterator, initial?)`
- Signature: `tensor.Reduce((acc, value, indexTuple, tensor) -> nextAcc, initial?) -> any`
- Purpose: Reduce a tensor. Without `initial`, the default accumulator is an empty mutable tensor with the same shape.
- Iterator arguments: `(acc, value, indexTuple, tensor)`
- Example:
```rix
{:2x2: 1, 2; 3, 4 }.Reduce((acc, v, idx) -> acc.Set!(idx, v * 10))
```
