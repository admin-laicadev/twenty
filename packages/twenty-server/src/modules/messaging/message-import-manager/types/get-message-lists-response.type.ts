export type GetOneMessageListResponse = {
  messageExternalIds: string[];
  messageExternalIdsToDelete: string[];
  previousSyncCursor: string | null;
  nextSyncCursor: string;
  folderId: string | undefined;
  // Complete list of the folder's messages on the provider. When set, messages
  // of that folder missing from it are deleted. IMAP has no deletion feed, so
  // the driver can only report what is left.
  messageExternalIdsInFolder?: string[];
};

export type GetMessageListsResponse = Array<GetOneMessageListResponse>;
