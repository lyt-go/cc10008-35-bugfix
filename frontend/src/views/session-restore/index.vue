<template>
  <section class="page" data-module="session-restore">
    <header class="page-head">
      <div>
        <h2>会话边界修复与还原传播</h2>
        <p class="page-desc">
          SESS-0003 相邻会话边界仲裁：并发还原只确认一份边界完整链路，并发提交只保留一个修复恢复结果，
          完整会话事件链沿结果传播到事件溯源复核清单、会话记录与异常退出面板。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="resetScope">重置本作用域</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">作用域</span>
        <strong class="stat-value">{{ scopeKey }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已确认链路请求</span>
        <strong class="stat-value">{{ plan?.ownerRequestId ?? '—' }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">修复提交状态</span>
        <strong class="stat-value">{{ plan?.committed ? `已提交（${plan.committedByRequestId}）` : '未提交' }}</strong>
      </article>
    </div>

    <div class="filter-bar" style="flex-wrap: wrap; gap: 12px">
      <label class="filter-item">
        <span>仲裁策略</span>
        <select v-model="strategy">
          <option value="startTime">按会话开始时间拆分</option>
          <option value="pathId">按关键路径标识拆分</option>
        </select>
      </label>
      <button class="btn primary" type="button" @click="runConcurrentRestore">并发还原相邻会话（两个请求）</button>
      <button class="btn primary" type="button" @click="runConcurrentCommit">并发提交修复（两个请求）</button>
      <button class="btn" type="button" @click="runReopen">重新修复（版本递增）</button>
    </div>

    <p v-if="message" class="status-legend" style="margin-top: 12px">
      <span class="legend-item" :class="messageKind">{{ message }}</span>
    </p>

    <h3 style="margin: 20px 0 8px">一、复现：修复前的错误切片（后一会话事件被拼进前一链路）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>会话</th>
          <th>错误链上的事件</th>
          <th>问题</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(ids, sessionId) in legacyChains" :key="sessionId">
          <td>{{ sessionId }}</td>
          <td>{{ ids.join(' → ') }}</td>
          <td>{{ legacyIssues[sessionId] }}</td>
        </tr>
      </tbody>
    </table>

    <template v-if="plan">
      <h3 style="margin: 20px 0 8px">二、会话详情：仲裁后的完整会话事件链（相邻会话不共享事件节点）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>会话编号</th>
            <th>完整会话事件链</th>
            <th>链长度</th>
            <th>完成率</th>
            <th>边界完整</th>
            <th>还原来源</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="chain in plan.arbitration.chains" :key="chain.sessionId">
            <td>{{ chain.sessionId }}</td>
            <td>{{ chain.eventIds.join(' → ') }}</td>
            <td>{{ chain.chainLength }}</td>
            <td>{{ chain.completionRate }}</td>
            <td>{{ chain.boundaryComplete ? '是' : '否' }}</td>
            <td>{{ chain.restoredFrom.requestId }} / {{ chain.restoredFrom.strategy }}</td>
          </tr>
        </tbody>
      </table>

      <h3 style="margin: 20px 0 8px">三、事件溯源复核清单（修复沿完整会话事件链传播）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>复核条目</th>
            <th>链路会话</th>
            <th>事件链</th>
            <th>完成率</th>
            <th>来源请求</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="entry in propagation?.reviewEntries ?? []" :key="entry.entryId">
            <td>{{ entry.entryId }}</td>
            <td>{{ entry.chainSessionId }}</td>
            <td>{{ entry.eventIds.join(' → ') }}</td>
            <td>{{ entry.completionRate }}</td>
            <td>{{ entry.sourceRequestId }}</td>
            <td>{{ entry.status }}</td>
          </tr>
          <tr v-if="!propagation">
            <td colspan="6" class="empty-state">尚未提交修复，提交后完整会话事件链才会进入复核清单</td>
          </tr>
        </tbody>
      </table>

      <h3 style="margin: 20px 0 8px">四、异常退出面板：相邻事件隔离单（任一事件只进入一条链）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>事件</th>
            <th>类型</th>
            <th>唯一归属会话</th>
            <th>被拒绝的相邻会话</th>
            <th>仲裁说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="sheet in plan.arbitration.isolationSheets" :key="sheet.eventId">
            <td>{{ sheet.eventId }}</td>
            <td>{{ kindLabel(sheet.kind) }}</td>
            <td>{{ sheet.assignedSessionId }}</td>
            <td>{{ sheet.rejectedSessionId }}</td>
            <td>{{ sheet.reason }}</td>
          </tr>
          <tr v-if="!plan.arbitration.isolationSheets.length">
            <td colspan="5" class="empty-state">当前策略下没有跨会话冲突事件</td>
          </tr>
        </tbody>
      </table>

      <h3 style="margin: 20px 0 8px">五、会话记录还原来源（跨模块保留，重复修复只显示最新版本）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>会话</th>
            <th>来源请求</th>
            <th>策略</th>
            <th>版本</th>
            <th>事件数</th>
            <th>完成率</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="source in propagation?.sessionSources ?? []" :key="source.sessionId">
            <td>{{ source.sessionId }}</td>
            <td>{{ source.sourceRequestId }}</td>
            <td>{{ source.strategy }}</td>
            <td>v{{ source.version }}</td>
            <td>{{ source.chainLength }}</td>
            <td>{{ source.completionRate }}</td>
          </tr>
          <tr v-if="!propagation">
            <td colspan="6" class="empty-state">提交后生成还原来源</td>
          </tr>
        </tbody>
      </table>
    </template>

    <footer class="page-foot">
      <span>并发拒绝凭据记录见下方操作日志</span>
    </footer>

    <h3 style="margin: 20px 0 8px">操作日志（含拒绝凭据）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>序号</th>
          <th>结果</th>
          <th>凭据编码 / 请求</th>
          <th>说明</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(log, index) in logs" :key="index">
          <td>{{ index + 1 }}</td>
          <td>{{ log.ok ? '确认/提交成功' : '拒绝' }}</td>
          <td>{{ log.code ?? `${log.requestId ?? ''}` }}</td>
          <td>{{ log.message }}</td>
        </tr>
        <tr v-if="!logs.length">
          <td colspan="4" class="empty-state">暂无操作记录</td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import {
  LocalStorageRestoreStore,
  SessionRestoreService,
  buildScenarioRequest,
  legacyBuggyRestore,
  SCOPE_KEY,
} from '@/domain/session-restore'
import type { BoundaryStrategy, CommitOutcome, RejectionCredential, RestoreOutcome } from '@/domain/session-restore'

// 页面使用独立存储实例，与业务清单互不污染。
const service = new SessionRestoreService(new LocalStorageRestoreStore())
const scopeKey = SCOPE_KEY

const strategy = ref<BoundaryStrategy>('startTime')
const plan = ref(service.getPlan(SCOPE_KEY))
const propagation = ref(service.getPropagation(SCOPE_KEY))
const message = ref('')
const messageKind = ref('')
const logs = ref<{ ok: boolean; code?: string; requestId?: string; message: string }[]>([])

const legacyChains = legacyBuggyRestore()
const legacyIssues: Record<string, string> = {
  'SESS-0003': '错误拼入 E7（实为后一会话事件），且归档回执 E4 与后序开始事件同刻到达',
  'SESS-0004': '缺失 E7，链路不完整，完成率随错误版本错位',
}

function refresh() {
  plan.value = service.getPlan(SCOPE_KEY)
  propagation.value = service.getPropagation(SCOPE_KEY)
}

function kindLabel(kind: string): string {
  if (kind === 'archiveReceipt') return '归档回执'
  if (kind === 'sessionStart') return '会话开始'
  return '普通事件'
}

function logOutcome(outcome: RestoreOutcome | CommitOutcome) {
  if (outcome.ok) {
    logs.value.push({
      ok: true,
      requestId: outcome.plan.ownerRequestId,
      message: `边界完整链路已确认/提交，请求 ${outcome.plan.ownerRequestId}`,
    })
    return
  }
  const rejection: RejectionCredential = outcome
  logs.value.push({
    ok: false,
    code: rejection.code,
    requestId: rejection.requestId,
    message: rejection.message,
  })
}

async function runConcurrentRestore() {
  const outcomes = await Promise.all([
    service.restore(buildScenarioRequest('req-restore-A', strategy.value)),
    service.restore(buildScenarioRequest('req-restore-B', strategy.value)),
  ])
  outcomes.forEach(logOutcome)
  const accepted = outcomes.filter((outcome) => outcome.ok).length
  const rejected = outcomes.length - accepted
  message.value = `并发还原结束：确认 ${accepted} 份边界完整链路，拒绝 ${rejected} 个请求（被拒绝方不得覆盖前一链路）`
  messageKind.value = rejected > 0 ? 'legend-item' : 'legend-item'
  refresh()
}

async function runConcurrentCommit() {
  if (!plan.value) {
    message.value = '请先并发还原，确认一份边界完整链路后再提交'
    return
  }
  const owner = plan.value.ownerRequestId
  const outcomes = await Promise.all([
    service.commit(SCOPE_KEY, owner),
    service.commit(SCOPE_KEY, owner),
  ])
  outcomes.forEach(logOutcome)
  const accepted = outcomes.filter((outcome) => outcome.ok).length
  message.value = `并发提交结束：只保留 ${accepted} 个修复恢复结果，另一请求收到拒绝凭据`
  refresh()
}

async function runReopen() {
  service.reopenForRepair(SCOPE_KEY)
  const outcome = await service.restore(buildScenarioRequest('req-repair', strategy.value))
  logOutcome(outcome)
  if (outcome.ok) {
    const committed = await service.commit(SCOPE_KEY, 'req-repair')
    logOutcome(committed)
  }
  message.value = '重新修复完成：会话还原来源版本号递增，旧值已被覆盖不再显示'
  refresh()
}

function resetScope() {
  service.reset(SCOPE_KEY)
  logs.value = []
  message.value = '作用域已重置，可重新复现并发还原与提交'
  refresh()
}

onMounted(refresh)
</script>
