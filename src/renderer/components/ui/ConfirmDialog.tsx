import React, { useState } from 'react'
import { Modal } from './Modal'
import { Button } from './Button'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  requireText?: string
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, description, confirmText = 'Confirm', cancelText = 'Cancel', danger = false, requireText
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [typed, setTyped] = useState('')
  const canConfirm = !requireText || typed === requireText

  const handle = async () => {
    if (!canConfirm) return
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false); onClose() }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-md">
      <div className="space-y-3">
        {description && <p className="text-sm text-[#a0a8ba] leading-relaxed">{description}</p>}
        {requireText && (
          <div>
            <p className="text-[11px] text-[#5c6478] mb-1.5">
              Type <span className="font-mono text-[#e2e6ef] bg-[#1a1f2e] px-1.5 py-0.5 rounded">{requireText}</span> to confirm
            </p>
            <input
              autoFocus
              value={typed}
              onChange={e => setTyped(e.target.value)}
              className="w-full bg-[#0a0c12] text-sm text-[#e2e6ef] placeholder-[#3f4758] px-3 py-2 rounded-md border border-[#262d3d] outline-none focus:border-[#6366f1]/50 focus:ring-2 focus:ring-[#6366f1]/15 transition-all"
              placeholder={requireText}
            />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={busy}>{cancelText}</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            size="sm"
            onClick={handle}
            disabled={!canConfirm || busy}
          >
            {busy ? 'Working…' : confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  )
}