/**
 * SESS-0003 会话边界仲裁与修复恢复领域类型。
 *
 * 背景：前一会话（如 SESS-0003）的归档回执与后一会话的开始事件在还原时同时进入，
 * 旧实现按时间窗口粗暴切片，会把后一会话的事件拼进前一条链路，导致链路完成率等
 * 数据错位。这里把「边界仲裁 → 完整会话事件链 → 修复提交 → 跨模块传播」显式建模。
 */

/** 边界仲裁策略：两种做法都必须保证任一事件只进入一个完整会话链。 */
export type BoundaryStrategy = 'startTime' | 'pathId'

export type EventKind = 'normal' | 'archiveReceipt' | 'sessionStart'

/** 参与还原的原始事件，可能来自相邻两个会话。 */
export interface TraceEvent {
  eventId: string
  /** 事件发生时间（毫秒时间戳）。 */
  timestamp: number
  /** 事件被采集时错误归属的会话，还原前可能存在跨会话串链。 */
  claimedSessionId: string
  /** 关键路径标识：pathId 仲裁策略按它拆分会话链。 */
  pathId: string
  kind: EventKind
}

/** 会话边界窗口：开始时间与（可选的）归档时间。 */
export interface SessionWindow {
  sessionId: string
  /** 会话开始事件时间，startTime 仲裁策略按它拆分会话链。 */
  startedAt: number
  /** 前一会话的归档回执时间；为空表示会话尚未归档。 */
  archivedAt?: number
  /** 该会话自身的关键路径标识。 */
  pathId: string
}

export interface RestoreRequest {
  scopeKey: string
  requestId: string
  sessionId: string
  strategy: BoundaryStrategy
  events: TraceEvent[]
  windows: SessionWindow[]
}

/** 仲裁后一条边界完整的会话事件链。 */
export interface SessionChain {
  sessionId: string
  /** 还原来源：说明链上事件由哪个请求、用什么策略仲裁而来。 */
  restoredFrom: {
    scopeKey: string
    requestId: string
    strategy: BoundaryStrategy
  }
  /** 按时间升序排列的完整会话事件链。 */
  eventIds: string[]
  /** 链长度（事件个数）。 */
  chainLength: number
  /** 完成率：边界内期望事件中实际归位的比例，结果须回到正确业务版本。 */
  completionRate: number
  /** 边界是否完整（具备开始事件，且相邻会话之间不存在共享事件）。 */
  boundaryComplete: boolean
}

/** 相邻事件隔离单：记录边界冲突事件的唯一归属，证明它没有同时进入两条链。 */
export interface IsolationSheet {
  eventId: string
  timestamp: number
  kind: EventKind
  claimedSessionId: string
  assignedSessionId: string
  /** 未获得该事件的相邻会话。 */
  rejectedSessionId: string
  reason: string
  strategy: BoundaryStrategy
}

export interface BoundaryArbitration {
  strategy: BoundaryStrategy
  chains: SessionChain[]
  isolationSheets: IsolationSheet[]
}

/** 修复恢复的完整会话事件链数据结果（一次还原只确认一份）。 */
export interface RestorePlan {
  scopeKey: string
  /** 获得确认的那一份边界完整链路对应的请求。 */
  ownerRequestId: string
  strategy: BoundaryStrategy
  arbitration: BoundaryArbitration
  createdAt: number
  committed: boolean
  committedAt?: number
  committedByRequestId?: string
}

/** 拒绝凭据：并发下未获确认的请求收到它，且不能覆盖已确认的链路。 */
export interface RejectionCredential {
  ok: false
  code:
    | 'RESTORE_IN_PROGRESS'
    | 'RESTORE_ALREADY_CONFIRMED'
    | 'COMMIT_IN_PROGRESS'
    | 'PLAN_ALREADY_COMMITTED'
    | 'PLAN_NOT_FOUND'
    | 'REQUEST_NOT_OWNER'
  scopeKey: string
  requestId: string
  /** 已占用该作用域的请求，用于排查谁先到。 */
  ownerRequestId: string
  message: string
}

export interface RestoreAccepted {
  ok: true
  plan: RestorePlan
  /** 同一请求的幂等重放：true 表示直接返回已确认的那份链路。 */
  replayed: boolean
}

export type RestoreOutcome = RestoreAccepted | RejectionCredential

export interface CommitAccepted {
  ok: true
  plan: RestorePlan
  replayed: boolean
}

export type CommitOutcome = CommitAccepted | RejectionCredential

/** 修复传播：完整会话事件链送入事件溯源复核清单的条目。 */
export interface EventTraceReviewEntry {
  entryId: string
  scopeKey: string
  chainSessionId: string
  eventIds: string[]
  chainLength: number
  completionRate: number
  sourceRequestId: string
  strategy: BoundaryStrategy
  status: '待复核'
  propagatedAt: number
}

/** 修复传播：会话记录上保留的还原来源（跨模块可追溯，且不再显示旧值）。 */
export interface SessionRestoreSource {
  scopeKey: string
  sessionId: string
  sourceRequestId: string
  strategy: BoundaryStrategy
  eventIds: string[]
  chainLength: number
  completionRate: number
  restoredAt: number
  committedAt: number
  /** 单调递增的版本号，旧值被新版本覆盖。 */
  version: number
}

/** 修复传播：异常退出面板上的相邻事件隔离单视图。 */
export interface AnomalyIsolationEntry {
  entryId: string
  scopeKey: string
  eventId: string
  assignedSessionId: string
  rejectedSessionId: string
  reason: string
  strategy: BoundaryStrategy
  propagatedAt: number
}

export interface FixPropagation {
  scopeKey: string
  reviewEntries: EventTraceReviewEntry[]
  sessionSources: SessionRestoreSource[]
  isolationEntries: AnomalyIsolationEntry[]
}
