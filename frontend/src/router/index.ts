import { createRouter, createWebHistory } from 'vue-router'

import Overview from '@/views/Overview.vue'
const Eventspec = () => import('@/views/eventspec/index.vue')
const Session = () => import('@/views/session/index.vue')
const SessionRestore = () => import('@/views/session-restore/index.vue')
const Heatmap = () => import('@/views/heatmap/index.vue')
const Feature = () => import('@/views/feature/index.vue')
const Action = () => import('@/views/action/index.vue')
const Pathmap = () => import('@/views/pathmap/index.vue')
const Eventtrace = () => import('@/views/eventtrace/index.vue')
const Timewindow = () => import('@/views/timewindow/index.vue')
const Device = () => import('@/views/device/index.vue')
const Anomaly = () => import('@/views/anomaly/index.vue')
const Cohortcmp = () => import('@/views/cohortcmp/index.vue')
const Funnel = () => import('@/views/funnel/index.vue')
const Scrollmap = () => import('@/views/scrollmap/index.vue')
const Formfield = () => import('@/views/formfield/index.vue')
const Clickstream = () => import('@/views/clickstream/index.vue')
const Retention = () => import('@/views/retention/index.vue')
const Dataview = () => import('@/views/dataview/index.vue')
const Paramdef = () => import('@/views/paramdef/index.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'overview', component: Overview },
    { path: '/eventspec', name: 'eventspec', component: Eventspec },
    { path: '/session', name: 'session', component: Session },
    { path: '/session-restore', name: 'session-restore', component: SessionRestore },
    { path: '/heatmap', name: 'heatmap', component: Heatmap },
    { path: '/feature', name: 'feature', component: Feature },
    { path: '/action', name: 'action', component: Action },
    { path: '/pathmap', name: 'pathmap', component: Pathmap },
    { path: '/eventtrace', name: 'eventtrace', component: Eventtrace },
    { path: '/timewindow', name: 'timewindow', component: Timewindow },
    { path: '/device', name: 'device', component: Device },
    { path: '/anomaly', name: 'anomaly', component: Anomaly },
    { path: '/cohortcmp', name: 'cohortcmp', component: Cohortcmp },
    { path: '/funnel', name: 'funnel', component: Funnel },
    { path: '/scrollmap', name: 'scrollmap', component: Scrollmap },
    { path: '/formfield', name: 'formfield', component: Formfield },
    { path: '/clickstream', name: 'clickstream', component: Clickstream },
    { path: '/retention', name: 'retention', component: Retention },
    { path: '/dataview', name: 'dataview', component: Dataview },
    { path: '/paramdef', name: 'paramdef', component: Paramdef },
  ],
})

export default router
