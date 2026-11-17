/**
 * SESS-0003 修复传播。
 *
 * 修复会沿「修复恢复的完整会话事件链数据结果」把完整会话事件链送入事件溯源复核清单，
 * 并在会话记录、异常退出面板上跨模块保留会话链路还原来源；新版本覆盖旧值，
 * 会话链路还原不再显示旧值。
 */
import type {
  AnomalyIsolationEntry,
  EventTraceReviewEntry,
  FixPropagation,
  RestorePlan,
  SessionRestoreSource,
} from './types'

/** 为传播条目生成稳定且不与业务表自增 id 冲突的标识。 */
export function deriveEntryId(prefix: string, scopeKey: string, discriminator: string): string {
  return `${prefix}-${scopeKey}-${discriminator}`
}

/**
 * 依据已提交的修复恢复结果构建跨模块传播数据。
 * @param version 会话记录还原来源的版本号，重复修复时单调递增，用于覆盖旧值。
 */
export function buildPropagation(plan: RestorePlan, version: number): FixPropagation {
  const committedAt = plan.committedAt ?? plan.createdAt
  const { scopeKey, ownerRequestId, strategy, arbitration } = plan

  const reviewEntries: EventTraceReviewEntry[] = arbitration.chains.map((chain) => ({
    entryId: deriveEntryId('ETR', scopeKey, chain.sessionId),
    scopeKey,
    chainSessionId: chain.sessionId,
    eventIds: [...chain.eventIds],
    chainLength: chain.chainLength,
    completionRate: chain.completionRate,
    sourceRequestId: ownerRequestId,
    strategy,
    status: '待复核',
    propagatedAt: committedAt,
  }))

  const sessionSources: SessionRestoreSource[] = arbitration.chains.map((chain) => ({
    scopeKey,
    sessionId: chain.sessionId,
    sourceRequestId: ownerRequestId,
    strategy,
    eventIds: [...chain.eventIds],
    chainLength: chain.chainLength,
    completionRate: chain.completionRate,
    restoredAt: plan.createdAt,
    committedAt,
    version,
  }))

  const isolationEntries: AnomalyIsolationEntry[] = arbitration.isolationSheets.map((sheet) => ({
    entryId: deriveEntryId('AIS', scopeKey, sheet.eventId),
    scopeKey,
    eventId: sheet.eventId,
    assignedSessionId: sheet.assignedSessionId,
    rejectedSessionId: sheet.rejectedSessionId,
    reason: sheet.reason,
    strategy,
    propagatedAt: committedAt,
  }))

  return {
    scopeKey,
    reviewEntries,
    sessionSources,
    isolationEntries,
  }
}
