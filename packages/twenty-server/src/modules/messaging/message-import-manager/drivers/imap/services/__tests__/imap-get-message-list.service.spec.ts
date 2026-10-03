import { type ImapFlow, type ListResponse } from 'imapflow';
import {
  ConnectedAccountProvider,
  MessageFolderImportPolicy,
  MessageFolderPendingSyncAction,
} from 'twenty-shared/types';

import { type MessageFolder } from 'src/modules/messaging/message-folder-manager/interfaces/message-folder-driver.interface';
import { type ImapClientProvider } from 'src/modules/messaging/message-import-manager/drivers/imap/providers/imap-client.provider';
import { ImapFindDraftsFolderService } from 'src/modules/messaging/message-import-manager/drivers/imap/services/imap-find-drafts-folder.service';
import { ImapGetMessageListService } from 'src/modules/messaging/message-import-manager/drivers/imap/services/imap-get-message-list.service';
import { type ImapMessageListFetchErrorHandler } from 'src/modules/messaging/message-import-manager/drivers/imap/services/imap-message-list-fetch-error-handler.service';
import { ImapSyncService } from 'src/modules/messaging/message-import-manager/drivers/imap/services/imap-sync.service';
import { type ImapSyncCursor } from 'src/modules/messaging/message-import-manager/drivers/imap/utils/parse-sync-cursor.util';

type MailboxOnServer = {
  uidNext: number;
  messageUids: number[] | false;
  messageCount?: number;
  mailboxes?: Pick<ListResponse, 'name' | 'path' | 'specialUse'>[];
};

const UID_VALIDITY = 1752657694;

const createFolder = (
  name: string,
  syncCursor: ImapSyncCursor | null,
): MessageFolder => ({
  id: `${name}-folder-id`,
  name,
  isSynced: true,
  isSentFolder: false,
  externalId: `${name}:${UID_VALIDITY}`,
  parentFolderId: null,
  syncCursor: syncCursor ? JSON.stringify(syncCursor) : null,
  pendingSyncAction: MessageFolderPendingSyncAction.NONE,
});

const createClient = ({
  uidNext,
  messageUids,
  messageCount,
  mailboxes = [
    { name: 'INBOX', path: 'INBOX' },
    { name: 'Drafts', path: 'Drafts', specialUse: '\\Drafts' },
  ],
}: MailboxOnServer) => {
  const exists =
    messageCount ?? (Array.isArray(messageUids) ? messageUids.length : 0);

  return {
    capabilities: new Set<string>(),
    enabled: new Set<string>(),
    list: jest.fn().mockResolvedValue(mailboxes),
    status: jest.fn().mockResolvedValue({
      messages: exists,
      uidNext,
      uidValidity: BigInt(UID_VALIDITY),
    }),
    getMailboxLock: jest.fn().mockResolvedValue({ release: jest.fn() }),
    mailbox: { uidValidity: BigInt(UID_VALIDITY), uidNext, exists },
    search: jest.fn().mockImplementation((query: { uid?: string }) => {
      if (!Array.isArray(messageUids) || !('uid' in query)) {
        return Promise.resolve(messageUids);
      }

      const [firstUid, lastUid] = String(query.uid).split(':').map(Number);

      return Promise.resolve(
        messageUids.filter((uid) => uid >= firstUid && uid <= lastUid),
      );
    }),
  };
};

const getMessageList = async (
  folder: MessageFolder,
  mailboxOnServer: MailboxOnServer,
) => {
  const client = createClient(mailboxOnServer);

  const service = new ImapGetMessageListService(
    {
      getClient: jest.fn().mockResolvedValue(client as unknown as ImapFlow),
      closeClient: jest.fn(),
    } as unknown as ImapClientProvider,
    new ImapSyncService(),
    { handleError: jest.fn() } as unknown as ImapMessageListFetchErrorHandler,
    new ImapFindDraftsFolderService(),
  );

  const [messageList] = await service.getMessageLists({
    connectedAccount: {
      id: 'connected-account-id',
      provider: ConnectedAccountProvider.IMAP_SMTP_CALDAV,
      handle: 'user@example.com',
    },
    messageChannel: {
      id: 'message-channel-id',
      messageFolderImportPolicy: MessageFolderImportPolicy.ALL_FOLDERS,
      syncCursor: null,
    },
    messageFolders: [folder],
  });

  return {
    messageList,
    nextCursor: JSON.parse(messageList.nextSyncCursor) as ImapSyncCursor,
    client,
  };
};

