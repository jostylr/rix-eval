# RiX Types And Traits Guide

RiX separates concrete runtime facts from sticky semantic interpretation.

Runtime metadata is ephemeral:

- `._type` names the current concrete runtime shape, such as `Integer`, `Rational`, `RationalInterval`, `array`, or `tensor`.
- `._proto` is the built-in/runtime method layer.

Semantic metadata is sticky:

- `.__name` is an optional semantic name.
- `.__type` is the requested semantic type, such as `:Rational`, `:RationalInterval`, or `:Tensor`.
- `.__traits` is the materialized set of semantic traits.
- `.__proto` contains semantic method layers.

`.__proto` is a map with:

- `.__proto[:traits]`
- `.__proto[:type]`

Method lookup checks direct meta first, then trait proto methods, then type proto methods, then runtime `._proto`.

## Trait Registry

Traits are immutable semantic capability entries. A trait may define implied traits, verification, proto methods, and descriptive metadata.

Trait implication is resolved when traits are applied. All implied traits are materialized into `.__traits`, so inquiry stays simple:

```rix
x = {^ /::Rational/ 7}
x ? :number
x ? :ring
x ? :field
x ? :rational
```

`x ? :trait` checks `.__traits` directly. It does not dynamically walk implication chains.

Trait proto methods are layered in application order. Later traits overwrite earlier trait methods.

## Type Registry

Types are immutable protocol bundles. A type can define conversion, normalization, validation, default traits, type proto, export/import hooks, and system operator variants.

Built-in registered types include:

- `:Integer`
- `:Rational`
- `:RationalInterval`
- `:String`
- `:Array`
- `:Tuple`
- `:Map`
- `:Tensor`
- `:Set`
- `:Function`
- `:Multifunction`
- `:Null`
- `:Hole`

Lowercase aliases such as `:rational`, `:interval`, and `:tensor` remain supported for compatibility. New code should prefer registered semantic names such as `:Rational`.

## Conversion

The same target-driven conversion path is used by:

```rix
x ~: :Rational
x ~!: :Rational
{^ /::Rational/ x}
```

Soft conversion returns `_` on conversion failure. Strict conversion and semantic headers throw.

The pipeline:

1. Find the target type entry.
2. Determine the semantic source type from `.__type` and runtime source type from `._type` or the concrete value.
3. Try `convertFrom` for the runtime/source type.
4. Try the type's generic converter.
5. Normalize and validate.
6. Set sticky `.__type`.
7. Materialize default and explicit traits, including implications.
8. Build `.__proto[:type]` and `.__proto[:traits]`.
9. Refresh runtime metadata.

Sticky semantic type is reapplied during `~=` and `~~=` updates, so a value like `{^ /::Rational/ 7}` remains a Rational when updated with a new exact value.

## Export And Import

Type export uses tagged maps:

```rix
r = 7 ~: :Rational
e = .TypeExport(r)
r2 = .TypeImport(e)
r == r2
```

Export maps contain:

- `type`
- `data`
- `cache`
- `version`

Ordinary cell metadata such as `.lock`, `.key`, `.frozen`, and `.immutable` is not part of ordinary type export.

## Operator Installation

Selected internal system operators are system multifunctions. They try installed type variants first and keep the native implementation as the final `/NativeFallback/` variant.

First-wave operators include:

- `ADD`, `SUB`, `MUL`, `DIV`
- `INTDIV`, `MOD`
- `POW`, `POWPROD`
- `NEG`
- `EQ`, `LT`, `GT`, `LTE`, `GTE`

Built-in type installation currently installs Rational arithmetic/comparison variants before native fallback. Type install order is dispatch order; fallback remains last.

`^` lowers to `POW`. `**` lowers to `POWPROD`. Both currently share native behavior, but they are distinct system functions and operator aliases:

```rix
@^    ## .POW
@**   ## .POWPROD
```

## Defining New Types And Traits

The runtime now exposes immutable JS-side registration helpers in `rix/eval/src/type-system.js`:

- `registerTrait(spec)`
- `registerType(spec)`
- `installRegisteredTypes(registry, typeNames)`

Registration stores immutable specs. Installation injects operator variants into system multifunctions. RiX-source startup registration is reserved for the next layer on top of this runtime API.

Oracle-style real number implementations are deliberately not built in. They are user-land types so multiple real-number representations can coexist and be compared. The example startup loader in `src/startup/oracle-example.js` registers:

- `:refinable`
- `:approximate`
- `:oracle`
- `:Oracle`

Hosts can load it when creating the registry:

```js
import { createDefaultRegistry } from "./src/evaluator.js";
import { loadOracleExampleStartup } from "./src/startup/oracle-example.js";

const registry = createDefaultRegistry({
  startupLoaders: [loadOracleExampleStartup],
});
```

After that startup load, RiX code can use the example type:

```rix
o = 7 ~: :Oracle
e = .TypeExport(o)
o2 = .TypeImport(e)
o2.Mid()
```
