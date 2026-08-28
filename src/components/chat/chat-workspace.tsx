import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { ChatMessageBubble, ThinkingBubble } from "@/components/chat/chat-message";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { streamAssistantReply } from "@/lib/chat/ai-client";
import {
  createConversation,
  deleteConversation,
  deriveTitle,
  listConversations,
  listMessages,
  mapChatError,
  renameConversation,
  DEFAULT_CONVERSATION_TITLE,
  type ChatMessage,
} from "@/lib/chat/chat-api";

/** Mirrors MAX_MESSAGE_LENGTH on the server — fail fast, before a round trip. */
const MAX_MESSAGE_LENGTH = 8000;

const SUGGESTIONS = [
  "Summarise what NORPIA should focus on this quarter.",
  "Draft a short project brief for a new internal tool.",
  "Explain this error and how to fix it.",
];

export function ChatWorkspace({ conversationId }: { conversationId?: string | undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamed, setStreamed] = useState("");
  const [failed, setFailed] = useState<{ message: string; content: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  const conversationsQuery = useQuery({
    queryKey: ["conversations"],
    queryFn: listConversations,
  });

  const messagesQuery = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => listMessages(conversationId as string),
    enabled: Boolean(conversationId),
  });

  const messages: ChatMessage[] = messagesQuery.data ?? [];

  useEffect(() => {
    inputRef.current?.focus();
  }, [conversationId, isSending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isSending, streamed]);

  const newConversation = useMutation({
    mutationFn: () => createConversation(),
    onSuccess: async (conversation) => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      void navigate({
        to: "/chat/$conversationId",
        params: { conversationId: conversation.id },
      });
    },
    onError: (error) => toast.error(mapChatError(error)),
  });

  const removeConversation = useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (id === conversationId) void navigate({ to: "/chat" });
    },
    onError: (error) => toast.error(mapChatError(error)),
  });

  /**
   * One send path for both the first attempt and a retry. On retry the message
   * is already persisted server-side, so `retry` tells the API to reuse it
   * instead of inserting a duplicate user message.
   */
  const send = useCallback(
    async (content: string, options: { retry?: boolean } = {}) => {
      if (sendingRef.current) return;
      const trimmed = content.trim();
      if (!trimmed) {
        toast.error("Write a message first.");
        return;
      }
      if (trimmed.length > MAX_MESSAGE_LENGTH) {
        toast.error(`That message is too long (limit ${MAX_MESSAGE_LENGTH} characters).`);
        return;
      }

      sendingRef.current = true;
      setIsSending(true);
      setStreamed("");
      setFailed(null);

      let targetId = conversationId;
      try {
        if (!targetId) {
          const created = await createConversation(deriveTitle(trimmed));
          targetId = created.id;
          await queryClient.invalidateQueries({ queryKey: ["conversations"] });
          await navigate({ to: "/chat/$conversationId", params: { conversationId: targetId } });
        }

        if (!options.retry) setDraft("");

        // Lightweight, local title extraction — no extra model call.
        const current = conversationsQuery.data?.find((c) => c.id === targetId);
        if (current && current.title === DEFAULT_CONVERSATION_TITLE) {
          await renameConversation(targetId, deriveTitle(trimmed));
        }

        if (!options.retry) {
          // Optimistic user bubble; the server is the one that persists it.
          queryClient.setQueryData<ChatMessage[]>(["messages", targetId], (previous) => [
            ...(previous ?? []),
            {
              id: `optimistic-${Date.now()}`,
              conversation_id: targetId as string,
              user_id: "self",
              role: "user",
              content: trimmed,
              metadata: {},
              created_at: new Date().toISOString(),
            },
          ]);
        }

        await streamAssistantReply({
          conversationId: targetId,
          message: trimmed,
          retry: options.retry ?? false,
          onDelta: (text) => setStreamed(text),
        });
      } catch (error) {
        const message = mapChatError(error);
        setFailed({ message, content: trimmed });
        toast.error(message);
      } finally {
        sendingRef.current = false;
        setIsSending(false);
        setStreamed("");
        if (targetId) {
          await queryClient.invalidateQueries({ queryKey: ["messages", targetId] });
        }
        await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      }
    },
    [conversationId, conversationsQuery.data, navigate, queryClient],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send(draft);
    }
  }

  const overLimit = draft.length > MAX_MESSAGE_LENGTH;

  return (
    <AppShell title="JARVIS" description="Your NORPIA AI assistant.">
      <div className="flex flex-col gap-4 md:flex-row">
        <ConversationSidebar
          conversations={conversationsQuery.data ?? []}
          activeId={conversationId}
          isLoading={conversationsQuery.isLoading}
          isCreating={newConversation.isPending}
          onNewConversation={() => newConversation.mutate()}
          onDelete={(id) => removeConversation.mutate(id)}
        />

        <section className="flex min-h-[60vh] flex-1 flex-col rounded-lg border border-border bg-card/20">
          <div className="flex-1 space-y-4 overflow-y-auto p-3 sm:p-4">
            {conversationsQuery.isError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {mapChatError(conversationsQuery.error)}
              </p>
            )}

            {conversationId && messagesQuery.isLoading && (
              <>
                <Skeleton className="h-16 w-2/3" />
                <Skeleton className="ml-auto h-16 w-1/2" />
              </>
            )}

            {conversationId && messagesQuery.isError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <p>{mapChatError(messagesQuery.error)}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void messagesQuery.refetch()}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Reload history
                </Button>
              </div>
            )}

            {!messagesQuery.isLoading && messages.length === 0 && (
              <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
                <p className="text-sm font-semibold text-foreground">
                  {conversationId ? "Say hello to JARVIS" : "Start a new conversation"}
                </p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  Ask a question below. JARVIS remembers the context of this conversation, and
                  everything is private to your account and saved automatically.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      disabled={isSending}
                      onClick={() => void send(suggestion)}
                      className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => (
              <ChatMessageBubble key={message.id} message={message} />
            ))}

            {isSending && streamed && (
              <ChatMessageBubble
                message={{
                  id: "streaming",
                  conversation_id: conversationId ?? "",
                  user_id: "assistant",
                  role: "assistant",
                  content: streamed,
                  metadata: {},
                  created_at: new Date().toISOString(),
                }}
              />
            )}
            {isSending && !streamed && <ThinkingBubble />}

            {failed && !isSending && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <span className="flex-1">{failed.message}</span>
                <Button size="sm" onClick={() => void send(failed.content, { retry: true })}>
                  <RefreshCw className="mr-2 h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <Textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSending}
                rows={2}
                placeholder="Message JARVIS…  (Enter to send, Shift + Enter for a new line)"
                className="min-h-[56px] resize-none"
                aria-label="Message JARVIS"
              />
              <Button
                onClick={() => void send(draft)}
                disabled={isSending || !draft.trim() || overLimit}
              >
                {isSending ? "Sending…" : "Send"}
              </Button>
            </div>
            <p
              className={
                overLimit
                  ? "mt-1 text-[11px] text-destructive"
                  : "mt-1 text-[11px] text-muted-foreground"
              }
            >
              {overLimit
                ? `Too long — ${draft.length} / ${MAX_MESSAGE_LENGTH} characters.`
                : `${draft.length} / ${MAX_MESSAGE_LENGTH} characters`}
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
