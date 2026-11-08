// src·scripts·tests의 모든 JavaScript 파일을 node --check로 문법 검사한다.
import {readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = ['src', 'scripts', 'tests'].flatMap(dir =>
  readdirSync(join(root, dir))
    .filter(name => /\.(m?js)$/.test(name))
    .map(name => join(dir, name)),
);
for (const file of files) execFileSync(process.execPath, ['--check', join(root, file)], {stdio: 'inherit'});
console.log(`문법 검사 통과 · ${files.length}개 파일`);
