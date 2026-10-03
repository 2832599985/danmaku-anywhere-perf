import { Box, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { usePlayerStore } from '@/store/playerStore'
import {
  GOLD,
  hardShadow,
  hatchSx,
  INK,
  LINE_WEAK,
  MONO,
  PAPER,
  VERMILION,
} from '@/theme/theme'
import { InkLabel, InkSwitch } from './ink'

export const FilenameRulesSettings = () => {
  const learn = usePlayerStore((s) => s.danmakuSettings.learnFilenamePatterns)
  const updateDanmakuSettings = usePlayerStore((s) => s.updateDanmakuSettings)
  const rules = usePlayerStore((s) => s.filenameRules)
  const removeRule = usePlayerStore((s) => s.removeFilenameRule)
  const clearRules = usePlayerStore((s) => s.clearFilenameRules)

  const sorted = [...rules].sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <Stack spacing={1.5}>
      <Box sx={{ border: LINE_WEAK, padding: '12px' }}>
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <InkLabel
            zh="记住文件名格式"
            en="LEARN FROM MANUAL PICKS"
            size={13}
          />
          <InkSwitch
            checked={learn}
            onChange={(next) =>
              updateDanmakuSettings({ learnFilenamePatterns: next })
            }
            label="记住文件名格式"
          />
        </Stack>
        <Typography
          sx={{
            fontSize: 11,
            color: alpha(PAPER, 0.6),
            lineHeight: 1.7,
            marginTop: '8px',
          }}
        >
          {
            '手动选过一次季/集之后，这里会记住这个文件名格式（哪一段数字是集数、对应哪一季）。之后同一批文件直接自动匹配，不再打断你。'
          }
        </Typography>
      </Box>
      {!learn && (
        <Box
          sx={{
            border: `2px solid ${GOLD}`,
            background: alpha(GOLD, 0.08),
            color: GOLD,
            fontSize: 11,
            fontWeight: 700,
            padding: '6px 10px',
          }}
        >
          已关闭：不再学习新格式，也不会套用下面已有的规则。
        </Box>
      )}

      <Stack
        direction="row"
        alignItems="baseline"
        spacing={1}
        sx={{ marginTop: '2px' }}
      >
        <Typography
          component="span"
          sx={{
            fontSize: 12,
            fontWeight: 900,
            color: PAPER,
            letterSpacing: '0.08em',
          }}
        >
          已学到的格式
        </Typography>
        <Typography
          component="span"
          sx={{
            fontFamily: MONO,
            fontSize: 9,
            letterSpacing: '0.2em',
            color: alpha(PAPER, 0.4),
          }}
        >
          {sorted.length} RULE(S)
        </Typography>
      </Stack>
      {sorted.length === 0 ? (
        <Box
          sx={{
            border: LINE_WEAK,
            ...hatchSx(),
            padding: '20px 14px',
            textAlign: 'center',
          }}
        >
          <Typography
            sx={{ fontSize: 12, fontWeight: 700, color: alpha(PAPER, 0.5) }}
          >
            还没有学到任何格式
          </Typography>
          <Typography
            sx={{
              fontSize: 11,
              color: alpha(PAPER, 0.4),
              marginTop: '6px',
              lineHeight: 1.7,
            }}
          >
            下次自动匹配失败、你手动选集之后，这里就会出现一条。
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1}>
          {sorted.map((rule) => (
            <Box
              key={rule.id}
              sx={{
                border: LINE_WEAK,
                background: alpha(PAPER, 0.03),
                padding: '9px 11px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
              }}
            >
              <Stack sx={{ flex: 1, minWidth: 0, gap: 0.25 }}>
                {rule.folder && (
                  <Typography
                    sx={{
                      fontFamily: MONO,
                      fontSize: 9,
                      fontWeight: 700,
                      color: alpha(PAPER, 0.4),
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={rule.folder}
                  >
                    {rule.folder}
                  </Typography>
                )}
                <Typography
                  sx={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: PAPER,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={rule.sample}
                >
                  {rule.sample}
                </Typography>
                <Typography
                  sx={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 700,
                    color: alpha(PAPER, 0.55),
                  }}
                >
                  {`→ ${rule.season.title || rule.season.bangumiId} · 第${rule.episode}集 · 命中 ${rule.hits} 次`}
                </Typography>
              </Stack>

              <Box
                component="button"
                type="button"
                onClick={() => removeRule(rule.id)}
                title="删除这条规则"
                sx={{
                  appearance: 'none',
                  cursor: 'pointer',
                  flexShrink: 0,
                  width: 24,
                  height: 24,
                  border: LINE_WEAK,
                  background: 'transparent',
                  color: alpha(PAPER, 0.6),
                  fontSize: 12,
                  fontWeight: 900,
                  transition: 'all 100ms steps(1)',
                  '&:hover': {
                    border: `2px solid ${VERMILION}`,
                    color: VERMILION,
                  },
                }}
              >
                ✕
              </Box>
            </Box>
          ))}
        </Stack>
      )}

      {sorted.length > 0 && (
        <Box
          component="button"
          type="button"
          onClick={clearRules}
          sx={{
            appearance: 'none',
            cursor: 'pointer',
            alignSelf: 'flex-start',
            padding: '7px 16px',
            border: `2px solid ${VERMILION}`,
            background: 'transparent',
            color: VERMILION,
            fontSize: 12,
            fontWeight: 900,
            boxShadow: hardShadow(3, INK),
            transition: 'all 100ms steps(1)',
            '&:hover': {
              background: VERMILION,
              color: PAPER,
            },
          }}
        >
          清空全部规则
        </Box>
      )}
    </Stack>
  )
}
