// Copyright 2024 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Flags: --allow-natives-syntax

d8.file.execute("test/mjsunit/mjsunit.js");
d8.file.execute("test/mjsunit/wasm/wasm-module-builder.js");

let kRefExtern = wasmRefType(kWasmExternRef);

// Signatures for js-array builtins.
// kSig_r_v = () -> externref  -- already defined in wasm-module-builder.js
// kSig_i_r = (externref) -> i32  -- already defined in wasm-module-builder.js
let kSig_r_ri = makeSig([kWasmExternRef, kWasmI32], [kWasmExternRef]);  // (externref, i32) -> externref
let kSig_i_rr = makeSig([kWasmExternRef, kWasmExternRef], [kWasmI32]);  // (externref, externref) -> i32

let kArrayNew;
let kArrayTest;
let kArrayLength;
let kArrayAt;
let kArrayPush;

function MakeBuilder() {
  let builder = new WasmModuleBuilder();

  kArrayNew = builder.addImport('wasm:js-array', 'new', kSig_r_v);
  kArrayTest = builder.addImport('wasm:js-array', 'test', kSig_i_r);
  kArrayLength = builder.addImport('wasm:js-array', 'length', kSig_i_r);
  kArrayAt = builder.addImport('wasm:js-array', 'at', kSig_r_ri);
  kArrayPush = builder.addImport('wasm:js-array', 'push', kSig_i_rr);

  return builder;
}

let kBuiltins = { builtins: ["js-array"] };

(function TestArrayNew() {
  print(arguments.callee.name);
  let builder = MakeBuilder();

  builder.addFunction("new_array", kSig_r_v)
    .exportFunc()
    .addBody([
      kExprCallFunction, kArrayNew,
    ]);

  let instance = builder.instantiate({}, kBuiltins);

  let arr = instance.exports.new_array();
  assertTrue(Array.isArray(arr));
  assertEquals(0, arr.length);

  // Each call creates a new array.
  let arr2 = instance.exports.new_array();
  assertTrue(Array.isArray(arr2));
  assertNotSame(arr, arr2);
})();

(function TestArrayTest() {
  print(arguments.callee.name);
  let builder = MakeBuilder();

  builder.addFunction("test", kSig_i_r)
    .exportFunc()
    .addBody([
      kExprLocalGet, 0,
      kExprCallFunction, kArrayTest,
    ]);

  builder.addFunction("test_null", kSig_i_v)
    .exportFunc()
    .addBody([
      kExprRefNull, kExternRefCode,
      kExprCallFunction, kArrayTest,
    ]);

  let instance = builder.instantiate({}, kBuiltins);

  // Arrays should return 1.
  assertEquals(1, instance.exports.test([]));
  assertEquals(1, instance.exports.test([1, 2, 3]));
  assertEquals(1, instance.exports.test(new Array(10)));
  assertEquals(1, instance.exports.test(Array.from({length: 5})));

  // Non-arrays should return 0.
  assertEquals(0, instance.exports.test("string"));
  assertEquals(0, instance.exports.test(123));
  assertEquals(0, instance.exports.test(undefined));
  assertEquals(0, instance.exports.test(true));
  assertEquals(0, instance.exports.test(false));
  assertEquals(0, instance.exports.test(null));
  assertEquals(0, instance.exports.test({}));
  assertEquals(0, instance.exports.test({length: 3}));  // Array-like but not array.
  assertEquals(0, instance.exports.test(function() {}));
  assertEquals(0, instance.exports.test_null());
})();

(function TestArrayLength() {
  print(arguments.callee.name);
  let builder = MakeBuilder();

  builder.addFunction("length", kSig_i_r)
    .exportFunc()
    .addBody([
      kExprLocalGet, 0,
      kExprCallFunction, kArrayLength,
    ]);

  builder.addFunction("length_null", kSig_i_v)
    .exportFunc()
    .addBody([
      kExprRefNull, kExternRefCode,
      kExprCallFunction, kArrayLength,
    ]);

  let instance = builder.instantiate({}, kBuiltins);

  // Test various array lengths.
  assertEquals(0, instance.exports.length([]));
  assertEquals(1, instance.exports.length([42]));
  assertEquals(3, instance.exports.length([1, 2, 3]));
  assertEquals(10, instance.exports.length(new Array(10)));
  assertEquals(5, instance.exports.length([1, , 3, , 5]));  // Sparse array.

  // Non-arrays should trap.
  assertThrows(
      () => instance.exports.length("string"), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.length(123), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.length(null), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.length({}), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.length({length: 5}), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.length_null(), WebAssembly.RuntimeError,
      'illegal cast');
})();

