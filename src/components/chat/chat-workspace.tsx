import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { ChatMessageBubble, ThinkingBubble } from "@/components/chat/chat-message";
import { ConversationSidebar } from "@/components/chat/conversation-sidebar";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  buildConversationContext,
  createConversation,
  createMessage,
  deleteConversation,
  deriveTitle,
  listConversations,
  listMessages,
  mapChatError,
  renameConversation,
  DEFAULT_CONVERSATION_TITLE,
  type ChatMessage,
} from "@/lib/chat/chat-api";

const PENDING_ASSISTANT_NOTICE =
  "OpenAI is not connected yet (Week 4, prompt 2). Your message has been saved and JARVIS will answer once the model is wired up.";

export function ChatWorkspace({ conversationId }: { conversationId?: string | undefined }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

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
  }, [messages.length, isSending]);

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

  async function handleSend() {
    const content = draft.trim();
    if (!content) {
      toast.error("Write a message first.");
      return;
    }
    if (isSending) return;

    setIsSending(true);
    try {
      let targetId = conversationId;
      if (!targetId) {
        const created = await createConversation(deriveTitle(content));
        targetId = created.id;
        await queryClient.invalidateQueries({ queryKey: ["conversations"] });
        await navigate({ to: "/chat/$conversationId", params: { conversationId: targetId } });
      }

      await createMessage({ conversationId: targetId, role: "user", content });
      setDraft("");

      const history = await listMessages(targetId);
      queryClient.setQueryData(["messages", targetId], history);

      // Rename a still-default conversation after its first user message.
      const current = conversationsQuery.data?.find((c) => c.id === targetId);
      if (!current || current.title === DEFAULT_CONVERSATION_TITLE) {
        await renameConversation(targetId, deriveTitle(content));
      }

      // Context payload the OpenAI call (prompt 2) will consume.
      const context = buildConversationContext(history, {
        systemPrompt: "You are JARVIS, the NORPIA AI operating system assistant.",
      });
      void context;

      await createMessage({
        conversationId: targetId,
        role: "assistant",
        content: PENDING_ASSISTANT_NOTICE,
        metadata: { placeholder: true },
      });

      await queryClient.invalidateQueries({ queryKey: ["messages", targetId] });
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (error) {
      toast.error(mapChatError(error));
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

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
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
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
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                {mapChatError(messagesQuery.error)}
              </p>
            )}

            {!messagesQuery.isLoading && messages.length === 0 && (
              <div className="flex h-full min-h-[40vh] flex-col items-center justify-center text-center">
                <p className="text-sm font-semibold text-foreground">
                  {conversationId ? "Say hello to JARVIS" : "Start a new conversation"}
                </p>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  Ask a question below. Your conversations are private to your account and saved
                  automatically.
                </p>
              </div>
            )}

            {messages.map((message) => (
              <ChatMessageBubble key={message.id} message={message} />
            ))}

            {isSending && <ThinkingBubble />}
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
              <Button onClick={() => void handleSend()} disabled={isSending || !draft.trim()}>
                {isSending ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
