import { Badge, Box, Divider, Tab, Tabs, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { match } from 'ts-pattern'

import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'
import { isConfigIncomplete } from '@/common/options/mountConfig/isPermissive'
import { useActiveConfig } from '@/content/controller/common/context/useActiveConfig'
import { PopupTab, usePopup } from '@/content/controller/store/popupStore'
import { routes } from '@/content/controller/ui/router/routes'

const GroupHeader = ({ label }: { label: string }) => (
  <Box sx={{ px: 1.5, pt: 1.5, pb: 0.5 }}>
    <Typography
      variant="caption"
      sx={{
        color: 'text.disabled',
        fontWeight: 600,
        fontSize: '0.65rem',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {label}
    </Typography>
  </Box>
)

const GroupDivider = () => <Divider sx={{ my: 0.5, borderColor: 'divider' }} />

interface TabGroup {
  label: string
  tabIds: PopupTab[]
}

const contentGroup: TabGroup = {
  label: 'Content',
  tabIds: [
    PopupTab.Mount,
    PopupTab.Search,
    PopupTab.Selector,
    PopupTab.Comments,
  ],
}

const displayGroup: TabGroup = {
  label: 'Display',
  tabIds: [PopupTab.Styles, PopupTab.Filter],
}

const systemGroup: TabGroup = {
  label: 'System',
  tabIds: [PopupTab.Policy, PopupTab.TitleMapping],
}

const debugGroup: TabGroup = {
  label: 'Debug',
  tabIds: [PopupTab.Stats, PopupTab.Debug],
}

export const PanelTabs = () => {
  const { tab, setTab } = usePopup()
  const { data: options } = useExtensionOptions()
  const activeConfig = useActiveConfig()
  const { t } = useTranslation()

  const handleTabChange = (_: unknown, value: PopupTab) => {
    setTab(value)
  }

  const visibleTabs = match(tab)
    .with(PopupTab.Selector, () => {
      return routes.filter((route) => route.tab === PopupTab.Selector)
    })
    .otherwise(() => {
      return routes.filter((route) => {
        if (route.tab === PopupTab.Selector) return false
        if (route.tab === PopupTab.Debug) {
          return options.debug
        }
        return true
      })
    })

  const visibleTabIds = useMemo(
    () => new Set(visibleTabs.map((r) => r.tab)),
    [visibleTabs]
  )

  const isIncomplete = isConfigIncomplete(activeConfig)

  const renderTab = (route: (typeof routes)[number]) => (
    <Tab
      label={
        route.tab === PopupTab.Policy && isIncomplete ? (
          <Badge color="warning" variant="dot">
            {route.name()}
          </Badge>
        ) : (
          route.name()
        )
      }
      value={route.tab}
      key={route.tab}
    />
  )

  const isSelectorMode = tab === PopupTab.Selector

  const groupedChildren = useMemo(() => {
    if (isSelectorMode) {
      return visibleTabs.map(renderTab)
    }

    const groups = options.debug
      ? [contentGroup, displayGroup, systemGroup, debugGroup]
      : [contentGroup, displayGroup, systemGroup]

    const localizedLabels: Record<string, string> = {
      Content: t('tabGroups.content', 'Content'),
      Display: t('tabGroups.display', 'Display'),
      System: t('tabGroups.system', 'System'),
      Debug: t('tabGroups.debug', 'Debug'),
    }

    const children: ReactNode[] = []
    let groupIdx = 0

    for (const group of groups) {
      const groupTabs = group.tabIds
        .filter((id) => visibleTabIds.has(id))
        .map((id) => routes.find((r) => r.tab === id)!)
        .filter(Boolean)

      if (groupTabs.length === 0) continue

      if (groupIdx > 0) {
        children.push(<GroupDivider key={`divider-${group.label}`} />)
      }
      children.push(
        <GroupHeader
          key={`header-${group.label}`}
          label={localizedLabels[group.label] ?? group.label}
        />
      )
      for (const route of groupTabs) {
        children.push(renderTab(route))
      }
      groupIdx++
    }

    return children
  }, [
    isSelectorMode,
    visibleTabs,
    visibleTabIds,
    options.debug,
    isIncomplete,
    t,
  ])

  return (
    <Tabs
      value={tab}
      onChange={handleTabChange}
      aria-label="Popup"
      variant="scrollable"
      scrollButtons="auto"
      orientation="vertical"
      sx={{
        borderRight: 1,
        borderColor: 'divider',
        width: 100,
        flexShrink: 0,
        '& .MuiTabs-indicator': {
          left: 0,
          right: 'auto',
        },
      }}
    >
      {groupedChildren}
    </Tabs>
  )
}
