import { defineConfig } from 'i18next-cli'

export default defineConfig({
  locales: ['en', 'zh'],
  extract: {
    input: 'src/**/*.{js,jsx,ts,tsx}',
    output: 'src/common/localization/locales/{{language}}/{{namespace}}.json',
    /**
     * Keys held in lookup tables and resolved as `t(row.someKey)` are invisible
     * to static extraction, so without this the extractor deletes strings that
     * are very much in use.
     */
    preservePatterns: [
      // HOTKEY_GROUPS in HotkeyCheatSheet.tsx
      'cheatSheet.group.*',
      // ThemePalette.name in common/theme/themes.ts
      'theme.*',
      // `cause` strings raised by the background matching strategies
      'matching.*',
      // strokePresets in content/common/DanmakuStyles/DanmakuStylesForm.tsx
      'stylePage.strokePresets.*',
      // descriptionKey in common/settings/settingConfigs.ts
      'optionsPage.enableMultiSourceMergeDescription',
    ],
  },
})
