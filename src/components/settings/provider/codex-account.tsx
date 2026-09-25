import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Skeleton } from '@/components/base'
import { RefreshCw } from '@keyline-icons/react/two-tone'
import { api } from '@/api'
import type { CodexAuthStatusResponse } from '@/types'

/**
 * Which ChatGPT account this provider is signed in as.
 *
 * Read-only: signing in happens in a terminal, and this reports what is there.
 * It never triggers a refresh — opening a settings page must not spend a
 * refresh token, and a session that has lapsed is something to be told about
 * rather than quietly repaired from a screen nobody is watching.
 */
export function CodexAccount() {
  const { t } = useTranslation()
  const [status, setStatus] = useState<CodexAuthStatusResponse | null>(null)
  const [checking, setChecking] = useState(true)

  const check = useCallback(async () => {
    setChecking(true)
    try {
      setStatus(await api.codexAuthStatus())
    } catch (err) {
      console.error('Failed to read the Codex login:', err)
      setStatus({
        logged_in: false,
        email: null,
        plan: null,
        storage: null,
        codex_home: null,
        problem: String(err),
      })
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  return (
    <div data-slot="codex-account" className="border-t border-border-button-default pt-4 space-y-3">
      <div data-slot="codex-account-header" className="flex items-center justify-between">
        <p data-slot="codex-account-label" className="text-caption-1-regular text-text-secondary">
          {t('settings.provider.codexAccount')}
        </p>
        <Button leadingIcon={RefreshCw} variant="secondary" onPress={() => void check()} isPending={checking}>
          {t('settings.provider.codexRecheck')}
        </Button>
      </div>

      {checking && !status ? (
        <div
          data-slot="codex-account-skeleton"
          role="status"
          aria-busy="true"
          aria-label={t('settings.provider.codexAccount')}
        >
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : (
        status && (
          <div
            data-slot="codex-account-card"
            className="rounded-lg border border-border-button-default p-3 space-y-1.5"
          >
            {status.logged_in ? (
              <>
                <p data-slot="codex-account-email" className="text-body-regular">
                  {status.email ?? t('settings.provider.codexSignedIn')}
                </p>
                {status.plan && (
                  <p data-slot="codex-account-plan" className="text-caption-1-regular text-text-secondary">
                    {status.plan}
                  </p>
                )}
              </>
            ) : (
              <p data-slot="codex-account-signed-out" className="text-body-regular text-status-warning-soft-foreground">
                {t('settings.provider.codexSignedOut')}
              </p>
            )}
            {status.problem && (
              <p data-slot="codex-account-problem" className="text-caption-1-regular text-status-danger break-words">
                {status.problem}
              </p>
            )}
            {/* Where we looked. A GUI process need not inherit a terminal's
                environment, so "logged in over there, not here" is otherwise
                impossible for anyone to diagnose. */}
            {status.codex_home && (
              <p data-slot="codex-account-home" className="text-caption-1-regular text-text-secondary break-all">
                {status.codex_home}
                {status.storage === 'keyring' && ` · ${t('settings.provider.codexInKeyring')}`}
              </p>
            )}
          </div>
        )
      )}
    </div>
  )
}
