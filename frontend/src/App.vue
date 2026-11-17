<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">行为特征分析与事件溯源平台</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向用户行为打点采集、事件参数规范、会话重放、热力图分析、特征工程提取与行为标签体系管理的本地化数据分析应用平台。</span>
        <span class="head-user">当前值班：{{ store.operator }} · {{ store.shiftLabel }}</span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

const navItems = [{ label: "运营概览", path: "/" }, { label: "事件规范", path: "/eventspec" }, { label: "会话重放", path: "/session" }, { label: "会话修复", path: "/session-restore" }, { label: "热力分析", path: "/heatmap" }, { label: "特征工程", path: "/feature" }, { label: "行动标签", path: "/action" }, { label: "路径分析", path: "/pathmap" }, { label: "事件溯源", path: "/eventtrace" }, { label: "时段分析", path: "/timewindow" }, { label: "设备分析", path: "/device" }, { label: "异常检测", path: "/anomaly" }, { label: "群组对比", path: "/cohortcmp" }, { label: "漏斗诊断", path: "/funnel" }, { label: "浏览深度", path: "/scrollmap" }, { label: "表单分析", path: "/formfield" }, { label: "点击流", path: "/clickstream" }, { label: "回访分析", path: "/retention" }, { label: "数据视图", path: "/dataview" }, { label: "参数字典", path: "/paramdef" }]
</script>
