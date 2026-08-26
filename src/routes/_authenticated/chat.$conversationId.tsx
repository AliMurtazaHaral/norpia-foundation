import { createFileRoute, useParams } from "@tanstack/react-router";

import { ChatWorkspace } from "@/components/chat/chat-workspace";

export const Route = createFileRoute("/_authenticated/chat/$conversationId")({
  component: ChatConversationPage,
});

function ChatConversationPage() {
  const { conversationId } = useParams({ from: "/_authenticated/chat/$conversationId" });
  return <ChatWorkspace key={conversationId} conversationId={conversationId} />;
}
