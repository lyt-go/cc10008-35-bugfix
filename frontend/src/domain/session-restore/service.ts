/**
 * SESS-0003 修复恢复服务。
 *
 * 并发语义（方法为异步，获取作用域锁后显式让出事件循环，从而真实复现并发交错）：
 *  - 并发还原相邻会话时，只确认一份边界完整的链路；另一请求被拒绝且不能覆盖前一链路；
 *  - 并发提交修复时，只保留一个修复恢复的完整会话事件链数据结果，另一请求收到拒绝凭据；
 *  - 同一请求的重试按 requestId 幂等返回，不会产生第二份结果。
 */
import { arbitrateBoundary } from './boundary'
import { buildPropagation } from './propagation'
import { LocalStorageRestoreStore } from './local-restore-store'
import type { RestoreStore } from './store'
import type {
  CommitOutcome,
  RejectionCredential,
  RestoreOutcome,
  RestorePlan,
  RestoreRequest,
} from './types'

/** 让出事件循环一次，让并发请求在锁持有期间进入。 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function reject(
  code: RejectionCredential['code'],
  request: Pick<RestoreRequest, 'scopeKey' | 'requestId'>,
  ownerRequestId: string,
  message: string,
): RejectionCredential {
  return {
    ok: false,
    code,
    scopeKey: request.scopeKey,
    requestId: request.requestId,
    ownerRequestId,
    message,
  }
}

export class SessionRestoreService {
  /** 还原进行中的作用域锁：值为持有锁的 requestId。 */
  private restoreLocks = new Map<string, string>()
  /** 提交进行中的作用域锁。 */
  private commitLocks = new Map<string, string>()

  constructor(private readonly store: RestoreStore = new LocalStorageRestoreStore()) {}

  /**
   * 并发还原：同一作用域同时只允许一个请求执行仲裁。
   * 后到的请求收到拒绝凭据，不能覆盖先确认的链路；同 requestId 重试走幂等回放。
   */
  async restore(request: RestoreRequest): Promise<RestoreOutcome> {
    const existing = this.store.loadPlan(request.scopeKey)
    if (existing) {
      if (existing.ownerRequestId === request.requestId) {
        return { ok: true, plan: existing, replayed: true }
      }
      return reject(
        'RESTORE_ALREADY_CONFIRMED',
        request,
        existing.ownerRequestId,
        `作用域 ${request.scopeKey} 已确认请求 ${existing.ownerRequestId} 的边界完整链路，请求 ${request.requestId} 被拒绝，不得覆盖`,
      )
    }

    const lockOwner = this.restoreLocks.get(request.scopeKey)
    if (lockOwner) {
      return reject(
        'RESTORE_IN_PROGRESS',
        request,
        lockOwner,
        `作用域 ${request.scopeKey} 正在被请求 ${lockOwner} 并发还原，请求 ${request.requestId} 被拒绝`,
      )
    }

    this.restoreLocks.set(request.scopeKey, request.requestId)
    try {
      // 持锁期间让出事件循环，并发请求此刻只能拿到拒绝凭据。
      await yieldToEventLoop()

      const arbitration = arbitrateBoundary(
        request.strategy,
        request.scopeKey,
        request.requestId,
        request.events,
        request.windows,
      )
      const plan: RestorePlan = {
        scopeKey: request.scopeKey,
        ownerRequestId: request.requestId,
        strategy: request.strategy,
        arbitration,
        createdAt: Date.now(),
        committed: false,
      }
      this.store.savePlan(plan)
      return { ok: true, plan, replayed: false }
    } finally {
      if (this.restoreLocks.get(request.scopeKey) === request.requestId) {
        this.restoreLocks.delete(request.scopeKey)
      }
    }
  }

  /**
   * 并发提交：同一作用域只保留一个修复恢复结果。
   * 非属主请求、重复提交与并发提交都会拿到拒绝凭据，已确认/已提交的链路不被覆盖。
   */
  async commit(scopeKey: string, requestId: string): Promise<CommitOutcome> {
    const plan = this.store.loadPlan(scopeKey)
    if (!plan) {
      return reject(
        'PLAN_NOT_FOUND',
        { scopeKey, requestId },
        requestId,
        `作用域 ${scopeKey} 还没有可提交的还原结果`,
      )
    }
    // 已提交的结果只保留一份：任何后续提交（含非属主）都先命中「已提交」拒绝，
    // 同请求的事后重试则幂等回放。
    if (plan.committed) {
      if (plan.committedByRequestId === requestId) {
        return { ok: true, plan, replayed: true }
      }
      return reject(
        'PLAN_ALREADY_COMMITTED',
        { scopeKey, requestId },
        plan.committedByRequestId ?? plan.ownerRequestId,
        `作用域 ${scopeKey} 的修复恢复结果已由请求 ${plan.committedByRequestId} 提交，只保留一份，请求 ${requestId} 被拒绝`,
      )
    }
    if (plan.ownerRequestId !== requestId) {
      return reject(
        'REQUEST_NOT_OWNER',
        { scopeKey, requestId },
        plan.ownerRequestId,
        `请求 ${requestId} 不是作用域 ${scopeKey} 边界链路的确认方，无权提交`,
      )
    }

    // 抢作用域提交锁：并发提交时只有一个请求能进入临界区，其余请求收到拒绝凭据。
    const lockOwner = this.commitLocks.get(scopeKey)
    if (lockOwner) {
      return reject(
        'COMMIT_IN_PROGRESS',
        { scopeKey, requestId },
        lockOwner,
        `作用域 ${scopeKey} 正在被请求 ${lockOwner} 并发提交，请求 ${requestId} 被拒绝`,
      )
    }

    this.commitLocks.set(scopeKey, requestId)
    try {
      await yieldToEventLoop()

      const version = this.store.nextSourceVersion(scopeKey)
      const committedAt = Date.now()
      const committedPlan: RestorePlan = {
        ...plan,
        committed: true,
        committedAt,
        committedByRequestId: requestId,
      }
      this.store.savePlan(committedPlan)
      // 修复沿完整会话事件链传播到事件溯源复核清单、会话记录与异常退出面板。
      this.store.savePropagation(buildPropagation(committedPlan, version))
      return { ok: true, plan: committedPlan, replayed: false }
    } finally {
      if (this.commitLocks.get(scopeKey) === requestId) {
        this.commitLocks.delete(scopeKey)
      }
    }
  }

  getPlan(scopeKey: string): RestorePlan | null {
    return this.store.loadPlan(scopeKey)
  }

  getPropagation(scopeKey: string) {
    return this.store.loadPropagation(scopeKey)
  }

  /**
   * 重新修复：清掉作用域内旧的还原/提交结果，允许新一轮还原，但保留版本计数，
   * 使下一次提交的会话还原来源版本号单调递增，旧值被覆盖而不再显示。
   */
  reopenForRepair(scopeKey: string): void {
    this.restoreLocks.delete(scopeKey)
    this.commitLocks.delete(scopeKey)
    this.store.clearPlanAndPropagation(scopeKey)
  }

  /** 仅供测试或「重置还原数据」使用：连版本计数一起清掉某个作用域。 */
  reset(scopeKey: string): void {
    this.restoreLocks.delete(scopeKey)
    this.commitLocks.delete(scopeKey)
    this.store.removeScope(scopeKey)
  }
}

/** 页面与本地数据服务共用的单例。 */
export const sessionRestoreService = new SessionRestoreService()
