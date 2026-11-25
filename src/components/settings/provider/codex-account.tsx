import './codex-account.css'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Skeleton } from '@/components/yuerchu-ui/components/skeleton/skeleton'
import { Button } from '@/components/yuerchu-ui/components/button/button'
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
      setStatus(await api.providers.getCodexAuthStatus())
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
    <div data-slot="codex-account" className="m-codex-account">
      <div data-slot="codex-account-header" className="m-codex-account__header">
        <p data-slot="codex-account-label" className="m-codex-account__label">
          {t('settings.provider.codexAccount')}
        </p>
        <Button icon={<RefreshCw />} variant="secondary" onPress={() => void check()} isPending={checking}>
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
          <Skeleton shape="rect" width="100%" height="4rem" />
        </div>
      ) : (
        status && (
          <div data-slot="codex-account-card" className="m-codex-account__card">
            {status.logged_in ? (
              <>
                <p data-slot="codex-account-email" className="m-codex-account__email">
                  {status.email ?? t('settings.provider.codexSignedIn')}
                </p>
                {status.plan && (
                  <p data-slot="codex-account-plan" className="m-codex-account__meta">
                    {status.plan}
                  </p>
                )}
              </>
            ) : (
              <p data-slot="codex-account-signed-out" className="m-codex-account__signed-out">
                {t('settings.provider.codexSignedOut')}
              </p>
            )}
            {status.problem && (
              <Alert data-slot="codex-account-problem" tone="danger" shouldAnnounce>
                {status.problem}
              </Alert>
            )}
            {/* Where we looked. A GUI process need not inherit a terminal's
                environment, so "logged in over there, not here" is otherwise
                impossible for anyone to diagnose. */}
            {status.codex_home && (
              <p data-slot="codex-account-home" className="m-codex-account__meta" data-wrap="anywhere">
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
