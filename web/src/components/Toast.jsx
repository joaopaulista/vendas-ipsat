import { useCallback, useEffect, useRef, useState } from 'react'

/** Aviso curto no rodape. Some sozinho; erro fica um pouco mais tempo. */
export function useToast() {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)

  const show = useCallback((message, kind = 'success') => {
    clearTimeout(timer.current)
    setToast({ message, kind, id: Date.now() })
    timer.current = setTimeout(() => setToast(null), kind === 'error' ? 6000 : 3500)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  return { toast, show }
}

export function Toast({ toast }) {
  if (!toast) return null
  return (
    <div className={`toast toast--${toast.kind}`} role="status" aria-live="polite">
      {toast.message}
    </div>
  )
}
