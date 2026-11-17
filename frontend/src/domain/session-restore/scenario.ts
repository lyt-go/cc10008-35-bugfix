/**
 * SESS-0003 复现场景：SESS-0003 后一会话（SESS-0004）的事件被错误拼进前一链路。
 *
 * 关键构造：SESS-0003 的归档回执 E4 与 SESS-0004 的开始事件 E5 在同一时刻进入还原；
 * 采集侧还把 E7 错挂在 SESS-0003 名下（跨会话串链）。修复前的旧切片会把 E5/E7 拼进
 * SESS-0003，导致其链路完成率虚高错位；修复后两种仲裁策略都保证任一事件只进入一条链。
 */
import type { RestoreRequest, SessionWindow, TraceEvent } from './types'

export const SCOPE_KEY = 'SESS-0003-boundary'

export const SESSION_WINDOWS: SessionWindow[] = [
  {
    sessionId: 'SESS-0003',
    startedAt: 1_000,
    archivedAt: 4_000,
    pathId: 'PATH-A',
  },
  {
    sessionId: 'SESS-0004',
    startedAt: 4_000,
    pathId: 'PATH-B',
  },
]

export const TRACE_EVENTS: TraceEvent[] = [
  { eventId: 'E1', timestamp: 1_000, claimedSessionId: 'SESS-0003', pathId: 'PATH-A', kind: 'sessionStart' },
  { eventId: 'E2', timestamp: 2_000, claimedSessionId: 'SESS-0003', pathId: 'PATH-A', kind: 'normal' },
  { eventId: 'E3', timestamp: 3_000, claimedSessionId: 'SESS-0003', pathId: 'PATH-A', kind: 'normal' },
  // 归档回执与后一会话开始事件同刻到达（4000）。
  { eventId: 'E4', timestamp: 4_000, claimedSessionId: 'SESS-0003', pathId: 'PATH-A', kind: 'archiveReceipt' },
  { eventId: 'E5', timestamp: 4_000, claimedSessionId: 'SESS-0004', pathId: 'PATH-B', kind: 'sessionStart' },
  { eventId: 'E6', timestamp: 5_000, claimedSessionId: 'SESS-0004', pathId: 'PATH-B', kind: 'normal' },
  // 采集侧串链：E7 属于 SESS-0004，却被错挂到 SESS-0003。
  { eventId: 'E7', timestamp: 6_000, claimedSessionId: 'SESS-0003', pathId: 'PATH-B', kind: 'normal' },
  { eventId: 'E8', timestamp: 7_000, claimedSessionId: 'SESS-0004', pathId: 'PATH-B', kind: 'normal' },
]

/** 修复前的错误还原：按时间窗口粗暴切片并直接信任 claimedSessionId，把后一会话事件拼进前链。 */
export function legacyBuggyRestore(): Record<string, string[]> {
  const chains: Record<string, string[]> = { 'SESS-0003': [], 'SESS-0004': [] }
  for (const event of TRACE_EVENTS) {
    chains[event.claimedSessionId].push(event.eventId)
  }
  return chains
}

export function buildScenarioRequest(
  requestId: string,
  strategy: RestoreRequest['strategy'],
): RestoreRequest {
  return {
    scopeKey: SCOPE_KEY,
    requestId,
    // 场景里每个请求都针对自己关心的相邻会话发起，作用域相同即视为并发竞争。
    sessionId: 'SESS-0003',
    strategy,
    events: TRACE_EVENTS.map((event) => ({ ...event })),
    windows: SESSION_WINDOWS.map((window) => ({ ...window })),
  }
}
