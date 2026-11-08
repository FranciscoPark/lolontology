import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {buildHtml, parseImports, resolveModules, stripModuleSyntax} from '../scripts/build.mjs';

test('bundle includes every module reachable from app.js in dependency order', async () => {
  const modules = await resolveModules();
  const names = modules.map(module => module.file);
  assert.equal(names.at(-1), 'app.js');
  for (const required of ['graph.js', 'opgg-build.js', 'engine.js', 'ontology.js', 'catalog.js', 'opgg-ui.js'])
    assert.ok(names.includes(required), `${required} missing from bundle`);
  for (const {file, source} of modules) {
    for (const {file: dependency} of parseImports(source))
      assert.ok(names.indexOf(dependency) < names.indexOf(file), `${dependency} must precede ${file}`);
  }
});

const escaped = name => name.replace(/[$^.*+?()[\]{}|\\]/g, '\\$&');
test('every imported name is declared in the standalone script', async () => {
  const modules = await resolveModules();
  const {script} = await buildHtml();
  for (const {source} of modules) {
    for (const {file, specifiers} of parseImports(source)) {
      for (const name of specifiers)
        assert.match(
          script,
          new RegExp(`(?:function|const|let|class)\\s+${escaped(name)}(?![\\w$])|,\\s*${escaped(name)}\\s*=`),
          `${name} from ${file} is not declared`,
        );
    }
  }
});

test('standalone script parses and has no duplicate top-level function names', async () => {
  const {script, html} = await buildHtml();
  assert.doesNotThrow(() => new vm.Script(`(()=>{'use strict';\n${script}\n})`));
  assert.doesNotMatch(html, /type="module"|\/src\/app\.js|\/src\/style\.css/);
  const functions = [...script.matchAll(/^(?:async\s+)?function\s+(\w+)/gm)].map(match => match[1]);
  assert.deepEqual(
    functions.filter((name, index) => functions.indexOf(name) !== index),
    [],
  );
});

test('multi-line imports are stripped and unsupported import forms are rejected', () => {
  const source = "import {\n  a,\n  b,\n} from './x.js';\nexport const c = a + b;\n";
  assert.deepEqual(parseImports(source), [{file: 'x.js', specifiers: ['a', 'b']}]);
  assert.equal(stripModuleSyntax(source), 'const c = a + b;\n');
  assert.throws(() => parseImports("import * as x from './x.js';"));
  assert.throws(() => parseImports("import {a as b} from './x.js';"));
});
