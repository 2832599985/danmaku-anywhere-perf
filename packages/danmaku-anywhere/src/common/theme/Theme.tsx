import { useMediaQuery } from '@mui/material'
import type { ThemeOptions } from '@mui/material/styles'
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
} from 'react'
import { useTranslation } from 'react-i18next'
import type { UserTheme } from '@/common/options/extensionOptions/schema'
import { useExtensionOptions } from '@/common/options/extensionOptions/useExtensionOptions'
import { ColorMode } from '@/common/theme/enums'
import type { ThemePalette } from '@/common/theme/themes'
import { getThemePalette } from '@/common/theme/themes'
import { getThemeCssVarsString } from '@/common/theme/themeVars'

import { tryCatchSync } from '@/common/utils/tryCatch'

const getDefaultThemeOptions = (
  mode: 'dark' | 'light',
  palette: ThemePalette
): ThemeOptions => ({
  palette: {
    mode,
    primary: {
      main: palette.primary,
    },
    secondary: {
      main: palette.secondary,
    },
    ...(mode === 'dark' && {
      background: {
        default: palette.darkBg,
        paper: palette.darkBg,
      },
    }),
  },
  shape: {
    borderRadius: 16,
  },
  components: {
    ...(mode === 'dark' && {
      MuiPaper: {
        styleOverrides: {
          root: {
            background: `${palette.glass.tint}, ${palette.glass.scrim}`,
            backdropFilter: palette.glass.blur,
            backgroundImage: 'none',
          },
        },
      },
    }),
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          textTransform: 'none',
        },
      },
    },
  },
})

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

interface ThemeProps extends PropsWithChildren {
  options?: ThemeOptions
  /**
   * Optional style element in the shadow DOM for injecting theme CSS variables.
   * When provided, CSS vars are written to this element via textContent.
   */
  themeStyleEl?: HTMLStyleElement
}

export const Theme = ({ children, options = {}, themeStyleEl }: ThemeProps) => {
  // TODO: for some reason, useMediaQuery crashes in Firefox so we wrap it in a try-catch
  // probably for the same reason as https://github.com/facebook/react/issues/16606
  const [prefersDarkMode] = tryCatchSync(() =>
    useMediaQuery('(prefers-color-scheme: dark)')
  )

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
  const currentPalette = useMemo(() => getThemePalette(themeId), [themeId])

  // Sync theme CSS variables to the shadow DOM style element
  useEffect(() => {
    if (themeStyleEl) {
      themeStyleEl.textContent = getThemeCssVarsString(currentPalette)
    }
  }, [themeStyleEl, currentPalette])

  const preferredColorScheme = (prefersDarkMode ?? true) ? 'dark' : 'light'
  const colorScheme: 'dark' | 'light' =
    colorMode === 'system' ? preferredColorScheme : colorMode

  const theme = useMemo(() => {
    const languageMap: Record<string, Localization> = {
      zh: zhCN,
      en: enUS,
    }

    const base = getDefaultThemeOptions(colorScheme, currentPalette)
    return createTheme(
      produce(base, (draft) => {
        Object.assign(draft, options)
        if (!draft.palette) draft.palette = {}
        draft.palette.mode = colorScheme
      }),
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
