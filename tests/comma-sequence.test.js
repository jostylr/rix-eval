import { describe, test, expect } from "bun:test";
import { Integer } from "@ratmath/core";
import { tokenize } from "../../parser/src/tokenizer.js";
import { parse } from "../../parser/src/parser.js";
import { lower } from "../src/lower.js";
import { evaluate, createDefaultRegistry, createDefaultSystemContext } from "../src/evaluator.js";
import { Context } from "../src/context.js";

function evalRix(code) {
  const context = new Context();
  const registry = createDefaultRegistry();
  const systemContext = createDefaultSystemContext();
  const ast = parse(tokenize(code));
  const irNodes = lower(ast);

  let result = null;
  for (const irNode of irNodes) {
    result = evaluate(irNode, context, registry, systemContext);
  }
  return result;
}

function expectInteger(value, expected) {
  expect(value).toBeInstanceOf(Integer);
  expect(value.value).toBe(BigInt(expected));
}

describe("comma sequence expressions", () => {
  test("loop init can contain comma-separated assignments", () => {
    const result = evalRix("{@ i = 1, j = 3; i < j; i + j; i += 1}");

    expectInteger(result, 5);
  });

  test("sequence expressions evaluate left-to-right and return the last value", () => {
    const result = evalRix("{; x = 1, x += 2, x + 4 }");

    expectInteger(result, 7);
  });

  test("lowering keeps comma sequence in one deferred loop slot", () => {
    const [ir] = lower(parse(tokenize("{@ i = 1, j = 3; i < j; i + j; i += 1}")));

    expect(ir.fn).toBe("LOOP");
    expect(ir.args).toHaveLength(4);
    expect(ir.args[0].fn).toBe("DEFER");
    expect(ir.args[0].args[0].fn).toBe("SEQ");
    expect(ir.args[0].args[0].args).toHaveLength(2);
  });

  test("array commas still create multiple elements at evaluation time", () => {
    const result = evalRix("[1, 2, 3]");

    expect(result.type).toBe("sequence");
    expect(result.values).toHaveLength(3);
    expectInteger(result.values[0], 1);
    expectInteger(result.values[2], 3);
  });
});
