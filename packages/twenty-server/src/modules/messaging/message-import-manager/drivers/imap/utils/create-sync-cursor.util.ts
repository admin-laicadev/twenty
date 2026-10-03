import { isDefined } from 'twenty-shared/utils';

import { type MailboxState } from './extract-mailbox-state.util';
import { type ImapSyncCursor } from './parse-sync-cursor.util';

export const createSyncCursor = (
  messageUids: number[],
  previousCursor: ImapSyncCursor | null,
  mailboxState: MailboxState,
): ImapSyncCursor => {
  const { uidValidity, highestModSeq, messageCount } = mailboxState;
  const lastSeenUid = previousCursor?.highestUid ?? 0;

  let highestUid = lastSeenUid;

  for (let i = 0; i < messageUids.length; i++) {
    if (messageUids[i] > highestUid) {
      highestUid = messageUids[i];
    }
  }

  return {
    highestUid,
    uidValidity,
    ...(highestModSeq ? { modSeq: highestModSeq.toString() } : {}),
    ...(isDefined(messageCount) ? { messageCount } : {}),
  };
};
