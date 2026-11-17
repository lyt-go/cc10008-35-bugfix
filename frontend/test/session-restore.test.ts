import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  MemoryRestoreStore,
  SessionRestoreService,
  arbitrateBoundary,
  buildScenarioRequest,
  legacyBuggyRestore,
  SCOPE_KEY,
  TRACE_EVENTS,
  SESSION_WINDOWS,
} from '@/domain/session-restore'

function freshService() {
  return new SessionRestoreService(new MemoryRestoreStore())
}

function chainOf(arbitrationOrPlan, sessionId) {
  const arbitration = arbitrationOrPlan.arbitration ?? arbitrationOrPlan
  return arbitration.chains.find((chain) => chain.sessionId === sessionId)
}

describe('SESS-0003 复现：旧实现把后一会话事件拼进前一链路', () => {
  it('legacyBuggyRestore 确实产生跨会话串链（E7 被错挂进 SESS-0003）', () => {
    const legacy = legacyBuggyRestore()
    assert.deepEqual(legacy['SESS-0003'], ['E1', 'E2', 'E3', 'E4', 'E7'])
    assert.deepEqual(legacy['SESS-0004'], ['E5', 'E6', 'E8'])
  })
})

describe('会话边界仲裁：任一事件只进入一个完整会话链', () => {
  for (const strategy of ['startTime', 'pathId']) {
    it(`[${strategy}] 全量事件有且仅有一次归属，相邻会话不共享事件节点`, () => {
      const arbitration = arbitrateBoundary(
        strategy,
        SCOPE_KEY,
        `req-${strategy}`,
        TRACE_EVENTS,
        SESSION_WINDOWS,
      )
      const all = arbitration.chains.flatMap((chain) => chain.eventIds)
      assert.equal(all.length, TRACE_EVENTS.length)
      assert.equal(new Set(all).size, TRACE_EVENTS.length)
      assert.deepEqual([...all].sort(), TRACE_EVENTS.map((e) => e.eventId).sort())

      const [a, b] = arbitration.chains
      const shared = a.eventIds.filter((id) => b.eventIds.includes(id))
      assert.equal(shared.length, 0)
      assert.ok(a.boundaryComplete && b.boundaryComplete)
    })
  }

  it('[startTime] 同刻的归档回执归前序会话、开始事件归后序会话，E7 被隔离回 SESS-0004', () => {
    const arbitration = arbitrateBoundary('startTime', SCOPE_KEY, 'req', TRACE_EVENTS, SESSION_WINDOWS)
    assert.deepEqual(chainOf(arbitration, 'SESS-0003').eventIds, ['E1', 'E2', 'E3', 'E4'])
    assert.deepEqual(chainOf(arbitration, 'SESS-0004').eventIds, ['E5', 'E6', 'E7', 'E8'])

    const sheet = arbitration.isolationSheets.find((item) => item.eventId === 'E7')
    assert.ok(sheet)
    assert.equal(sheet.assignedSessionId, 'SESS-0004')
    assert.equal(sheet.rejectedSessionId, 'SESS-0003')
  })

  it('[startTime] 完成率回到正确业务版本：错挂事件不再稀释前序会话的完成率', () => {
    const arbitration = arbitrateBoundary('startTime', SCOPE_KEY, 'req', TRACE_EVENTS, SESSION_WINDOWS)
    const chain3 = chainOf(arbitration, 'SESS-0003')
    const chain4 = chainOf(arbitration, 'SESS-0004')
    // 旧实现下 SESS-0003 的链被塞入 E7，完成率按错误分母被稀释到 0.8；
    // 仲裁后 E7 隔离回 SESS-0004，两条边界完整的链完成率均回到 1。
    assert.equal(chain3.chainLength, 4)
    assert.equal(chain3.completionRate, 1)
    assert.equal(chain4.chainLength, 4)
    assert.equal(chain4.completionRate, 1)
  })

  it('[pathId] 按关键路径拆分得到不同的链，但同样不共享事件', () => {
    const arbitration = arbitrateBoundary('pathId', SCOPE_KEY, 'req', TRACE_EVENTS, SESSION_WINDOWS)
    assert.deepEqual(chainOf(arbitration, 'SESS-0003').eventIds, ['E1', 'E2', 'E3', 'E4'])
    assert.deepEqual(chainOf(arbitration, 'SESS-0004').eventIds, ['E5', 'E6', 'E7', 'E8'])
    const ids = arbitration.chains.flatMap((chain) => chain.eventIds)
    assert.equal(new Set(ids).size, ids.length)
  })

  it('非法输入：重复会话窗口与未知 claimedSessionId 直接拒绝', () => {
    assert.throws(() =>
      arbitrateBoundary('startTime', SCOPE_KEY, 'req', TRACE_EVENTS, [
        ...SESSION_WINDOWS,
        { ...SESSION_WINDOWS[0] },
      ]),
    )
    assert.throws(() =>
      arbitrateBoundary(
        'startTime',
        SCOPE_KEY,
        'req',
        TRACE_EVENTS.map((e, i) => (i === 0 ? { ...e, claimedSessionId: 'SESS-9999' } : e)),
        SESSION_WINDOWS,
      ),
    )
  })
})