describe('ImapGetMessageListService', () => {
  describe('drafts folder', () => {
    it('lists the folder when a draft was saved again under a new UID', async () => {
      const folder = createFolder('Drafts', {
        highestUid: 2884,
        uidValidity: UID_VALIDITY,
        messageCount: 1,
      });

      const { messageList, nextCursor } = await getMessageList(folder, {
        uidNext: 2887,
        messageUids: [2886],
      });

      expect(messageList.messageExternalIds).toEqual(['Drafts:2886']);
      expect(messageList.messageExternalIdsInFolder).toEqual(['Drafts:2886']);
      expect(nextCursor).toEqual({
        highestUid: 2886,
        uidValidity: UID_VALIDITY,
        messageCount: 1,
      });
    });

    it('lists an empty folder when the last draft was removed and no UID was added', async () => {
      const folder = createFolder('Drafts', {
        highestUid: 2886,
        uidValidity: UID_VALIDITY,
        messageCount: 1,
      });

      const { messageList, nextCursor, client } = await getMessageList(folder, {
        uidNext: 2887,
        messageUids: [],
      });

      expect(messageList.messageExternalIds).toEqual([]);
      expect(messageList.messageExternalIdsInFolder).toEqual([]);
      expect(nextCursor.messageCount).toBe(0);
      expect(client.search).not.toHaveBeenCalled();
    });

    it('lists the folder once for a cursor saved before the message count was tracked', async () => {
      const folder = createFolder('Drafts', {
        highestUid: 2886,
        uidValidity: UID_VALIDITY,
      });

      const { messageList, nextCursor } = await getMessageList(folder, {
        uidNext: 2887,
        messageUids: [2880, 2886],
      });

      expect(messageList.messageExternalIds).toEqual([]);
      expect(messageList.messageExternalIdsInFolder).toEqual([
        'Drafts:2880',
        'Drafts:2886',
      ]);
      expect(nextCursor.messageCount).toBe(2);
    });

    it('does not list the folder when drafts were only added', async () => {
      const folder = createFolder('Drafts', {
        highestUid: 2886,
        uidValidity: UID_VALIDITY,
        messageCount: 1,
      });

      const { messageList, nextCursor, client } = await getMessageList(folder, {
        uidNext: 2888,
        messageUids: [2886, 2887],
      });

      expect(messageList.messageExternalIds).toEqual(['Drafts:2887']);
      expect(messageList.messageExternalIdsInFolder).toBeUndefined();
      expect(nextCursor.messageCount).toBe(2);
      expect(client.search).toHaveBeenCalledTimes(1);
    });

    it('skips the folder when nothing changed', async () => {
      const folder = createFolder('Drafts', {
        highestUid: 2886,
        uidValidity: UID_VALIDITY,
        messageCount: 1,
      });

      const { messageList, client } = await getMessageList(folder, {
        uidNext: 2887,
        messageUids: [2886],
      });

      expect(messageList.messageExternalIdsInFolder).toBeUndefined();
      expect(messageList.nextSyncCursor).toBe(folder.syncCursor);
      expect(client.getMailboxLock).not.toHaveBeenCalled();
    });

    it('reports no folder list and retries later when the server gives no usable search result', async () => {
      const folder = createFolder('Drafts', {
        highestUid: 2886,
        uidValidity: UID_VALIDITY,
        messageCount: 2,
      });

      const { messageList, nextCursor } = await getMessageList(folder, {
        uidNext: 2887,
        messageUids: false,
        messageCount: 1,
      });

      expect(messageList.messageExternalIdsInFolder).toBeUndefined();
      expect(nextCursor.messageCount).toBe(2);
    });

    it('lists the folder the server flags as drafts, whatever its name', async () => {
      const folder = createFolder('Unfinished', {
        highestUid: 2884,
        uidValidity: UID_VALIDITY,
        messageCount: 1,
      });

      const { messageList } = await getMessageList(folder, {
        uidNext: 2887,
        messageUids: [2886],
        mailboxes: [
          { name: 'Unfinished', path: 'Unfinished', specialUse: '\\Drafts' },
        ],
      });

      expect(messageList.messageExternalIdsInFolder).toEqual([
        'Unfinished:2886',
      ]);
    });

    it('falls back to the folder name when the server flags no drafts folder', async () => {
      const folder = createFolder('Drafts', {
        highestUid: 2884,
        uidValidity: UID_VALIDITY,
        messageCount: 1,
      });

      const { messageList } = await getMessageList(folder, {
        uidNext: 2887,
        messageUids: [2886],
        mailboxes: [{ name: 'Drafts', path: 'Drafts' }],
      });

      expect(messageList.messageExternalIdsInFolder).toEqual(['Drafts:2886']);
    });
  });

  describe('other folders', () => {
    it('never lists the folder, so removed mail stays in the CRM', async () => {
      const folder = createFolder('INBOX', {
        highestUid: 50,
        uidValidity: UID_VALIDITY,
        messageCount: 40,
      });

      const { messageList } = await getMessageList(folder, {
        uidNext: 52,
        messageUids: [51],
      });

      expect(messageList.messageExternalIds).toEqual(['INBOX:51']);
      expect(messageList.messageExternalIdsToDelete).toEqual([]);
      expect(messageList.messageExternalIdsInFolder).toBeUndefined();
    });

    it('never lists a folder named like drafts when the server flags another one', async () => {
      const folder = createFolder('Contract drafts', {
        highestUid: 50,
        uidValidity: UID_VALIDITY,
        messageCount: 40,
      });

      const { messageList } = await getMessageList(folder, {
        uidNext: 52,
        messageUids: [51],
        mailboxes: [
          { name: 'Contract drafts', path: 'Contract drafts' },
          { name: 'Drafts', path: 'Drafts', specialUse: '\\Drafts' },
        ],
      });

      expect(messageList.messageExternalIds).toEqual(['Contract drafts:51']);
      expect(messageList.messageExternalIdsInFolder).toBeUndefined();
    });

    it('still skips the folder when mail was only removed', async () => {
      const folder = createFolder('INBOX', {
        highestUid: 50,
        uidValidity: UID_VALIDITY,
        messageCount: 40,
      });

      const { client } = await getMessageList(folder, {
        uidNext: 51,
        messageUids: [50],
      });

      expect(client.getMailboxLock).not.toHaveBeenCalled();
    });
  });
});
