import { createFileRoute } from "@tanstack/react-router";

import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: () => <ChatWorkspace />,
});
