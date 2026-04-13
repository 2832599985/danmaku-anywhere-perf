import { Box, Divider, Stack, Tab, Tabs, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Suspense } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation, useMatches } from 'react-router'

import { ErrorMessage } from '@/common/components/ErrorMessage'
import { FullPageSpinner } from '@/common/components/FullPageSpinner'
import { TabLayout } from '@/common/components/layout/TabLayout'
import { MountAvailabilityBanner } from '@/popup/component/MountAvailabilityBanner'
import { ReleaseNotes } from '@/popup/component/releaseNotes/ReleaseNotes'
import { AppToolBar } from './AppToolBar'

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

export const Home = () => {
  // the tab path should be the second element of the array
  const currentTab = useMatches()[1].pathname
  const location = useLocation()
  const { t } = useTranslation()

  const tabGroups: { label: string; tabs: ReactNode[] }[] = [
    {
      label: t('tabGroups.content', 'Content'),
      tabs: [
        <Tab
          key="/mount"
          label={t('tabs.mount', 'Library')}
          value="/mount"
          to="/mount"
          component={Link}
        />,
        <Tab
          key="/search"
          label={t('tabs.search', 'Search')}
          value="/search"
          to="/search"
          component={Link}
        />,
        <Tab
          key="/danmaku"
          label={t('tabs.danmaku', 'Danmaku')}
          value="/danmaku"
          to="/danmaku"
          component={Link}
        />,
        <Tab
          key="/stats"
          label={t('tabs.stats', 'Stats')}
          value="/stats"
          to="/stats"
          component={Link}
        />,
      ],
    },
    {
      label: t('tabGroups.display', 'Display'),
      tabs: [
        <Tab
          key="/styles"
          label={t('tabs.style', 'Danmaku Settings')}
          value="/styles"
          to="/styles"
          component={Link}
        />,
        <Tab
          key="/filter"
          label={t('tabs.filter', 'Danmaku Filter')}
          value="/filter"
          to="/filter"
          component={Link}
        />,
      ],
    },
    {
      label: t('tabGroups.system', 'System'),
      tabs: [
        <Tab
          key="/config"
          label={t('tabs.config', 'Config')}
          value="/config"
          to="/config"
          component={Link}
        />,
        <Tab
          key="/providers"
          label={t('tabs.providers', 'Providers')}
          value="/providers"
          to="/providers"
          component={Link}
        />,
        <Tab
          key="/ai-providers"
          label={t('tabs.aiProviders', 'AI Providers')}
          value="/ai-providers"
          to="/ai-providers"
          component={Link}
        />,
        <Tab
          key="/title-mapping"
          label={t('tabs.titleMapping', 'Title Mapping')}
          value="/title-mapping"
          to="/title-mapping"
          component={Link}
        />,
      ],
    },
  ]

  return (
    <Stack direction="column" spacing={0} height={1}>
      <AppToolBar />
      <Suspense fallback={null}>
        <MountAvailabilityBanner />
      </Suspense>
      <Box display="flex" flexGrow={1} height={1} minHeight={0}>
        <Tabs
          value={currentTab === '/' ? '/mount' : currentTab}
          orientation="vertical"
          variant="scrollable"
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
          {tabGroups.flatMap((group, groupIdx) => [
            ...(groupIdx > 0
              ? [<GroupDivider key={`divider-${groupIdx}`} />]
              : []),
            <GroupHeader key={`header-${groupIdx}`} label={group.label} />,
            ...group.tabs,
          ])}
        </Tabs>
        <ErrorBoundary
          fallbackRender={({ error }) => {
            return (
              <TabLayout>
                <ErrorMessage message={(error as Error).message} />
              </TabLayout>
            )
          }}
          key={location.key}
        >
          <Suspense
            fallback={
              <TabLayout>
                <FullPageSpinner />
              </TabLayout>
            }
            key={location.key}
          >
            <Outlet />
          </Suspense>
        </ErrorBoundary>
        <ReleaseNotes />
      </Box>
    </Stack>
  )
}
