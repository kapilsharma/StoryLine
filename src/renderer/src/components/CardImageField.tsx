import { useState } from 'react'
import { ASSETS_DIR, desktopAssetResolver, isImageAsset, staticAssetResolver } from '@shared/assets'
import { useStore } from '../store'

/** The board's assets load over a custom scheme in the app, by relative URL in a published site. */
function useAssetUrl(image: string | undefined): string | undefined {
  const { activeBoardId, readOnly } = useStore()
  const resolve = readOnly ? staticAssetResolver : desktopAssetResolver
  return image && activeBoardId ? resolve(activeBoardId, image) : undefined
}

/** An image card's picture, read-only — the popup, and a read-only panel (#218). */
export function CardImage({ image, className }: { image: string; className?: string }): JSX.Element | null {
  const src = useAssetUrl(image)
  return src ? <img className={`card-image-preview${className ? ` ${className}` : ''}`} src={src} alt="" /> : null
}

interface Props {
  /** The note's `image:` (an `assets/<file>` reference), or undefined for a text card. */
  image: string | undefined
  /** Set (a new picture) or clear (back to Text) the note's image. Saved at once by the caller. */
  onChange: (image: string | undefined) => void
  /** The tags input — the Text/Image choice sits on its row. */
  tags: React.ReactNode
  /** The hover text input, under the tags. */
  hover: React.ReactNode
  /** Margins differ between the panel and the fullscreen editor. */
  className?: string
}

/**
 * Text or Image card (Issue #218), shared by the note panel and the fullscreen
 * editor.
 *
 * The choice sits at the start of the tags row. Text is what every card has
 * always been. Image puts a picture box to the left of the tags and hover text:
 * click it for a chooser that offers the pictures already in the board's assets
 * folder, so going back and forth never copies the same file in twice, and
 * **Upload new image…**, which copies one in as an image in a note is (#61). A
 * file dropped on the box is uploaded straight away. The card only becomes an
 * image card once a picture is chosen — until then Image is just the box asking
 * for one — and going back to Text clears the reference but leaves the file.
 */
export function CardImageField({ image, onChange, tags, hover, className }: Props): JSX.Element {
  const { importAsset, pickAsset, listImageAssets, readOnly } = useStore()
  // Image with nothing chosen yet is a state of this form, not of the note.
  const [wantImage, setWantImage] = useState(!!image)
  const [error, setError] = useState<string | null>(null)
  // The chooser's list of the board's pictures; null while it is closed.
  const [choices, setChoices] = useState<string[] | null>(null)
  const showImage = wantImage || !!image

  const src = useAssetUrl(image)

  const chooseText = (): void => {
    setWantImage(false)
    setChoices(null)
    setError(null)
    if (image) onChange(undefined)
  }

  const openChooser = async (): Promise<void> => {
    if (readOnly) return
    setError(null)
    try {
      setChoices(await listImageAssets())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const chooseExisting = (file: string): void => {
    setChoices(null)
    const next = `${ASSETS_DIR}/${file}`
    if (next !== image) onChange(next)
  }

  const upload = async (): Promise<void> => {
    if (readOnly) return
    setError(null)
    try {
      const ref = await pickAsset(true)
      if (ref) {
        setChoices(null)
        onChange(ref.markdownPath)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const drop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    if (readOnly) return
    const file = Array.from(e.dataTransfer.files).find((f) => isImageAsset(f.name))
    if (!file) {
      setError('Drop an image — PNG, JPG, GIF, WebP, SVG or AVIF.')
      return
    }
    setError(null)
    setChoices(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      onChange((await importAsset({ name: file.name, data: btoa(binary) })).markdownPath)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className={`card-fields${className ? ` ${className}` : ''}`}>
      {showImage && (
        <button
          type="button"
          className={`card-image-box${src ? '' : ' empty'}`}
          onClick={() => (choices ? setChoices(null) : void openChooser())}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => void drop(e)}
          disabled={readOnly}
          title={readOnly ? undefined : src ? 'Change image' : 'Choose an image'}
          aria-label={src ? 'Change image' : 'Choose an image'}
        >
          {src ? <img src={src} alt="" /> : <span className="muted small">Choose image…</span>}
        </button>
      )}
      <div className="card-fields-main">
        <div className="card-fields-tags">
          <div className="card-kind-toggle" role="radiogroup" aria-label="Card type">
            <button
              type="button"
              role="radio"
              aria-checked={!showImage}
              className={!showImage ? 'active' : ''}
              disabled={readOnly}
              onClick={chooseText}
            >
              Text
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={showImage}
              className={showImage ? 'active' : ''}
              disabled={readOnly}
              onClick={() => {
                if (showImage) return
                setWantImage(true)
                void openChooser()
              }}
            >
              Image
            </button>
          </div>
          {tags}
        </div>
        {hover}
        {error && <p className="error small card-image-error">{error}</p>}
      </div>
      {choices && (
        <div className="card-image-chooser" role="group" aria-label="Choose an image">
          <div className="card-image-chooser-head">
            <button type="button" className="btn small" onClick={() => void upload()}>
              Upload new image…
            </button>
            <span className="muted small">
              {choices.length ? 'or pick one already on this board' : 'No images on this board yet.'}
            </span>
            <button
              type="button"
              className="icon-btn card-image-chooser-close"
              onClick={() => setChoices(null)}
              aria-label="Close image chooser"
              title="Close"
            >
              ✕
            </button>
          </div>
          {choices.length > 0 && (
            <div className="card-image-grid">
              {choices.map((file) => (
                <AssetThumb
                  key={file}
                  file={file}
                  current={image === `${ASSETS_DIR}/${file}`}
                  onPick={() => chooseExisting(file)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** One picture in the chooser: a thumbnail, its filename on hover. */
function AssetThumb({
  file,
  current,
  onPick
}: {
  file: string
  current: boolean
  onPick: () => void
}): JSX.Element {
  const src = useAssetUrl(`${ASSETS_DIR}/${file}`)
  return (
    <button
      type="button"
      className={`card-image-thumb${current ? ' current' : ''}`}
      onClick={onPick}
      title={file}
      aria-label={file}
      aria-pressed={current}
    >
      <img src={src} alt="" loading="lazy" />
    </button>
  )
}