(function TestArrayAt() {
  print(arguments.callee.name);
  let builder = MakeBuilder();

  builder.addFunction("at", kSig_r_ri)
    .exportFunc()
    .addBody([
      kExprLocalGet, 0,
      kExprLocalGet, 1,
      kExprCallFunction, kArrayAt,
    ]);

  builder.addFunction("at_null", makeSig([kWasmI32], [kWasmExternRef]))
    .exportFunc()
    .addBody([
      kExprRefNull, kExternRefCode,
      kExprLocalGet, 0,
      kExprCallFunction, kArrayAt,
    ]);

  let instance = builder.instantiate({}, kBuiltins);

  let arr = ['a', 'b', 'c', 'd', 'e'];

  // Positive indices.
  assertEquals('a', instance.exports.at(arr, 0));
  assertEquals('b', instance.exports.at(arr, 1));
  assertEquals('c', instance.exports.at(arr, 2));
  assertEquals('d', instance.exports.at(arr, 3));
  assertEquals('e', instance.exports.at(arr, 4));

  // Negative indices (like Array.prototype.at).
  assertEquals('e', instance.exports.at(arr, -1));
  assertEquals('d', instance.exports.at(arr, -2));
  assertEquals('c', instance.exports.at(arr, -3));
  assertEquals('b', instance.exports.at(arr, -4));
  assertEquals('a', instance.exports.at(arr, -5));

  // Out of bounds returns undefined.
  assertEquals(undefined, instance.exports.at(arr, 5));
  assertEquals(undefined, instance.exports.at(arr, 100));
  assertEquals(undefined, instance.exports.at(arr, -6));
  assertEquals(undefined, instance.exports.at(arr, -100));

  // Empty array.
  assertEquals(undefined, instance.exports.at([], 0));
  assertEquals(undefined, instance.exports.at([], -1));

  // Array with holes.
  let sparse = [1, , 3];
  assertEquals(1, instance.exports.at(sparse, 0));
  assertEquals(undefined, instance.exports.at(sparse, 1));  // Hole.
  assertEquals(3, instance.exports.at(sparse, 2));

  // Different element types.
  let mixed = [42, "hello", null, undefined, true, {x: 1}, [1, 2]];
  assertEquals(42, instance.exports.at(mixed, 0));
  assertEquals("hello", instance.exports.at(mixed, 1));
  assertEquals(null, instance.exports.at(mixed, 2));
  assertEquals(undefined, instance.exports.at(mixed, 3));
  assertEquals(true, instance.exports.at(mixed, 4));
  assertEquals(1, instance.exports.at(mixed, 5).x);
  assertEquals(2, instance.exports.at(mixed, 6).length);

  // Non-arrays should trap.
  assertThrows(
      () => instance.exports.at("string", 0), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.at(123, 0), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.at(null, 0), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.at({}, 0), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.at_null(0), WebAssembly.RuntimeError,
      'illegal cast');
})();

(function TestArrayPush() {
  print(arguments.callee.name);
  let builder = MakeBuilder();

  builder.addFunction("push", kSig_i_rr)
    .exportFunc()
    .addBody([
      kExprLocalGet, 0,
      kExprLocalGet, 1,
      kExprCallFunction, kArrayPush,
    ]);

  builder.addFunction("push_null_array", makeSig([kWasmExternRef], [kWasmI32]))
    .exportFunc()
    .addBody([
      kExprRefNull, kExternRefCode,
      kExprLocalGet, 0,
      kExprCallFunction, kArrayPush,
    ]);

  let instance = builder.instantiate({}, kBuiltins);

  // Basic push operations.
  let arr1 = [];
  assertEquals(1, instance.exports.push(arr1, 'a'));
  assertEquals(['a'], arr1);

  assertEquals(2, instance.exports.push(arr1, 'b'));
  assertEquals(['a', 'b'], arr1);

  assertEquals(3, instance.exports.push(arr1, 'c'));
  assertEquals(['a', 'b', 'c'], arr1);

  // Push different types.
  let arr2 = [];
  assertEquals(1, instance.exports.push(arr2, 42));
  assertEquals(2, instance.exports.push(arr2, "hello"));
  assertEquals(3, instance.exports.push(arr2, null));
  assertEquals(4, instance.exports.push(arr2, undefined));
  assertEquals(5, instance.exports.push(arr2, true));
  assertEquals([42, "hello", null, undefined, true], arr2);

  // Push objects.
  let arr3 = [];
  let obj = {x: 1};
  assertEquals(1, instance.exports.push(arr3, obj));
  assertSame(obj, arr3[0]);

  // Push to array with existing elements.
  let arr4 = [1, 2, 3];
  assertEquals(4, instance.exports.push(arr4, 4));
  assertEquals([1, 2, 3, 4], arr4);

  // Non-arrays should trap.
  assertThrows(
      () => instance.exports.push("string", 'x'), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.push(123, 'x'), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.push(null, 'x'), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.push({}, 'x'), WebAssembly.RuntimeError,
      'illegal cast');
  assertThrows(
      () => instance.exports.push_null_array('x'), WebAssembly.RuntimeError,
      'illegal cast');
})();