describe('并发还原：只确认一份边界完整链路，另一请求被拒绝且不能覆盖', () => {
  let service
  beforeEach(() => {
    service = freshService()
  })

  it('两个并发请求同时还原相邻会话，只有一个成功，另一个收到拒绝凭据', async () => {
    const [first, second] = await Promise.all([
      service.restore(buildScenarioRequest('req-A', 'startTime')),
      service.restore(buildScenarioRequest('req-B', 'startTime')),
    ])

    const accepted = [first, second].filter((outcome) => outcome.ok)
    const rejected = [first, second].filter((outcome) => !outcome.ok)
    assert.equal(accepted.length, 1)
    assert.equal(rejected.length, 1)
    assert.equal(rejected[0].code, 'RESTORE_IN_PROGRESS')
    assert.equal(rejected[0].ownerRequestId, accepted[0].plan.ownerRequestId)

    const stored = service.getPlan(SCOPE_KEY)
    assert.equal(stored.ownerRequestId, accepted[0].plan.ownerRequestId)
  })

  it('被拒绝的请求事后重试仍不能覆盖已确认的前一链路', async () => {
    const first = await service.restore(buildScenarioRequest('req-A', 'startTime'))
    assert.equal(first.ok, true)
    const retry = await service.restore(buildScenarioRequest('req-B', 'startTime'))
    assert.equal(retry.ok, false)
    assert.equal(retry.code, 'RESTORE_ALREADY_CONFIRMED')
    assert.equal(service.getPlan(SCOPE_KEY).ownerRequestId, 'req-A')
  })

  it('同一请求幂等重试返回同一份链路，不产生第二份结果', async () => {
    const first = await service.restore(buildScenarioRequest('req-A', 'startTime'))
    const replay = await service.restore(buildScenarioRequest('req-A', 'startTime'))
    assert.equal(replay.ok, true)
    assert.equal(replay.replayed, true)
    assert.equal(replay.plan.ownerRequestId, first.plan.ownerRequestId)
  })
})

describe('并发提交：只保留一个修复恢复结果，另一请求收到拒绝凭据', () => {
  let service
  beforeEach(() => {
    service = freshService()
  })

  it('属主并发提交只有一份成功，重复提交被拒绝', async () => {
    const restored = await service.restore(buildScenarioRequest('req-A', 'startTime'))
    assert.equal(restored.ok, true)

    const [c1, c2] = await Promise.all([
      service.commit(SCOPE_KEY, 'req-A'),
      service.commit(SCOPE_KEY, 'req-A'),
    ])
    const accepted = [c1, c2].filter((outcome) => outcome.ok)
    const rejected = [c1, c2].filter((outcome) => !outcome.ok)
    assert.equal(accepted.length, 1)
    assert.equal(rejected.length, 1)
    // 并发当刻被提交锁拦截；事后再重试则命中「已提交」拒绝。
    assert.ok(['COMMIT_IN_PROGRESS', 'PLAN_ALREADY_COMMITTED'].includes(rejected[0].code))

    const retry = await service.commit(SCOPE_KEY, 'req-A')
    assert.equal(retry.ok, true)
    assert.equal(retry.replayed, true)

    const foreignRetry = await service.commit(SCOPE_KEY, 'req-B')
    assert.equal(foreignRetry.ok, false)
    assert.equal(foreignRetry.code, 'PLAN_ALREADY_COMMITTED')
  })

  it('非属主请求提交被拒绝，不能覆盖属主的修复恢复结果', async () => {
    await service.restore(buildScenarioRequest('req-A', 'startTime'))
    const denied = await service.commit(SCOPE_KEY, 'req-B')
    assert.equal(denied.ok, false)
    assert.equal(denied.code, 'REQUEST_NOT_OWNER')
    assert.equal(service.getPlan(SCOPE_KEY).committed, false)

    const ownerCommit = await service.commit(SCOPE_KEY, 'req-A')
    assert.equal(ownerCommit.ok, true)
  })

  it('提交不存在的作用域返回 PLAN_NOT_FOUND 拒绝凭据', async () => {
    const outcome = await service.commit('missing-scope', 'req-X')
    assert.equal(outcome.ok, false)
    assert.equal(outcome.code, 'PLAN_NOT_FOUND')
  })
})

