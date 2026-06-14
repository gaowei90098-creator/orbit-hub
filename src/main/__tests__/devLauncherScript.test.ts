import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('dev launcher script', () => {
  it('does not use pid-like variable names that collide with PowerShell built-ins', () => {
    const script = readFileSync(resolve(__dirname, '../../../..', 'start_agenthub_dev.ps1'), 'utf8')

    expect(script).not.toMatch(/\$pid(?:_|\b)/i)
  })
})
