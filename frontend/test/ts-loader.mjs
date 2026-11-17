// 测试用 ESM 加载器：用 esbuild 把 TS 即时转译为 ESM，并解析「@/」路径别名。
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { transform } from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolvePath(here, '..', 'src')

function tryCandidates(candidates, context, nextResolve) {
  return (async () => {
    for (const candidate of candidates) {
      try {
        return await nextResolve(pathToFileURL(candidate).href, context)
      } catch {
        // 尝试下一个候选
      }
    }
    return null
  })()
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const rest = specifier.slice(2)
    const hit = await tryCandidates(
      [
        resolvePath(srcRoot, rest) + '.ts',
        resolvePath(srcRoot, rest, 'index.ts'),
      ],
      context,
      nextResolve,
    )
    if (hit) {
      return hit
    }
  }
  // 支持 TS 源码里无扩展名的相对导入（如 ./types、./store），并把目录索引的
  // 多种写法规范化到同一个文件 URL，避免同一模块被实例化两次。
  if (specifier.startsWith('.') && context.parentURL) {
    const base = new URL(specifier, context.parentURL)
    const basePath = fileURLToPath(base)
    const hit = await tryCandidates(
      [basePath + '.ts', resolvePath(basePath, 'index.ts')],
      context,
      nextResolve,
    )
    if (hit) {
      return hit
    }
  }
  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const { source } = await nextLoad(url, { ...context, format: 'module' })
    const code = typeof source === 'string' ? source : Buffer.from(source).toString('utf8')
    const result = await transform(code, {
      loader: 'ts',
      format: 'esm',
      target: 'es2022',
      sourcemap: 'inline',
    })
    return { format: 'module', shortCircuit: true, source: result.code }
  }
  return nextLoad(url, context)
}