describe('修复传播：事件溯源复核清单 + 跨模块还原来源 + 隔离单', () => {
  let service
  beforeEach(() => {
    service = freshService()
  })

  it('提交后完整会话事件链进入事件溯源复核清单，完成率为正确业务版本', async () => {
    await service.restore(buildScenarioRequest('req-A', 'startTime'))
    await service.commit(SCOPE_KEY, 'req-A')
    const propagation = service.getPropagation(SCOPE_KEY)

    assert.equal(propagation.reviewEntries.length, 2)
    const review3 = propagation.reviewEntries.find((entry) => entry.chainSessionId === 'SESS-0003')
    assert.deepEqual(review3.eventIds, ['E1', 'E2', 'E3', 'E4'])
    assert.equal(review3.status, '待复核')
    assert.equal(review3.completionRate, 1)
    assert.equal(review3.sourceRequestId, 'req-A')
  })

  it('会话记录保留还原来源，重复修复版本递增且不显示旧值', async () => {
    await service.restore(buildScenarioRequest('req-A', 'startTime'))
    await service.commit(SCOPE_KEY, 'req-A')
    const first = service.getPropagation(SCOPE_KEY)
    assert.equal(first.sessionSources[0].version, 1)

    service.reopenForRepair(SCOPE_KEY)
    await service.restore(buildScenarioRequest('req-A2', 'pathId'))
    await service.commit(SCOPE_KEY, 'req-A2')
    const second = service.getPropagation(SCOPE_KEY)
    const source3 = second.sessionSources.find((item) => item.sessionId === 'SESS-0003')
    assert.equal(source3.version, 2)
    assert.equal(source3.sourceRequestId, 'req-A2')
    // 读取到的永远是最新版本，旧值不再出现
    assert.ok(!second.sessionSources.some((item) => item.sourceRequestId === 'req-A'))
  })

  it('异常退出面板的相邻事件隔离单只记录唯一归属，E7 拒绝 SESS-0003', async () => {
    await service.restore(buildScenarioRequest('req-A', 'startTime'))
    await service.commit(SCOPE_KEY, 'req-A')
    const { isolationEntries } = service.getPropagation(SCOPE_KEY)

    const e7 = isolationEntries.find((entry) => entry.eventId === 'E7')
    assert.ok(e7)
    assert.equal(e7.assignedSessionId, 'SESS-0004')
    assert.equal(e7.rejectedSessionId, 'SESS-0003')
  })
})

describe('三面板一致性：会话详情、事件溯源、异常退出不共享事件节点', () => {
  it('同一份提交结果在三个模块看到的事件归属完全一致且互斥', async () => {
    const service = freshService()
    await service.restore(buildScenarioRequest('req-A', 'startTime'))
    await service.commit(SCOPE_KEY, 'req-A')
    const plan = service.getPlan(SCOPE_KEY)
    const propagation = service.getPropagation(SCOPE_KEY)

    const sessionEvents = propagation.sessionSources.flatMap((source) => source.eventIds)
    const reviewEvents = propagation.reviewEntries.flatMap((entry) => entry.eventIds)
    const chainEvents = plan.arbitration.chains.flatMap((chain) => chain.eventIds)
    assert.deepEqual([...sessionEvents].sort(), [...reviewEvents].sort())
    assert.deepEqual([...reviewEvents].sort(), [...chainEvents].sort())
    assert.equal(new Set(chainEvents).size, TRACE_EVENTS.length)

    // 隔离单中的事件都能在唯一归属链上找到，且被拒绝的链上确实没有它
    for (const sheet of propagation.isolationEntries) {
      const ownerChain = chainOf(plan, sheet.assignedSessionId)
      const rejectedChain = chainOf(plan, sheet.rejectedSessionId)
      assert.ok(ownerChain.eventIds.includes(sheet.eventId))
      assert.ok(!rejectedChain.eventIds.includes(sheet.eventId))
    }
  })
})
