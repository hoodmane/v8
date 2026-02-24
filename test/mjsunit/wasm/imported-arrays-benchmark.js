// Copyright 2024 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Benchmark comparing wasm:js-array builtins vs JS-defined imports.
//
// How to run:
//   ./out/x64.release/d8 test/mjsunit/wasm/imported-arrays-benchmark.js
//
// To get more accurate measurements, increase {iterations} and {elementsPerArray}.
//
// NOTE: The builtins currently fall through to the generic call path in
// TurboShaft (turboshaft-graph-interface.cc). Once optimized implementations
// are added, the builtins should be significantly faster than JS imports.

d8.file.execute("test/mjsunit/wasm/wasm-module-builder.js");

// Benchmark parameters - adjust these for more accurate measurements.
const iterations = 10000;
const elementsPerArray = 100;
const accessCount = 50;  // Number of at() calls per iteration.

// Signatures for js-array builtins.
let kSig_r_ri = makeSig([kWasmExternRef, kWasmI32], [kWasmExternRef]);
let kSig_i_rr = makeSig([kWasmExternRef, kWasmExternRef], [kWasmI32]);

// JS implementations for comparison.
const jsImports = {
  'js-array': {
    'new': () => [],
    'test': (x) => Array.isArray(x) ? 1 : 0,
    'length': (arr) => {
      if (!Array.isArray(arr)) throw new WebAssembly.RuntimeError('illegal cast');
      return arr.length;
    },
    'at': (arr, index) => {
      if (!Array.isArray(arr)) throw new WebAssembly.RuntimeError('illegal cast');
      return arr.at(index);
    },
    'push': (arr, elem) => {
      if (!Array.isArray(arr)) throw new WebAssembly.RuntimeError('illegal cast');
      return arr.push(elem);
    },
  }
};

