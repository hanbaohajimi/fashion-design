"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useProjectTaskSource } from "../tasks/project-task-source";
import { PlushCharacter } from "./PlushCharacter";
import { ProjectActivityTracker, type CharacterPresentation, type ChatActivity } from "./project-activity";

export const ZHIYA_ENABLED = process.env.NEXT_PUBLIC_ZHIYA_ENABLED !== "false";

interface Props {
  projectId: string;
  chatOpen: boolean;
  suspended: boolean;
  mobile: boolean;
  chatActivity: ChatActivity;
  onOpenChat: (focusInput: boolean) => void;
  onUnavailable?: () => void;
}

/** Viewport entry for the existing conversation; owns no conversation or execution. */
export function ZhiyaAssistant(props: Props) {
  const { session } = useAuth();
  if (!ZHIYA_ENABLED || !session) return null;
  return <ZhiyaProjectCharacter key={`${session.user.id}:${props.projectId}`} {...props} accountId={session.user.id} />;
}

function ZhiyaProjectCharacter({ accountId, projectId, chatOpen, suspended, mobile, chatActivity, onOpenChat, onUnavailable }: Props & { accountId: string }) {
  const source = useProjectTaskSource();
  const tracker = useRef(new ProjectActivityTracker());
  const [visible, setVisible] = useState(false);
  const [presentation, setPresentation] = useState<CharacterPresentation>({ scene: "idle", status: "idle", label: "", activityKey: "" });
  const data = source?.summary.data;
  const version = source?.summary.dataUpdatedAt ?? 0;
  useEffect(() => {
    tracker.current.setVisible(visible && !chatOpen && !suspended, version);
    setPresentation(tracker.current.observe(data, chatActivity, version));
  }, [data, version, chatActivity, visible, chatOpen, suspended]);
  return <PlushCharacter
    storageKey={`fashion:zhiya:${encodeURIComponent(accountId)}:${encodeURIComponent(projectId)}`}
    presentation={presentation}
    paused={chatOpen || suspended}
    size={mobile ? 72 : 96}
    onOpenChat={onOpenChat}
    onActiveChange={setVisible}
    {...(onUnavailable ? { onUnavailable } : {})}
  />;
}
