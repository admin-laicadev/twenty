import { type FindOperator } from 'typeorm';

import { type WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { MessagingMessageListFetchService } from 'src/modules/messaging/message-import-manager/services/messaging-message-list-fetch.service';
import { type GetMessageListsResponse } from 'src/modules/messaging/message-import-manager/types/get-message-lists-response.type';

type FolderAssociation = {
  id: string;
  messageFolderId: string;
  messageChannelMessageAssociationId: string;
};

type MessageChannelMessageAssociation = {
  id: string;
  messageChannelId: string;
  messageExternalId: string;
};

const MESSAGE_CHANNEL_ID = 'message-channel-id';

const createMessageList = (
  folderId: string,
  messageExternalIdsInFolder?: string[],
): GetMessageListsResponse[number] => ({
  folderId,
  messageExternalIds: [],
  messageExternalIdsToDelete: [],
  previousSyncCursor: '',
  nextSyncCursor: '',
  ...(messageExternalIdsInFolder ? { messageExternalIdsInFolder } : {}),
});

const computeMessageExternalIdsMissingFromFolders = async (
  folderAssociations: FolderAssociation[],
  messageChannelMessageAssociations: MessageChannelMessageAssociation[],
  messageLists: GetMessageListsResponse,
) => {
  const folderAssociationRepository = {
    find: jest
      .fn()
      .mockImplementation(
        ({
          where,
          take,
        }: {
          where: { messageFolderId: string; id?: FindOperator<string> };
          take: number;
        }) =>
          Promise.resolve(
            folderAssociations
              .filter(
                (folderAssociation) =>
                  folderAssociation.messageFolderId === where.messageFolderId &&
                  (!where.id || folderAssociation.id > where.id.value),
              )
              .sort((a, b) => a.id.localeCompare(b.id))
              .slice(0, take),
          ),
      ),
  };

  const messageChannelMessageAssociationRepository = {
    find: jest
      .fn()
      .mockImplementation(
        ({
          where,
        }: {
          where: { id: FindOperator<string[]>; messageChannelId: string };
        }) =>
          Promise.resolve(
            messageChannelMessageAssociations.filter(
              (messageChannelMessageAssociation) =>
                (where.id.value as unknown as string[]).includes(
                  messageChannelMessageAssociation.id,
                ) &&
                messageChannelMessageAssociation.messageChannelId ===
                  where.messageChannelId,
            ),
          ),
      ),
  };

  const workspaceOrmManager = {
    getRepository: jest
      .fn()
      .mockImplementation((objectName: string) =>
        objectName === 'messageChannelMessageAssociationMessageFolder'
          ? folderAssociationRepository
          : messageChannelMessageAssociationRepository,
      ),
  } as unknown as WorkspaceOrmManager;

  const service = new (MessagingMessageListFetchService as unknown as new (
    ...args: unknown[]
  ) => MessagingMessageListFetchService)(
    undefined,
    undefined,
    workspaceOrmManager,
  );

  const messageExternalIds = await service[
    'computeMessageExternalIdsMissingFromFolders'
  ]({ id: MESSAGE_CHANNEL_ID }, messageLists);

  return { messageExternalIds, folderAssociationRepository };
};

describe('MessagingMessageListFetchService', () => {
  describe('computeMessageExternalIdsMissingFromFolders', () => {
    it('returns the messages of the folder that the provider no longer lists', async () => {
      const { messageExternalIds } =
        await computeMessageExternalIdsMissingFromFolders(
          [
            {
              id: 'a',
              messageFolderId: 'drafts',
              messageChannelMessageAssociationId: 'association-1',
            },
            {
              id: 'b',
              messageFolderId: 'drafts',
              messageChannelMessageAssociationId: 'association-2',
            },
            {
              id: 'c',
              messageFolderId: 'inbox',
              messageChannelMessageAssociationId: 'association-3',
            },
          ],
          [
            {
              id: 'association-1',
              messageChannelId: MESSAGE_CHANNEL_ID,
              messageExternalId: 'Drafts:2884',
            },
            {
              id: 'association-2',
              messageChannelId: MESSAGE_CHANNEL_ID,
              messageExternalId: 'Drafts:2886',
            },
            {
              id: 'association-3',
              messageChannelId: MESSAGE_CHANNEL_ID,
              messageExternalId: 'INBOX:12',
            },
          ],
          [createMessageList('drafts', ['Drafts:2886'])],
        );

      expect(messageExternalIds).toEqual(['Drafts:2884']);
    });

    it('does not read folders that come without a complete list', async () => {
      const { messageExternalIds, folderAssociationRepository } =
        await computeMessageExternalIdsMissingFromFolders(
          [
            {
              id: 'a',
              messageFolderId: 'inbox',
              messageChannelMessageAssociationId: 'association-1',
            },
          ],
          [
            {
              id: 'association-1',
              messageChannelId: MESSAGE_CHANNEL_ID,
              messageExternalId: 'INBOX:12',
            },
          ],
          [createMessageList('inbox')],
        );

      expect(messageExternalIds).toEqual([]);
      expect(folderAssociationRepository.find).not.toHaveBeenCalled();
    });

    it('returns every message of the folder when the provider lists none', async () => {
      const { messageExternalIds } =
        await computeMessageExternalIdsMissingFromFolders(
          [
            {
              id: 'a',
              messageFolderId: 'drafts',
              messageChannelMessageAssociationId: 'association-1',
            },
          ],
          [
            {
              id: 'association-1',
              messageChannelId: MESSAGE_CHANNEL_ID,
              messageExternalId: 'Drafts:2886',
            },
          ],
          [createMessageList('drafts', [])],
        );

      expect(messageExternalIds).toEqual(['Drafts:2886']);
    });

    it('ignores messages of another message channel', async () => {
      const { messageExternalIds } =
        await computeMessageExternalIdsMissingFromFolders(
          [
            {
              id: 'a',
              messageFolderId: 'drafts',
              messageChannelMessageAssociationId: 'association-1',
            },
          ],
          [
            {
              id: 'association-1',
              messageChannelId: 'other-message-channel-id',
              messageExternalId: 'Drafts:2884',
            },
          ],
          [createMessageList('drafts', [])],
        );

      expect(messageExternalIds).toEqual([]);
    });

    it('reads a folder that is larger than one page', async () => {
      const ids = Array.from({ length: 450 }, (_, index) =>
        String(index).padStart(4, '0'),
      );

      const { messageExternalIds, folderAssociationRepository } =
        await computeMessageExternalIdsMissingFromFolders(
          ids.map((id) => ({
            id,
            messageFolderId: 'drafts',
            messageChannelMessageAssociationId: `association-${id}`,
          })),
          ids.map((id) => ({
            id: `association-${id}`,
            messageChannelId: MESSAGE_CHANNEL_ID,
            messageExternalId: `Drafts:${id}`,
          })),
          [createMessageList('drafts', ['Drafts:0449'])],
        );

      expect(messageExternalIds).toHaveLength(449);
      expect(messageExternalIds).not.toContain('Drafts:0449');
      expect(folderAssociationRepository.find).toHaveBeenCalledTimes(3);
    });
  });
});
