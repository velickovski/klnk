import React, { useEffect, useState } from 'react';
import { Platform, Share, View } from 'react-native';
import type { z } from 'zod';
import type { AccountStatus, AccountRequestResultSchema } from '@personal-agent/domain';
import { api } from '../../api';
import { AppText } from '../../components/primitives';
import { Button, Card, Disclosure, Field, Notice } from '../../ui';
import { usePanelTask } from './panel-hooks';

type AccountRequest = z.infer<typeof AccountRequestResultSchema>;
type Props = { ownerId: string; onSignOut: () => void; onDeleted: () => void };

export function AccountPanel(props: Props) {
  return <AccountContent key={props.ownerId} {...props} />;
}
function AccountContent({ onSignOut, onDeleted }: Props) {
  const task = usePanelTask();
  const [status, setStatus] = useState<AccountStatus>();
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [email, setEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const refresh = () => task.run(() => api<AccountStatus>('/account/status'), setStatus);
  useEffect(() => {
    void refresh();
  }, []);

  const reauthenticate = async () => {
    if (password) {
      await api('/account/reauth', 'POST', { password });
      setStatus((current) => (current ? { ...current, reauthenticated: true } : current));
    }
  };
  const requestNotice = (result: AccountRequest) => {
    setPassword('');
    task.setNotice(
      result.delivery === 'disabled'
        ? 'Request accepted. Email delivery is disabled on this server; no delivery is confirmed.'
        : 'If eligible, an account link is queued for email delivery. Check your email; delivery is not yet confirmed.',
    );
  };
  return (
    <Card>
      <AppText role="title" accessibilityRole="header">
        Your account
      </AppText>
      <AppText>Manage your sign-in, recovery and personal data.</AppText>
      {status ? (
        <View style={{ gap: 16 }}>
          <AppText>{status.email}</AppText>
          <AppText>Email {status.emailVerified ? 'verified' : 'not yet verified'}</AppText>
          {status.mailDelivery === 'disabled' ? (
            <Notice>
              Email delivery is disabled on this server. Verification and recovery need an approved
              email configuration.
            </Notice>
          ) : null}
          <Field
            label="Current password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            autoCapitalize="none"
          />
          {!status.emailVerified ? (
            <Button
              label="Request verification link"
              secondary
              disabled={!password}
              loading={task.busy}
              onPress={() =>
                void task.run(
                  () => api<AccountRequest>('/account/resend-verification', 'POST', { password }),
                  requestNotice,
                )
              }
            />
          ) : null}
          <Disclosure title="Change email">
            <AppText>
              Your current email remains active until the new address is verified. Completing the
              change signs out every session.
            </AppText>
            <Field
              label="New email address"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />
            <Button
              label="Request email change"
              disabled={!password || !email.trim()}
              loading={task.busy}
              onPress={() =>
                void task.run(
                  () =>
                    api<AccountRequest>('/account/email', 'POST', {
                      email: email.trim(),
                      password,
                    }),
                  requestNotice,
                )
              }
            />
          </Disclosure>
          <Disclosure title="Change password">
            <Field
              label="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              textContentType="newPassword"
              autoComplete="new-password"
              autoCapitalize="none"
            />
            <AppText>Use at least 12 characters. Changing it signs out every session.</AppText>
            <Button
              label="Change password and sign out"
              disabled={!password || newPassword.length < 12}
              loading={task.busy}
              onPress={() =>
                void task.run(
                  () =>
                    api('/account/password', 'POST', { currentPassword: password, newPassword }),
                  () => {
                    setPassword('');
                    setNewPassword('');
                    onSignOut();
                  },
                )
              }
            />
          </Disclosure>
          <Button
            label="Request password reset email"
            secondary
            loading={task.busy}
            onPress={() =>
              void task.run(
                () => api<AccountRequest>('/auth/reset-request', 'POST', { email: status.email }),
                requestNotice,
              )
            }
          />
          <Button
            label="Sign out all sessions"
            secondary
            loading={task.busy}
            onPress={() =>
              void task.run(
                () => api('/account/sign-out-all', 'POST', {}),
                () => {
                  setPassword('');
                  setNewPassword('');
                  onSignOut();
                },
              )
            }
          />
          <Disclosure title="Export or delete account">
            <AppText>
              Confirm your password before exporting or deleting. Deleting also removes shared klnk
              records and cannot be undone.
            </AppText>
            <Button
              label="Export my account data"
              secondary
              loading={task.busy}
              disabled={!password && !status.reauthenticated}
              onPress={() =>
                void task.run(
                  async () => {
                    await reauthenticate();
                    const data = await api<unknown>('/export');
                    await exportData(data);
                  },
                  () => {
                    setPassword('');
                    task.setNotice(
                      Platform.OS === 'web'
                        ? 'Account export offered for download.'
                        : 'Account export opened in the system share sheet.',
                    );
                  },
                )
              }
            />
            {!deleting ? (
              <Button
                label="Review account deletion"
                danger
                loading={task.busy}
                disabled={!password && !status.reauthenticated}
                onPress={() =>
                  void task.run(reauthenticate, () => {
                    setPassword('');
                    setDeleting(true);
                  })
                }
              />
            ) : (
              <View style={{ gap: 12 }}>
                <AppText>
                  This permanently removes your account and its shared records. Continue only for
                  the account shown above.
                </AppText>
                <Button
                  label="Permanently delete my account"
                  danger
                  loading={task.busy}
                  onPress={() =>
                    void task.run(
                      () => api('/account', 'DELETE'),
                      () => {
                        setPassword('');
                        setNewPassword('');
                        onDeleted();
                      },
                    )
                  }
                />
                <Button label="Keep my account" secondary onPress={() => setDeleting(false)} />
              </View>
            )}
          </Disclosure>
        </View>
      ) : (
        <AppText>
          {task.busy
            ? 'Loading your account…'
            : 'Account details are unavailable. Refresh to try again.'}
        </AppText>
      )}
      {task.error ? <Notice tone="error">{task.error}</Notice> : null}
      {task.notice ? <Notice>{task.notice}</Notice> : null}
      <Button
        label="Refresh account status"
        secondary
        loading={task.busy}
        onPress={() => void refresh()}
      />
    </Card>
  );
}

async function exportData(data: unknown) {
  const content = JSON.stringify(data, null, 2);
  if (Platform.OS !== 'web') {
    await Share.share({ title: 'klnk account export', message: content });
    return;
  }
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'klnk-account-export.json';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
