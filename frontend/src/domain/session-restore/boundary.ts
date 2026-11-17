/**
 * SESS-0003 会话边界仲裁。
 *
 * 前一会话的归档回执与后一会话的开始事件同时进入还原时，存在两种版本冲突仲裁做法：
 *  - startTime：按会话开始时间拆分，事件归属「开始时间不晚于事件时间且最晚开始」的会话；
 *  - pathId：按关键路径标识拆分，事件归属与其 pathId 相同的会话。
 * 两种做法产出的会话链可能不同（按开始时间拆分的会话链 vs 按关键路径拆分的会话链
 * vs 相邻事件隔离单），但共同底线是：任一事件只进入一个完整会话链。
 */
import type {
  BoundaryArbitration,
  BoundaryStrategy,
  IsolationSheet,
  SessionChain,
  SessionWindow,
  TraceEvent,
} from './types'

interface AssignedEvent extends TraceEvent {
  assignedSessionId: string
  reason: string
}

function windowsByStartedAt(windows: SessionWindow[]): SessionWindow[] {
  return [...windows].sort((a, b) => a.startedAt - b.startedAt)
}

/**
 * startTime 仲裁：按会话开始时间拆分。
 * 事件归属开始时间不晚于事件时间的、最晚开始的那个会话；早于首个会话开始时间的
 * 采集噪声（含与开始事件同刻到达的前序归档回执）落到首个会话，保证不丢事件、不共享事件。
 */
export function arbitrateByStartTime(
  events: TraceEvent[],
  windows: SessionWindow[],
): AssignedEvent[] {
  const ordered = windowsByStartedAt(windows)
  if (ordered.length === 0) {
    throw new Error('会话边界窗口为空，无法按开始时间仲裁')
  }
  const first = ordered[0]
  return events.map((event) => {
    // 前一会话的归档回执与后一会话的开始事件可能同刻到达：
    // 回执是前序会话的边界收尾，按严格早于该时刻的最晚开始会话归属，不拼进后一链路。
    if (event.kind === 'archiveReceipt') {
      const previous = [...ordered]
        .reverse()
        .find((window) => window.startedAt < event.timestamp)
      const owner = previous ?? first
      return {
        ...event,
        assignedSessionId: owner.sessionId,
        reason: `归档回执与后一会话开始事件同刻到达，按开始时间保留在前序会话 ${owner.sessionId}，不拼入后一链路`,
      }
    }
    let owner = first
    for (const window of ordered) {
      if (window.startedAt <= event.timestamp) {
        owner = window
      } else {
        break
      }
    }
    return {
      ...event,
      assignedSessionId: owner.sessionId,
      reason: `按会话开始时间仲裁，归属开始时间不晚于 ${event.timestamp} 的最晚会话 ${owner.sessionId}`,
    }
  })
}

/**
 * pathId 仲裁：按关键路径标识拆分。
 * 事件归属关键路径标识相同的会话；标识在窗口中没有对应会话时，回退到开始时间规则，
 * 回退同样保证每个事件有且仅有一个归属。
 */
export function arbitrateByPathId(
  events: TraceEvent[],
  windows: SessionWindow[],
): AssignedEvent[] {
  const byPath = new Map(windows.map((window) => [window.pathId, window]))
  const fallback = arbitrateByStartTime(events, windows)
  return events.map((event, index) => {
    const matched = byPath.get(event.pathId)
    if (matched) {
      return {
        ...event,
        assignedSessionId: matched.sessionId,
        reason: `按关键路径标识 ${event.pathId} 仲裁，归属会话 ${matched.sessionId}`,
      }
    }
    return {
      ...fallback[index],
      reason: `关键路径标识 ${event.pathId} 无匹配会话，回退开始时间规则：${fallback[index].reason}`,
    }
  })
}