function buildModule(useBuiltins) {
  let builder = new WasmModuleBuilder();

  // Import the js-array functions.
  const moduleName = useBuiltins ? 'wasm:js-array' : 'js-array';
  let kArrayNew = builder.addImport(moduleName, 'new', kSig_r_v);
  let kArrayTest = builder.addImport(moduleName, 'test', kSig_i_r);
  let kArrayLength = builder.addImport(moduleName, 'length', kSig_i_r);
  let kArrayAt = builder.addImport(moduleName, 'at', kSig_r_ri);
  let kArrayPush = builder.addImport(moduleName, 'push', kSig_i_rr);

  // Benchmark function: create array, push N elements, read some back.
  // Parameters: element to push, number of elements, number of reads.
  // Returns: length of array (to prevent dead code elimination).
  builder.addFunction("benchmark",
      makeSig([kWasmExternRef, kWasmI32, kWasmI32], [kWasmI32]))
    .exportFunc()
    .addLocals(kWasmExternRef, 1)  // local 3: the array
    .addLocals(kWasmI32, 2)        // local 4: push counter, local 5: read counter
    .addBody([
      // Create new array.
      kExprCallFunction, kArrayNew,
      kExprLocalSet, 3,

      // Push loop: push element N times.
      kExprLoop, kWasmVoid,
        kExprLocalGet, 3,          // array
        kExprLocalGet, 0,          // element
        kExprCallFunction, kArrayPush,
        kExprDrop,
        // counter++
        kExprLocalGet, 4,
        kExprI32Const, 1,
        kExprI32Add,
        kExprLocalTee, 4,
        // if counter < numElements, loop
        kExprLocalGet, 1,
        kExprI32LtU,
        kExprBrIf, 0,
      kExprEnd,

      // Read loop: call at() multiple times with different indices.
      kExprLoop, kWasmVoid,
        // Read element at index (counter % length).
        kExprLocalGet, 3,          // array
        kExprLocalGet, 5,          // index (just use counter)
        kExprCallFunction, kArrayAt,
        kExprDrop,                 // discard result

        // Also read with negative index.
        kExprLocalGet, 3,          // array
        kExprI32Const, 0,
        kExprLocalGet, 5,
        kExprI32Sub,               // -counter
        kExprI32Const, 1,
        kExprI32Sub,               // -counter - 1
        kExprCallFunction, kArrayAt,
        kExprDrop,

        // counter++
        kExprLocalGet, 5,
        kExprI32Const, 1,
        kExprI32Add,
        kExprLocalTee, 5,
        // if counter < numReads, loop
        kExprLocalGet, 2,
        kExprI32LtU,
        kExprBrIf, 0,
      kExprEnd,

      // Return length as result.
      kExprLocalGet, 3,
      kExprCallFunction, kArrayLength,
    ]);

  // Simple push benchmark: just push N elements.
  builder.addFunction("push_only",
      makeSig([kWasmExternRef, kWasmI32], [kWasmI32]))
    .exportFunc()
    .addLocals(kWasmExternRef, 1)  // local 2: the array
    .addLocals(kWasmI32, 1)        // local 3: counter
    .addBody([
      // Create new array.
      kExprCallFunction, kArrayNew,
      kExprLocalSet, 2,

      // Push loop.
      kExprLoop, kWasmVoid,
        kExprLocalGet, 2,
        kExprLocalGet, 0,
        kExprCallFunction, kArrayPush,
        kExprDrop,
        kExprLocalGet, 3,
        kExprI32Const, 1,
        kExprI32Add,
        kExprLocalTee, 3,
        kExprLocalGet, 1,
        kExprI32LtU,
        kExprBrIf, 0,
      kExprEnd,

      // Return length.
      kExprLocalGet, 2,
      kExprCallFunction, kArrayLength,
    ]);

  // At-only benchmark: access elements of pre-existing array.
  builder.addFunction("at_only",
      makeSig([kWasmExternRef, kWasmI32], [kWasmI32]))
    .exportFunc()
    .addLocals(kWasmI32, 1)        // local 2: counter
    .addLocals(kWasmI32, 1)        // local 3: accumulator
    .addBody([
      kExprLoop, kWasmVoid,
        // Access at positive index.
        kExprLocalGet, 0,
        kExprLocalGet, 2,
        kExprCallFunction, kArrayAt,
        kExprDrop,

        // Access at negative index.
        kExprLocalGet, 0,
        kExprI32Const, 0,
        kExprLocalGet, 2,
        kExprI32Sub,
        kExprI32Const, 1,
        kExprI32Sub,
        kExprCallFunction, kArrayAt,
        kExprDrop,

        // counter++
        kExprLocalGet, 2,
        kExprI32Const, 1,
        kExprI32Add,
        kExprLocalTee, 2,
        kExprLocalGet, 1,
        kExprI32LtU,
        kExprBrIf, 0,
      kExprEnd,

      kExprLocalGet, 3,
    ]);

  // New-only benchmark: just create arrays.
  builder.addFunction("new_only",
      makeSig([kWasmI32], [kWasmExternRef]))
    .exportFunc()
    .addLocals(kWasmExternRef, 1)  // local 1: the array
    .addLocals(kWasmI32, 1)        // local 2: counter
    .addBody([
      kExprLoop, kWasmVoid,
        // Create new array.
        kExprCallFunction, kArrayNew,
        kExprLocalSet, 1,

        // counter++
        kExprLocalGet, 2,
        kExprI32Const, 1,
        kExprI32Add,
        kExprLocalTee, 2,
        kExprLocalGet, 0,
        kExprI32LtU,
        kExprBrIf, 0,
      kExprEnd,

      // Return last array (to prevent dead code elimination).
      kExprLocalGet, 1,
    ]);

  // New + single push benchmark: create array and push one element.
  builder.addFunction("new_push_one",
      makeSig([kWasmExternRef, kWasmI32], [kWasmI32]))
    .exportFunc()
    .addLocals(kWasmExternRef, 1)  // local 2: the array
    .addLocals(kWasmI32, 2)        // local 3: counter, local 4: result
    .addBody([
      kExprLoop, kWasmVoid,
        // Create new array.
        kExprCallFunction, kArrayNew,
        kExprLocalSet, 2,

        // Push one element.
        kExprLocalGet, 2,
        kExprLocalGet, 0,
        kExprCallFunction, kArrayPush,
        kExprLocalSet, 4,

        // counter++
        kExprLocalGet, 3,
        kExprI32Const, 1,
        kExprI32Add,
        kExprLocalTee, 3,
        kExprLocalGet, 1,
        kExprI32LtU,
        kExprBrIf, 0,
      kExprEnd,

      // Return last push result.
      kExprLocalGet, 4,
    ]);

  return builder;
}

function runBenchmark(name, fn, warmupIterations = 10) {
  // Warmup.
  for (let i = 0; i < warmupIterations; i++) {
    fn();
  }

  // Measure.
  const start = Date.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = Date.now();
  return end - start;
}

print("=".repeat(60));
print("JS Array Builtins Benchmark");
print("=".repeat(60));
print(`Iterations: ${iterations}`);
print(`Elements per array: ${elementsPerArray}`);
print(`Access count: ${accessCount}`);
print("");
print("NOTE: All operations have TurboShaft optimizations.");
print("      Speedup > 1.0x means builtins are faster than JS imports.");
print("");

