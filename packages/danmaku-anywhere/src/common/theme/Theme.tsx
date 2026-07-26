import type { CSSObject, ThemeOptions } from '@mui/material/styles'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import type { Localization } from '@mui/x-data-grid/internals'
import { enUS, zhCN } from '@mui/x-data-grid/locales'
import { produce } from 'immer'
import {
  createContext,
  type PropsWithChildren,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { UserTheme } from '@/common/options/extensionOptions/schema'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'
import { ColorMode } from '@/common/theme/enums'
import type { ThemePalette } from '@/common/theme/themes'
import { getThemePalette, resolveColorScheme } from '@/common/theme/themes'
import { getThemeCssVarsString } from '@/common/theme/themeVars'
import { MOTION, RADIUS, UI_FONT } from '@/common/theme/tokens'

import { tryCatchSync } from '@/common/utils/tryCatch'

const getDefaultThemeOptions = (
  mode: 'dark' | 'light',
  palette: ThemePalette
): ThemeOptions => {
  const g = palette.glass
  // Menus, tooltips and dialogs float over the panel or bright video, so they
  // opt out of the global MuiPaper glass (double-blur muddies them) and pick
  // the fill weight that suits their density.
  const floatingGlass = (fill: string, radius: number): CSSObject => ({
    backgroundColor: fill,
    backgroundImage: g.tint,
    backgroundClip: 'padding-box',
    backdropFilter: g.blur,
    WebkitBackdropFilter: g.blur,
    border: `1px solid ${g.border}`,
    borderRadius: radius,
    boxShadow: `${g.specular}, ${g.depth}`,
    '@media (prefers-reduced-transparency: reduce)': {
      backgroundColor: g.solid,
      backgroundImage: 'none',
      backdropFilter: 'none',
      WebkitBackdropFilter: 'none',
    },
  })

  return {
    palette: {
      mode,
      primary: { main: palette.primary },
      secondary: { main: palette.secondary },
      success: { main: palette.status.success },
      warning: { main: palette.status.warning },
      error: { main: palette.status.error },
      info: { main: palette.status.info },
      background:
        mode === 'dark'
          ? {
              default: palette.darkBg,
              paper: palette.darkBg,
            }
          : {
              default: '#f4f6fb',
              paper: '#f8fafc',
            },
    },
    shape: {
      borderRadius: RADIUS.m,
    },
    typography: {
      fontFamily: UI_FONT,
    },
    components: {
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundColor: g.scrim,
            backgroundImage: g.tint,
            backdropFilter: g.blur,
            WebkitBackdropFilter: g.blur,
            border: `1px solid ${g.border}`,
            backgroundClip: 'padding-box',
            '@media (prefers-reduced-transparency: reduce)': {
              backgroundColor: g.solid,
              backgroundImage: 'none',
              backdropFilter: 'none',
              WebkitBackdropFilter: 'none',
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.m,
            textTransform: 'none',
            transition: `background-color ${MOTION.durFast}ms ${MOTION.easeSwift}, box-shadow ${MOTION.durFast}ms ${MOTION.easeSwift}, transform ${MOTION.durFast}ms ${MOTION.easeSwift}`,
            '&:active': { transform: 'scale(0.97)' },
            '@media (prefers-reduced-motion: reduce)': {
              transition: 'background-color 80ms linear',
              '&:active': { transform: 'none' },
            },
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: floatingGlass(g.overlay, RADIUS.l),
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: floatingGlass(g.scrim, RADIUS.m),
        },
      },
      MuiPopover: {
        styleOverrides: {
          paper: floatingGlass(g.scrim, RADIUS.m),
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            backgroundColor: g.overlay,
            backdropFilter: g.blur,
            WebkitBackdropFilter: g.blur,
            border: `1px solid ${g.border}`,
            borderRadius: RADIUS.s,
            fontSize: '0.75rem',
            fontWeight: 500,
            boxShadow: g.depth,
            '@media (prefers-reduced-transparency: reduce)': {
              backgroundColor: g.solid,
              backdropFilter: 'none',
              WebkitBackdropFilter: 'none',
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: RADIUS.s },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: {
            backgroundImage: palette.gradient,
            borderRadius: 2,
          },
        },
      },
      MuiLinearProgress: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS.pill,
            backgroundColor: g.base,
          },
          bar: {
            borderRadius: RADIUS.pill,
            backgroundImage: palette.gradient,
          },
        },
      },
    },
  }
}

