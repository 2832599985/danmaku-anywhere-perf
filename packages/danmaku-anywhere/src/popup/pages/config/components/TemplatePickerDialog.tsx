import { Add, Check } from '@mui/icons-material'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListSubheader,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/common/components/Toast/toastStore'
import { createMountConfig } from '@/common/options/mountConfig/constant'
import { integrationData } from '@/common/options/mountConfig/integrationData'
import {
  type MountConfigTemplate,
  mountConfigTemplates,
} from '@/common/options/mountConfig/templates'
import {
  useEditMountConfig,
  useMountConfig,
} from '@/common/options/mountConfig/useMountConfig'

interface TemplatePickerDialogProps {
  open: boolean
  onClose: () => void
}

const categoryOrder = ['chinese', 'international', 'self-hosted'] as const

export const TemplatePickerDialog = ({
  open,
  onClose,
}: TemplatePickerDialogProps) => {
  const { t } = useTranslation()
  const { configs } = useMountConfig()
  const { create } = useEditMountConfig()
  const toast = useToast.use.toast()

  const existingPatterns = useMemo(() => {
    const set = new Set<string>()
    for (const config of configs) {
      for (const pattern of config.patterns) {
        set.add(pattern)
      }
    }
    return set
  }, [configs])

  const isTemplateImported = (template: MountConfigTemplate) => {
    return (
      template.patterns.length > 0 &&
      template.patterns.some((p) => existingPatterns.has(p))
    )
  }

  const grouped = useMemo(() => {
    const map = new Map<string, MountConfigTemplate[]>()
    for (const cat of categoryOrder) {
      map.set(cat, [])
    }
    for (const tpl of mountConfigTemplates) {
      const list = map.get(tpl.category)
      if (list) {
        list.push(tpl)
      }
    }
    return map
  }, [])

  const handleImport = async (template: MountConfigTemplate) => {
    const config = createMountConfig({
      name: template.name,
      patterns: template.patterns,
      mediaQuery: template.mediaQuery,
      mode: template.mode,
      enabled: true,
      preferredProviders: template.preferredProviders,
    })
    try {
      await create.mutateAsync(config)
      toast.success(
        t('configPage.templates.imported', 'Template imported: {{name}}', {
          name: template.name,
        })
      )
    } catch {
      toast.error(
        t('configPage.templates.importError', 'Failed to import template')
      )
    }
  }

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'chinese':
        return t('configPage.templates.categoryChinese', 'Chinese Sites')
      case 'international':
        return t(
          'configPage.templates.categoryInternational',
          'International Sites'
        )
      case 'self-hosted':
        return t('configPage.templates.categorySelfHosted', 'Self-hosted')
      default:
        return category
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {t('configPage.templates.title', 'Site Templates')}
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ px: 2, pt: 1.5, pb: 0.5 }}
        >
          {t(
            'configPage.templates.description',
            'Import pre-configured templates for popular video sites. Self-hosted sites require manual URL pattern setup after import.'
          )}
        </Typography>
        <List dense>
          {categoryOrder.map((category) => {
            const templates = grouped.get(category)
            if (!templates || templates.length === 0) return null
            return (
              <Box key={category}>
                <ListSubheader>{getCategoryLabel(category)}</ListSubheader>
                {templates.map((template) => {
                  const imported = isTemplateImported(template)
                  return (
                    <ListItem
                      key={template.templateId}
                      secondaryAction={
                        imported ? (
                          <Tooltip
                            title={t(
                              'configPage.templates.alreadyImported',
                              'Already imported'
                            )}
                          >
                            <span>
                              <IconButton disabled size="small">
                                <Check color="success" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        ) : (
                          <Tooltip title={t('common.import', 'Import')}>
                            <IconButton
                              size="small"
                              onClick={() => handleImport(template)}
                              disabled={create.isPending}
                            >
                              <Add />
                            </IconButton>
                          </Tooltip>
                        )
                      }
                    >
                      <ListItemText
                        primary={
                          <Box display="flex" alignItems="center" gap={1}>
                            {template.name}
                            <Chip
                              size="small"
                              label={integrationData[template.mode].label()}
                              color={
                                template.mode === 'ai' ? 'secondary' : 'primary'
                              }
                              variant="filled"
                            />
                          </Box>
                        }
                        secondary={template.description}
                      />
                    </ListItem>
                  )
                })}
              </Box>
            )
          })}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close', 'Close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