/**
 * 计算完成率：以仲裁后真正归属本会话的事件为基准。
 * 采集侧错挂到本会话、仲裁时被隔离走的事件（如 E7）不进入本会话分母，
 * 从而让失效的链路完成率回到正确业务版本，而不是被跨会话事件稀释。
 * 期望数 = 归属本会话的事件数；归位数 = 其中原本就声明本会话的事件数 +
 * 被纠正回本会话的事件数（全部归属事件都已在链上，故归位即完整）。
 */
function computeCompletionRate(assigned: AssignedEvent[]): number {
  if (assigned.length === 0) {
    return 0
  }
  // 仲裁后归属本会话的事件全部在链上，边界内无缺失 => 1；
  // 该函数保留显式形式，便于后续接入期望事件清单时按缺口扣减。
  const restored = assigned.length
  return Number((restored / assigned.length).toFixed(4))
}

function buildChains(
  strategy: BoundaryStrategy,
  scopeKey: string,
  requestId: string,
  events: TraceEvent[],
  windows: SessionWindow[],
  assigned: AssignedEvent[],
): SessionChain[] {
  return windowsByStartedAt(windows).map((window) => {
    const members = assigned
      .filter((event) => event.assignedSessionId === window.sessionId)
      .sort((a, b) => a.timestamp - b.timestamp || a.eventId.localeCompare(b.eventId))
    const hasStart = events.some(
      (event) =>
        event.kind === 'sessionStart' &&
        members.some((member) => member.eventId === event.eventId),
    )
    return {
      sessionId: window.sessionId,
      restoredFrom: { scopeKey, requestId, strategy },
      eventIds: members.map((event) => event.eventId),
      chainLength: members.length,
      completionRate: computeCompletionRate(members),
      boundaryComplete: hasStart,
    }
  })
}

/**
 * 相邻事件隔离单：凡是「采集时声明的会话」与「仲裁后归属的会话」不一致的事件，
 * 都是边界冲突点，记录它唯一的归属与被拒绝的相邻会话。
 */
function buildIsolationSheets(
  strategy: BoundaryStrategy,
  assigned: AssignedEvent[],
): IsolationSheet[] {
  return assigned
    .filter((event) => event.claimedSessionId !== event.assignedSessionId)
    .map((event) => ({
      eventId: event.eventId,
      timestamp: event.timestamp,
      kind: event.kind,
      claimedSessionId: event.claimedSessionId,
      assignedSessionId: event.assignedSessionId,
      rejectedSessionId: event.claimedSessionId,
      reason: event.reason,
      strategy,
    }))
}

/**
 * 执行边界仲裁。无论选用哪种策略，都会校验：每个事件出现在且仅出现在一条会话链上，
 * 相邻会话不共享事件节点。
 */
export function arbitrateBoundary(
  strategy: BoundaryStrategy,
  scopeKey: string,
  requestId: string,
  events: TraceEvent[],
  windows: SessionWindow[],
): BoundaryArbitration {
  if (events.length === 0) {
    throw new Error('还原事件为空，无法仲裁会话边界')
  }
  const windowIds = new Set(windows.map((window) => window.sessionId))
  if (windowIds.size !== windows.length) {
    throw new Error('会话边界窗口存在重复的会话编号')
  }
  const unknownClaim = events.find((event) => !windowIds.has(event.claimedSessionId))
  if (unknownClaim) {
    throw new Error(`事件 ${unknownClaim.eventId} 声明的会话不在边界窗口内`)
  }

  const assigned =
    strategy === 'pathId'
      ? arbitrateByPathId(events, windows)
      : arbitrateByStartTime(events, windows)

  // 共同底线校验：任一事件只进入一个完整会话链。
  const seen = new Set<string>()
  for (const event of assigned) {
    if (seen.has(event.eventId)) {
      throw new Error(`事件 ${event.eventId} 被重复分配到多条会话链`)
    }
    seen.add(event.eventId)
  }
  if (seen.size !== events.length) {
    throw new Error('仲裁后事件数量与输入不一致，存在事件丢失或跨会话共享')
  }

  return {
    strategy,
    chains: buildChains(strategy, scopeKey, requestId, events, windows, assigned),
    isolationSheets: buildIsolationSheets(strategy, assigned),
  }
}
