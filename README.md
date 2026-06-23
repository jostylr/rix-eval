# RiX Language Evaluator

The RiX evaluator lowers parser AST nodes into IR and evaluates that IR against a
cell-based runtime context.

## Current Status

This is the active RiX runtime, not a stub. It currently supports:

- Exact integer/rational arithmetic through `@ratmath/core`
- Cell-based assignment and aliasing semantics
- Blocks, cases, loops, structured breaks, and ternary expressions
- Functions, lambdas, prep phases, multifunction dispatch, and tail self calls
- Arrays, maps, sets, tuples, intervals, tensors, holes, and destructuring
- Pipe operators, traversal callbacks, partial application, and methods
- Script imports with capability sandboxing
- Diagnostics, testing helpers, tracing, and debug events
- Runtime error messages with line/column source locations when source text is
  available through `parseAndEvaluate()` or script imports

The main entry points are:

- `parseAndEvaluate(code, options)` for source-to-result evaluation
- `evaluate(irNode, context, registry, systemContext)` for direct IR evaluation
- `createDefaultRegistry()` for internal language/operator functions
- `createDefaultSystemContext()` for dot-prefixed system capabilities

## Known Gaps

The following evaluator capabilities are intentionally still stubs or partial:

- `DERIVATIVE` and `INTEGRAL` return stub objects.
- `GENERATOR` and `STEP` return stub objects.
- Array generator syntax has partial eager support in array construction, but
  lazy generators and function-driven generator forms are not complete.
- `{$ ... }` system blocks currently evaluate with block-like semantics; the
  broader constraint/solver model is still design work.
- Unit annotations parse and carry metadata, but full unit arithmetic/conversion
  is not implemented here.

Run the evaluator tests from this directory with:

```bash
bun test
```
