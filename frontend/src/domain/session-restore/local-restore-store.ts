import type { FixPropagation, RestorePlan } from './types'
import type { RestoreStore } from './store'

/**
 * 基于 localStorage 的还原存储适配器，与业务清单的
 * 「behavior-event-trace-hub:entries」相互独立，互不污染。
 */
const STORAGE_KEY = 'behavior-event-trace-hub:session-restore'

interface PersistedShape {
  plans: Record<string, RestorePlan>
  propagations: Record<string, FixPropagation>
  versions: Record<string, number>
}

function emptyPersisted(): PersistedShape {
  return { plans: {}, propagations: {}, versions: {} }
}

function readPersisted(): PersistedShape {
  if (typeof window === 'undefined' || !window.localStorage) {
    return emptyPersisted()
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return emptyPersisted()
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedShape>
    return {
      plans: parsed.plans ?? {},
      propagations: parsed.propagations ?? {},
      versions: parsed.versions ?? {},
    }
  } catch {
    return emptyPersisted()
  }
}

function writePersisted(data: PersistedShape): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function restoreStorageKey(): string {
  return STORAGE_KEY
}

export class LocalStorageRestoreStore implements RestoreStore {
  loadPlan(scopeKey: string): RestorePlan | null {
    return readPersisted().plans[scopeKey] ?? null
  }

  savePlan(plan: RestorePlan): void {
    const data = readPersisted()
    data.plans[plan.scopeKey] = plan
    writePersisted(data)
  }

  loadPropagation(scopeKey: string): FixPropagation | null {
    return readPersisted().propagations[scopeKey] ?? null
  }

  savePropagation(propagation: FixPropagation): void {
    const data = readPersisted()
    data.propagations[propagation.scopeKey] = propagation
    writePersisted(data)
  }

  nextSourceVersion(scopeKey: string): number {
    const data = readPersisted()
    const next = (data.versions[scopeKey] ?? 0) + 1
    data.versions[scopeKey] = next
    writePersisted(data)
    return next
  }

  clearPlanAndPropagation(scopeKey: string): void {
    const data = readPersisted()
    delete data.plans[scopeKey]
    delete data.propagations[scopeKey]
    writePersisted(data)
  }

  removeScope(scopeKey: string): void {
    const data = readPersisted()
    delete data.plans[scopeKey]
    delete data.propagations[scopeKey]
    delete data.versions[scopeKey]
    writePersisted(data)
  }
}

/** 测试与非浏览器环境使用的内存实现。 */
export class MemoryRestoreStore implements RestoreStore {
  private plans = new Map<string, RestorePlan>()
  private propagations = new Map<string, FixPropagation>()
  private versions = new Map<string, number>()

  loadPlan(scopeKey: string): RestorePlan | null {
    return this.plans.get(scopeKey) ?? null
  }

  savePlan(plan: RestorePlan): void {
    this.plans.set(plan.scopeKey, plan)
  }

  loadPropagation(scopeKey: string): FixPropagation | null {
    return this.propagations.get(scopeKey) ?? null
  }

  savePropagation(propagation: FixPropagation): void {
    this.propagations.set(propagation.scopeKey, propagation)
  }

  nextSourceVersion(scopeKey: string): number {
    const next = (this.versions.get(scopeKey) ?? 0) + 1
    this.versions.set(scopeKey, next)
    return next
  }

  clearPlanAndPropagation(scopeKey: string): void {
    this.plans.delete(scopeKey)
    this.propagations.delete(scopeKey)
  }

  removeScope(scopeKey: string): void {
    this.plans.delete(scopeKey)
    this.propagations.delete(scopeKey)
    this.versions.delete(scopeKey)
  }
}
