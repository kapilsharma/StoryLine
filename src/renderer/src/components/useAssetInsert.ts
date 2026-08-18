import { useCallback, useState } from 'react'
import { isAllowedAsset, type AssetRef } from '@shared/assets'
import { useStore } from '../store'

/**
 * Getting an image or PDF into markdown text (Issue #61), shared by the
 * fullscreen editor and the board's note panel (Issue #83).
 *
 * Both offer the same three routes — the + Image button, a paste, a drop — and
 * all three end in the same place: the file is copied into the board's assets
 * folder and a markdown reference to it is handed back. Keeping that here means
 * the PDF rule below is decided once.
 */
export interface AssetInsert {
  /** Markdown for an imported asset: an embed for an image, a link for a PDF. */
  markdownFor: (ref: AssetRef) => string
  /** Import every acceptable file out of a paste or a drop, in order. */
  importFiles: (files: FileList | File[], insert: (markdown: string) => void) => Promise<void>
  /** Ask for a file with the system picker; resolves to null if cancelled. */
  pick: () => Promise<string | null>
  /** The last failure, for the caller to show; cleared on the next attempt. */
  error: string | null
}

/**
 * A PDF gets a link rather than an image embed, because an `<img>` pointing at a
 * PDF renders as a broken image in every browser.
 */
function markdownFor(ref: AssetRef): string {
  const isImage = !ref.file.toLowerCase().endsWith('.pdf')
  return `${isImage ? '!' : ''}[${ref.file}](${ref.markdownPath})`
}

export function useAssetInsert(): AssetInsert {
  const { importAsset, pickAsset } = useStore()
  const [error, setError] = useState<string | null>(null)

  const importFiles = useCallback(
    async (files: FileList | File[], insert: (markdown: string) => void): Promise<void> => {
      setError(null)
      for (const file of Array.from(files)) {
        if (!isAllowedAsset(file.name)) continue
        try {
          const buffer = await file.arrayBuffer()
          let binary = ''
          const bytes = new Uint8Array(buffer)
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
          insert(markdownFor(await importAsset({ name: file.name, data: btoa(binary) })))
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err))
        }
      }
    },
    [importAsset]
  )

  const pick = useCallback(async (): Promise<string | null> => {
    setError(null)
    try {
      const ref = await pickAsset()
      return ref ? markdownFor(ref) : null
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [pickAsset])

  return { markdownFor, importFiles, pick, error }
}