(function TestArrayIntegration() {
  // Test using multiple builtins together.
  print(arguments.callee.name);
  let builder = MakeBuilder();

  // Create array, push elements, check length.
  builder.addFunction("create_and_populate", kSig_i_r)
    .exportFunc()
    .addLocals(kWasmExternRef, 1)
    .addBody([
      // Create new array.
      kExprCallFunction, kArrayNew,
      kExprLocalSet, 1,

      // Push 3 elements.
      kExprLocalGet, 1,
      kExprLocalGet, 0,
      kExprCallFunction, kArrayPush,
      kExprDrop,

      kExprLocalGet, 1,
      kExprLocalGet, 0,
      kExprCallFunction, kArrayPush,
      kExprDrop,

      kExprLocalGet, 1,
      kExprLocalGet, 0,
      kExprCallFunction, kArrayPush,
      kExprDrop,

      // Return length.
      kExprLocalGet, 1,
      kExprCallFunction, kArrayLength,
    ]);

  // Create array, push, then get element.
  builder.addFunction("push_and_get", kSig_r_ri)
    .exportFunc()
    .addLocals(kWasmExternRef, 1)
    .addBody([
      // Create new array.
      kExprCallFunction, kArrayNew,
      kExprLocalSet, 2,

      // Push the element.
      kExprLocalGet, 2,
      kExprLocalGet, 0,
      kExprCallFunction, kArrayPush,
      kExprDrop,

      // Get element at index.
      kExprLocalGet, 2,
      kExprLocalGet, 1,
      kExprCallFunction, kArrayAt,
    ]);

  let instance = builder.instantiate({}, kBuiltins);

  // Test create_and_populate: push 3 elements.
  assertEquals(3, instance.exports.create_and_populate("hello"));

  // Test push_and_get: push element, retrieve at index 0.
  assertEquals("test", instance.exports.push_and_get("test", 0));
  assertEquals(undefined, instance.exports.push_and_get("test", 1));
  assertEquals("test", instance.exports.push_and_get("test", -1));
})();

(function TestArrayWithDifferentElementKinds() {
  // Test arrays with different element kinds (Smi, Double, Object).
  print(arguments.callee.name);
  let builder = MakeBuilder();

  builder.addFunction("push", kSig_i_rr)
    .exportFunc()
    .addBody([
      kExprLocalGet, 0,
      kExprLocalGet, 1,
      kExprCallFunction, kArrayPush,
    ]);

  builder.addFunction("at", kSig_r_ri)
    .exportFunc()
    .addBody([
      kExprLocalGet, 0,
      kExprLocalGet, 1,
      kExprCallFunction, kArrayAt,
    ]);

  builder.addFunction("length", kSig_i_r)
    .exportFunc()
    .addBody([
      kExprLocalGet, 0,
      kExprCallFunction, kArrayLength,
    ]);

  let instance = builder.instantiate({}, kBuiltins);

  // Smi elements.
  let smiArr = [1, 2, 3];
  assertEquals(4, instance.exports.push(smiArr, 4));
  assertEquals(4, instance.exports.at(smiArr, 3));

  // Double elements.
  let doubleArr = [1.1, 2.2, 3.3];
  assertEquals(4, instance.exports.push(doubleArr, 4.4));
  assertEquals(4.4, instance.exports.at(doubleArr, 3));

  // Object elements.
  let objArr = [{a: 1}, {b: 2}];
  let newObj = {c: 3};
  assertEquals(3, instance.exports.push(objArr, newObj));
  assertSame(newObj, instance.exports.at(objArr, 2));

  // Mixed elements (starts as Smi, transitions to Object).
  let mixedArr = [1, 2, 3];
  assertEquals(4, instance.exports.push(mixedArr, "string"));
  assertEquals("string", instance.exports.at(mixedArr, 3));
  assertEquals(4, instance.exports.length(mixedArr));
})();
