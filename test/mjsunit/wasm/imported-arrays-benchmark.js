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

// Create a pre-populated array for at/test/length benchmarks.
const prePopulatedArray = Array.from({length: elementsPerArray}, (_, i) => `elem-${i}`);

// Build test-only and length-only modules.
function buildTestOnlyModule(useBuiltins) {
  let builder = new WasmModuleBuilder();
  const moduleName = useBuiltins ? 'wasm:js-array' : 'js-array';
  let kArrayTest = builder.addImport(moduleName, 'test', kSig_i_r);

  builder.addFunction("test_loop",
      makeSig([kWasmExternRef, kWasmI32], [kWasmI32]))
    .exportFunc()
    .addLocals(kWasmI32, 2)
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

function buildLengthOnlyModule(useBuiltins) {
  let builder = new WasmModuleBuilder();
  const moduleName = useBuiltins ? 'wasm:js-array' : 'js-array';
  let kArrayLength = builder.addImport(moduleName, 'length', kSig_i_r);

  builder.addFunction("length_loop",
      makeSig([kWasmExternRef, kWasmI32], [kWasmI32]))
    .exportFunc()
    .addLocals(kWasmI32, 2)
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

const builtinTestInstance = buildTestOnlyModule(true).instantiate({}, { builtins: ["js-array"] });
const jsTestInstance = buildTestOnlyModule(false).instantiate(jsImports);
const builtinLengthInstance = buildLengthOnlyModule(true).instantiate({}, { builtins: ["js-array"] });
const jsLengthInstance = buildLengthOnlyModule(false).instantiate(jsImports);

// Run all benchmarks.
const results = [];

results.push({
  name: "new (array allocation)",
  builtin: runBenchmark("builtin-new", () => {
    builtinInstance.exports.new_only(elementsPerArray);
  }),
  js: runBenchmark("js-new", () => {
    jsInstance.exports.new_only(elementsPerArray);
  })
});

results.push({
  name: "new + push (1 element)",
  builtin: runBenchmark("builtin-new-push-one", () => {
    builtinInstance.exports.new_push_one(testElement, elementsPerArray);
  }),
  js: runBenchmark("js-new-push-one", () => {
    jsInstance.exports.new_push_one(testElement, elementsPerArray);
  })
});

results.push({
  name: "new + push (100 elements)",
  builtin: runBenchmark("builtin-push", () => {
    builtinInstance.exports.push_only(testElement, elementsPerArray);
  }),
  js: runBenchmark("js-push", () => {
    jsInstance.exports.push_only(testElement, elementsPerArray);
  })
});

results.push({
  name: "new + push + at",
  builtin: runBenchmark("builtin-full", () => {
    builtinInstance.exports.benchmark(testElement, elementsPerArray, accessCount);
  }),
  js: runBenchmark("js-full", () => {
    jsInstance.exports.benchmark(testElement, elementsPerArray, accessCount);
  })
});

results.push({
  name: "at (element access)",
  builtin: runBenchmark("builtin-at", () => {
    builtinInstance.exports.at_only(prePopulatedArray, accessCount);
  }),
  js: runBenchmark("js-at", () => {
    jsInstance.exports.at_only(prePopulatedArray, accessCount);
  })
});

results.push({
  name: "test (type checking)",
  builtin: runBenchmark("builtin-test", () => {
    builtinTestInstance.exports.test_loop(prePopulatedArray, accessCount * 10);
  }),
  js: runBenchmark("js-test", () => {
    jsTestInstance.exports.test_loop(prePopulatedArray, accessCount * 10);
  })
});

results.push({
  name: "length",
  builtin: runBenchmark("builtin-length", () => {
    builtinLengthInstance.exports.length_loop(prePopulatedArray, accessCount * 10);
  }),
  js: runBenchmark("js-length", () => {
    jsLengthInstance.exports.length_loop(prePopulatedArray, accessCount * 10);
  })
});

// Print results table.
print("=".repeat(70));
print("Results");
print("=".repeat(70));

// Find max name length for alignment.
const maxNameLen = Math.max(...results.map(r => r.name.length));

// Header.
print(`${"Benchmark".padEnd(maxNameLen)}  Builtins  JS Imports  Speedup`);
print("-".repeat(70));

// Results.
for (const r of results) {
  const speedup = (r.js / r.builtin).toFixed(2);
  print(`${r.name.padEnd(maxNameLen)}  ${String(r.builtin).padStart(6)}ms  ${String(r.js).padStart(8)}ms  ${speedup.padStart(6)}x`);
}

print("-".repeat(70));

// Total.
const totalBuiltin = results.reduce((sum, r) => sum + r.builtin, 0);
const totalJs = results.reduce((sum, r) => sum + r.js, 0);
const totalSpeedup = (totalJs / totalBuiltin).toFixed(2);
print(`${"TOTAL".padEnd(maxNameLen)}  ${String(totalBuiltin).padStart(6)}ms  ${String(totalJs).padStart(8)}ms  ${totalSpeedup.padStart(6)}x`);
