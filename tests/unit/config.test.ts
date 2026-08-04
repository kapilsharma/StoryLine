import { describe, it, expect } from 'vitest'
import { DEFAULT_SETTINGS, CARD_FONT_MIN, CARD_FONT_MAX } from '@shared/config'

describe('default settings', () => {
  it('includes a card font size within the allowed range', () => {
    expect(DEFAULT_SETTINGS.cardFontSize).toBe(13)
    expect(DEFAULT_SETTINGS.cardFontSize).toBeGreaterThanOrEqual(CARD_FONT_MIN)
    expect(DEFAULT_SETTINGS.cardFontSize).toBeLessThanOrEqual(CARD_FONT_MAX)
  })
})
