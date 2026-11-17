#!/usr/bin/env bash
# 测试入口：注册 TS 加载器后交给 node:test 运行 test/ 下的用例。
set -euo pipefail
cd "$(dirname "$0")/.."
node --import ./test/register.mjs --test test/*.test.ts