// Build both versions.
const builtinBuilder = buildModule(true);
const jsBuilder = buildModule(false);

const builtinInstance = builtinBuilder.instantiate({}, { builtins: ["js-array"] });
const jsInstance = jsBuilder.instantiate(jsImports);

const testElement = "test-element";

// Benchmark 1: Full benchmark (new + push + at).
print("-".repeat(60));
print("Benchmark 1: Full workflow (new + push + at)");
print("-".repeat(60));

const builtinFullTime = runBenchmark("builtin-full", () => {
  builtinInstance.exports.benchmark(testElement, elementsPerArray, accessCount);
});

const jsFullTime = runBenchmark("js-full", () => {
  jsInstance.exports.benchmark(testElement, elementsPerArray, accessCount);
});

print(`  Builtins:   ${builtinFullTime} ms`);
print(`  JS imports: ${jsFullTime} ms`);
print(`  Speedup:    ${(jsFullTime / builtinFullTime).toFixed(2)}x`);
print("");

// Benchmark 2: Push only.
print("-".repeat(60));
print("Benchmark 2: Push only (new + push)");
print("-".repeat(60));

const builtinPushTime = runBenchmark("builtin-push", () => {
  builtinInstance.exports.push_only(testElement, elementsPerArray);
});

const jsPushTime = runBenchmark("js-push", () => {
  jsInstance.exports.push_only(testElement, elementsPerArray);
});

print(`  Builtins:   ${builtinPushTime} ms`);
print(`  JS imports: ${jsPushTime} ms`);
print(`  Speedup:    ${(jsPushTime / builtinPushTime).toFixed(2)}x`);
print("");

// Benchmark 3: At only.
print("-".repeat(60));
print("Benchmark 3: At only (accessing pre-existing array)");
print("-".repeat(60));

// Create a pre-populated array for the at-only benchmark.
const prePopulatedArray = Array.from({length: elementsPerArray}, (_, i) => `elem-${i}`);

const builtinAtTime = runBenchmark("builtin-at", () => {
  builtinInstance.exports.at_only(prePopulatedArray, accessCount);
});

const jsAtTime = runBenchmark("js-at", () => {
  jsInstance.exports.at_only(prePopulatedArray, accessCount);
});

print(`  Builtins:   ${builtinAtTime} ms`);
print(`  JS imports: ${jsAtTime} ms`);
print(`  Speedup:    ${(jsAtTime / builtinAtTime).toFixed(2)}x`);
print("");

// Benchmark 4: Test only (type checking).
print("-".repeat(60));
print("Benchmark 4: Test only (type checking) - OPTIMIZED");
print("-".repeat(60));

function buildTestOnlyModule(useBuiltins) {
  let builder = new WasmModuleBuilder();
  const moduleName = useBuiltins ? 'wasm:js-array' : 'js-array';
  let kArrayTest = builder.addImport(moduleName, 'test', kSig_i_r);

  builder.addFunction("test_loop",
      makeSig([kWasmExternRef, kWasmI32], [kWasmI32]))
    .exportFunc()
    .addLocals(kWasmI32, 2)  // counter, accumulator
    .addBody([
      kExprLoop, kWasmVoid,
        kExprLocalGet, 0,
        kExprCallFunction, kArrayTest,
        kExprLocalGet, 3,
        kExprI32Add,
        kExprLocalSet, 3,
        kExprLocalGet, 2,
        kExprI32Const, 1,
        kExprI32Add,
        kExprLocalTee, 2,
        kExprLocalGet, 1,
        kExprI32LtU,
        kExprBrIf, 0,
      kExprEnd,
      kExprLocalGet, 3,
    ]);

  return builder;
}

const builtinTestBuilder = buildTestOnlyModule(true);
const jsTestBuilder = buildTestOnlyModule(false);
const builtinTestInstance = builtinTestBuilder.instantiate({}, { builtins: ["js-array"] });
const jsTestInstance = jsTestBuilder.instantiate(jsImports);

const builtinTestTime = runBenchmark("builtin-test", () => {
  builtinTestInstance.exports.test_loop(prePopulatedArray, accessCount * 10);
});

const jsTestTime = runBenchmark("js-test", () => {
  jsTestInstance.exports.test_loop(prePopulatedArray, accessCount * 10);
});

print(`  Builtins:   ${builtinTestTime} ms`);
print(`  JS imports: ${jsTestTime} ms`);
print(`  Speedup:    ${(jsTestTime / builtinTestTime).toFixed(2)}x`);
print("");

// Benchmark 5: Length only.
print("-".repeat(60));
print("Benchmark 5: Length only - OPTIMIZED");
print("-".repeat(60));

