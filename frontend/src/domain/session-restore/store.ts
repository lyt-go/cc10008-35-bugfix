import type { FixPropagation, RestorePlan } from './types'

/**
 * 还原存储端口：领域服务不直接依赖 localStorage，测试可替换为内存实现。
 * 每个作用域（scopeKey，通常对应一组相邻会话）只保留一份修复恢复结果。
 */
export interface RestoreStore {
  loadPlan(scopeKey: string): RestorePlan | null
  savePlan(plan: RestorePlan): void
  loadPropagation(scopeKey: string): FixPropagation | null
  savePropagation(propagation: FixPropagation): void
  /** 会话记录还原来源的当前版本号，重复修复时用来单调递增。 */
  nextSourceVersion(scopeKey: string): number
  /** 清掉还原/提交结果与传播数据，但保留版本计数（用于重新修复）。 */
  clearPlanAndPropagation(scopeKey: string): void
  /** 连版本计数一起清空（用于整体重置）。 */
  removeScope(scopeKey: string): void
}
