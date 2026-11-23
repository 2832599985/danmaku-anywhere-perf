import { i18n } from '@/common/localization/i18n'

export interface FixedSkipButtonProps {
  seconds: number
  onClick: () => void
}

export function FixedSkipButton(props: FixedSkipButtonProps) {
  const { seconds, onClick } = props

  return (
    <div className="da-fixed-skip-button-wrapper">
      <div className="da-alert">
        <button type="button" className="da-text-button" onClick={onClick}>
          {i18n.t('optionsPage.player.fixedSkip', 'Skip {{seconds}}s', {
            seconds,
          })}
        </button>
      </div>
    </div>
  )
}
