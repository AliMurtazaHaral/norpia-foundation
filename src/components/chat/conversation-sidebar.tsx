import { Link } from "@tanstack/react-router";
import { MessageSquarePlus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/lib/chat/chat-api";

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ConversationSidebar({
  conversations,
  activeId,
  isLoading,
  isCreating,
  onNewConversation,
  onDelete,
}: {
  conversations: Conversation[];
  activeId?: string | undefined;
  isLoading: boolean;
  isCreating: boolean;
  onNewConversation: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 rounded-lg border border-border bg-card/40 p-3 md:w-72">
      <Button className="w-full" onClick={onNewConversation} disabled={isCreating}>
        <MessageSquarePlus className="mr-2 h-4 w-4" />
        {isCreating ? "Creating…" : "New conversation"}
      </Button>

      <nav aria-label="Conversations" className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
        {isLoading && (
          <>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </>
        )}

        {!isLoading && conversations.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            No conversations yet. Start one above.
          </p>
        )}

        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={cn(
              "group flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-secondary",
              conversation.id === activeId && "bg-secondary",
            )}
          >
            <Link
              to="/chat/$conversationId"
              params={{ conversationId: conversation.id }}
              className="min-w-0 flex-1 px-2 py-2"
            >
              <p className="truncate text-sm text-foreground">{conversation.title}</p>
              <p className="text-[11px] text-muted-foreground">
                {relativeTime(conversation.updated_at)}
              </p>
            </Link>
            <button
              type="button"
              aria-label={`Delete ${conversation.title}`}
              onClick={() => onDelete(conversation.id)}
              className="rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}
