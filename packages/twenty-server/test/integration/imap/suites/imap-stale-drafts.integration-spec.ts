import { randomUUID } from 'node:crypto';

import { isNonEmptyString } from '@sniptt/guards';
import { ImapFlow } from 'imapflow';

import { deleteConnectedAccount } from 'test/integration/metadata/suites/connected-account/utils/delete-connected-account.util';
import { updateConfigVariable } from 'test/integration/twenty-config/utils/update-config-variable.util';
import { appendMessageOverImap } from 'test/integration/utils/append-message-over-imap.util';
import { connectDovecotImapAccount } from 'test/integration/utils/connect-dovecot-imap-account.util';
import { findImportedMessageSubjects } from 'test/integration/utils/find-imported-records.util';
import { runMessageChannelSync } from 'test/integration/utils/run-message-channel-sync.util';
import { type DovecotServer } from 'test/integration/utils/start-dovecot-container.util';

const PASSWORD = 'dovecot-password';
const HANDLE = `imap-stale-drafts-${randomUUID()}@acme.test`;

describe('IMAP drafts removed from the mailbox (integration)', () => {
  let dovecot: DovecotServer;
  let connectedAccountId: string;
  let messageChannelId: string;

  const saveMessage = ({
    subject,
    folder,
  }: {
    subject: string;
    folder: string;
  }) =>
    appendMessageOverImap({
      host: dovecot.host,
      port: dovecot.imapPort,
      username: HANDLE,
      password: PASSWORD,
      folder,
      from: HANDLE,
      to: `recipient-${randomUUID()}@external.test`,
      subject,
    });

  const removeMessage = async ({
    subject,
    folder,
  }: {
    subject: string;
    folder: string;
  }) => {
    const client = new ImapFlow({
      host: dovecot.host,
      port: dovecot.imapPort,
      secure: false,
      auth: { user: HANDLE, pass: PASSWORD },
      logger: false,
    });

    await client.connect();

    try {
      const lock = await client.getMailboxLock(folder);

      try {
        await client.messageDelete({ subject });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  };

  beforeAll(async () => {
    ({ dovecot, connectedAccountId, messageChannelId } =
      await connectDovecotImapAccount({
        handle: HANDLE,
        password: PASSWORD,
      }));
  }, 300000);

  afterAll(async () => {
    await updateConfigVariable({
      input: { key: 'OUTBOUND_HTTP_ALLOWED_INTERNAL_HOSTS', value: [] },
    }).catch(() => undefined);

    if (isNonEmptyString(connectedAccountId)) {
      await deleteConnectedAccount({
        id: connectedAccountId,
        expectToFail: false,
      }).catch(() => undefined);
    }

    await dovecot?.stop().catch(() => undefined);
  });

  // Mail clients save a draft as a new message and expunge the previous one.
  it('removes a draft that the mail client replaced with a newer save', async () => {
    const firstSave = `IMAP draft first save ${randomUUID()}`;
    const secondSave = `IMAP draft second save ${randomUUID()}`;

    await saveMessage({ subject: firstSave, folder: 'Drafts' });
    await runMessageChannelSync(messageChannelId);

    expect(await findImportedMessageSubjects([firstSave])).toEqual([firstSave]);

    await saveMessage({ subject: secondSave, folder: 'Drafts' });
    await removeMessage({ subject: firstSave, folder: 'Drafts' });
    await runMessageChannelSync(messageChannelId);

    expect(await findImportedMessageSubjects([firstSave, secondSave])).toEqual([
      secondSave,
    ]);
  }, 300000);

  it('removes a draft that was deleted without a newer save', async () => {
    const subject = `IMAP draft deleted ${randomUUID()}`;

    await saveMessage({ subject, folder: 'Drafts' });
    await runMessageChannelSync(messageChannelId);

    expect(await findImportedMessageSubjects([subject])).toEqual([subject]);

    await removeMessage({ subject, folder: 'Drafts' });
    await runMessageChannelSync(messageChannelId);

    expect(await findImportedMessageSubjects([subject])).toEqual([]);
  }, 300000);

  it('keeps a message that was removed from a folder other than drafts', async () => {
    const subject = `IMAP inbox message removed ${randomUUID()}`;

    await saveMessage({ subject, folder: 'INBOX' });
    await runMessageChannelSync(messageChannelId);

    expect(await findImportedMessageSubjects([subject])).toEqual([subject]);

    await removeMessage({ subject, folder: 'INBOX' });
    await runMessageChannelSync(messageChannelId);

    expect(await findImportedMessageSubjects([subject])).toEqual([subject]);
  }, 300000);
});
