import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'

interface PromptOptions {
  title: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
}

interface PendingPrompt extends PromptOptions {
  resolve: (value: string | null) => void
}

type AskFn = (options: PromptOptions) => Promise<string | null>

const PromptContext = createContext<AskFn | null>(null)

/**
 * Provides an imperative `ask(...)` that resolves to the entered string (or
 * null if cancelled). Replaces `window.prompt`, which Electron does not support.
 */
export function PromptProvider({ children }: { children: ReactNode }): JSX.Element {
  const [pending, setPending] = useState<PendingPrompt | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const ask = useCallback<AskFn>((options) => {
    setValue(options.defaultValue ?? '')
    return new Promise<string | null>((resolve) => {
      setPending({ ...options, resolve })
    })
  }, [])

  useEffect(() => {
    if (pending) inputRef.current?.focus()
  }, [pending])

  const finish = (result: string | null): void => {
    pending?.resolve(result)
    setPending(null)
  }

  return (
    <PromptContext.Provider value={ask}>
      {children}
      {pending && (
        <div className="modal-overlay" onClick={() => finish(null)}>
          <div className="modal prompt-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{pending.title}</h2>
            <input
              ref={inputRef}
              value={value}
              placeholder={pending.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && value.trim()) finish(value)
                else if (e.key === 'Escape') finish(null)
              }}
            />
            <div className="form-actions">
              <button className="btn primary" disabled={!value.trim()} onClick={() => finish(value)}>
                {pending.confirmLabel ?? 'OK'}
              </button>
              <button className="btn" onClick={() => finish(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </PromptContext.Provider>
  )
}

export function usePrompt(): AskFn {
  const ctx = useContext(PromptContext)
  if (!ctx) throw new Error('usePrompt must be used within PromptProvider')
  return ctx
}