function buildLengthOnlyModule(useBuiltins) {
  let builder = new WasmModuleBuilder();
  const moduleName = useBuiltins ? 'wasm:js-array' : 'js-array';
  let kArrayLength = builder.addImport(moduleName, 'length', kSig_i_r);

  builder.addFunction("length_loop",
      makeSig([kWasmExternRef, kWasmI32], [kWasmI32]))
    .exportFunc()
    .addLocals(kWasmI32, 2)  // counter, accumulator
    .addBody([
      kExprLoop, kWasmVoid,
        kExprLocalGet, 0,
        kExprCallFunction, kArrayLength,
        kExprLocalGet, 3,
        kExprI32Add,
        kExprLocalSet, 3,
        kExprLocalGet, 2,
        kExprI32Const, 1,
        kExprI32Add,
        kExprLocalTee, 2,
        kExprLocalGet, 1,
        kExprI32LtU,
        kExprBrIf, 0,
      kExprEnd,
      kExprLocalGet, 3,
    ]);

  return builder;
}

const builtinLengthBuilder = buildLengthOnlyModule(true);
const jsLengthBuilder = buildLengthOnlyModule(false);
const builtinLengthInstance = builtinLengthBuilder.instantiate({}, { builtins: ["js-array"] });
const jsLengthInstance = jsLengthBuilder.instantiate(jsImports);

const builtinLengthTime = runBenchmark("builtin-length", () => {
  builtinLengthInstance.exports.length_loop(prePopulatedArray, accessCount * 10);
});

const jsLengthTime = runBenchmark("js-length", () => {
  jsLengthInstance.exports.length_loop(prePopulatedArray, accessCount * 10);
});

print(`  Builtins:   ${builtinLengthTime} ms`);
print(`  JS imports: ${jsLengthTime} ms`);
print(`  Speedup:    ${(jsLengthTime / builtinLengthTime).toFixed(2)}x`);
print("");

// Benchmark 6: New only (array allocation).
print("-".repeat(60));
print("Benchmark 6: New only (array allocation)");
print("-".repeat(60));

const builtinNewTime = runBenchmark("builtin-new", () => {
  builtinInstance.exports.new_only(elementsPerArray);
});

const jsNewTime = runBenchmark("js-new", () => {
  jsInstance.exports.new_only(elementsPerArray);
});

print(`  Builtins:   ${builtinNewTime} ms`);
print(`  JS imports: ${jsNewTime} ms`);
print(`  Speedup:    ${(jsNewTime / builtinNewTime).toFixed(2)}x`);
print("");

// Benchmark 7: New + single push.
print("-".repeat(60));
print("Benchmark 7: New + single push");
print("-".repeat(60));

const builtinNewPushOneTime = runBenchmark("builtin-new-push-one", () => {
  builtinInstance.exports.new_push_one(testElement, elementsPerArray);
});

const jsNewPushOneTime = runBenchmark("js-new-push-one", () => {
  jsInstance.exports.new_push_one(testElement, elementsPerArray);
});

print(`  Builtins:   ${builtinNewPushOneTime} ms`);
print(`  JS imports: ${jsNewPushOneTime} ms`);
print(`  Speedup:    ${(jsNewPushOneTime / builtinNewPushOneTime).toFixed(2)}x`);
print("");

// Summary.
print("=".repeat(60));
print("Summary");
print("=".repeat(60));
const totalBuiltin = builtinFullTime + builtinPushTime + builtinAtTime + builtinNewTime + builtinNewPushOneTime;
const totalJs = jsFullTime + jsPushTime + jsAtTime + jsNewTime + jsNewPushOneTime;
print(`  Total (all ops):   builtins=${totalBuiltin}ms, JS=${totalJs}ms, speedup=${(totalJs / totalBuiltin).toFixed(2)}x`);
print(`  New only:          builtins=${builtinNewTime}ms, JS=${jsNewTime}ms, speedup=${(jsNewTime / builtinNewTime).toFixed(2)}x`);
print(`  New + push one:    builtins=${builtinNewPushOneTime}ms, JS=${jsNewPushOneTime}ms, speedup=${(jsNewPushOneTime / builtinNewPushOneTime).toFixed(2)}x`);
print(`  Test (optimized):  builtins=${builtinTestTime}ms, JS=${jsTestTime}ms, speedup=${(jsTestTime / builtinTestTime).toFixed(2)}x`);
print(`  Length (optimized): builtins=${builtinLengthTime}ms, JS=${jsLengthTime}ms, speedup=${(jsLengthTime / builtinLengthTime).toFixed(2)}x`);
