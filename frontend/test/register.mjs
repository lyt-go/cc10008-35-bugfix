// 通过 --import 提前注册 TS 加载器；node:test 派生子进程时会继承该注册。
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
register(pathToFileURL(resolve(here, 'ts-loader.mjs')))
