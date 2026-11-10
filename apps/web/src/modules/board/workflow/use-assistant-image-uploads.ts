"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import {
  AssistantImageUploadQueue,
  type ImageUploadActions,
  type ImageUploadContext,
} from "./assistant-image-uploads";

const unavailable = async (): Promise<never> => {
  throw new Error("图片上传尚未准备好。");
};
const inactive: ImageUploadActions = {
  enabled: false,
  slots: 0,
  beforeImport: unavailable,
  apply: unavailable,
  reference: unavailable,
};
export function useAssistantImageUploads(
  context: ImageUploadContext,
  actions: ImageUploadActions,
) {
  const { accountId, projectId, editor, conversationId } = context;
  const queue = useMemo(
    () =>
      new AssistantImageUploadQueue(
        { accountId, projectId, editor, conversationId },
        () => inactive,
      ),
    [accountId, projectId, editor, conversationId],
  );
  useLayoutEffect(() => {
    queue.configure(actions);
  }, [queue, actions]);
  // Account/conversation changes invalidate completions before the next paint.
  useLayoutEffect(() => () => queue.deactivate(), [queue]);
  useEffect(() => {
    if (accountId) void queue.activate();
    return () => queue.deactivate();
  }, [queue, accountId]);
  const state = useSyncExternalStore(
    queue.subscribe,
    queue.snapshot,
    queue.snapshot,
  );
  return { ...state, queue };
}