type ThemeContext = UserTheme & {
  setColorMode: (colorScheme: ColorMode) => void
  setThemeId: (id: string) => void
  colorScheme: 'dark' | 'light'
  palette: ThemePalette
}

const context = createContext<ThemeContext>({
  colorMode: ColorMode.System,
  colorScheme: 'dark',
  themeId: 'neon-violet',
  setColorMode: () => void 0,
  setThemeId: () => void 0,
  palette: getThemePalette('neon-violet'),
})

const DARK_MODE_QUERY = '(prefers-color-scheme: dark)'

/**
 * `useMediaQuery` used to be called inside a try-catch callback because it
 * crashes in some Firefox builds (see facebook/react#16606). A hook that only
 * sometimes runs corrupts hook order for the whole provider, so the guard moved
 * inside an effect where throwing is harmless.
 */
const usePrefersDarkMode = () => {
  const [prefersDarkMode, setPrefersDarkMode] = useState<boolean | undefined>(
    undefined
  )

  useEffect(() => {
    const [mediaQuery] = tryCatchSync(() => window.matchMedia(DARK_MODE_QUERY))
    if (!mediaQuery) return

    setPrefersDarkMode(mediaQuery.matches)

    const onChange = (event: MediaQueryListEvent) => {
      setPrefersDarkMode(event.matches)
    }

    mediaQuery.addEventListener('change', onChange)

    return () => {
      mediaQuery.removeEventListener('change', onChange)
    }
  }, [])

  return prefersDarkMode
}

interface ThemeProps extends PropsWithChildren {
  options?: ThemeOptions
  /**
   * Optional style element in the shadow DOM for injecting theme CSS variables.
   * When provided, CSS vars are written to this element via textContent.
   */
  themeStyleEl?: HTMLStyleElement
}

export const Theme = ({ children, options = {}, themeStyleEl }: ThemeProps) => {
  const prefersDarkMode = usePrefersDarkMode()

  const { i18n } = useTranslation()

  const { data, partialUpdate } = useExtensionOptions()

  const setColorMode = useCallback(
    async (colorScheme: ColorMode) => {
      await partialUpdate(
        produce(data, (draft) => {
          draft.theme.colorMode = colorScheme
        })
      )
    },
    [data, partialUpdate]
  )

  const setThemeId = useCallback(
    async (id: string) => {
      await partialUpdate(
        produce(data, (draft) => {
          draft.theme.themeId = id
        })
      )
    },
    [data, partialUpdate]
  )

  const colorMode = data.theme.colorMode
  const themeId = data.theme.themeId
  const colorScheme = resolveColorScheme(colorMode, prefersDarkMode ?? true)
  const currentPalette = useMemo(
    () => getThemePalette(themeId, colorScheme),
    [themeId, colorScheme]
  )

  // Sync theme CSS variables to the shadow DOM style element
  useEffect(() => {
    if (themeStyleEl) {
      themeStyleEl.textContent = getThemeCssVarsString(currentPalette)
    }
  }, [themeStyleEl, currentPalette])

  const theme = useMemo(() => {
    const languageMap: Record<string, Localization> = {
      zh: zhCN,
      en: enUS,
    }

    const base = getDefaultThemeOptions(colorScheme, currentPalette)
    return createTheme(
      base,
      options,
      { palette: { mode: colorScheme } },
      languageMap[i18n.language]
    )
  }, [colorScheme, options, i18n.language, currentPalette])

  const themeContextValue = useMemo(
    () => ({
      colorMode,
      colorScheme,
      themeId,
      setColorMode,
      setThemeId,
      palette: currentPalette,
    }),
    [colorScheme, colorMode, themeId, setColorMode, setThemeId, currentPalette]
  )

  return (
    <context.Provider value={themeContextValue}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </context.Provider>
  )
}

export const useThemeContext = () => {
  return use(context)
}
