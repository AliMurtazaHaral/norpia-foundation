import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageRow } from "@/lib/chat/chat-api";

function formatTime(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

/**
 * Markdown rendering is safe by default: react-markdown escapes raw HTML and
 * we deliberately do NOT enable rehype-raw / dangerouslySetInnerHTML.
 */
export function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-sm leading-relaxed [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-1">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a
              {...props}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2"
            />
          ),
          code: ({ node: _node, className, children, ...props }) => {
            const isBlock = /language-/.test(className ?? "");
            if (!isBlock) {
              return (
                <code
                  className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code className={cn("font-mono text-[0.8em]", className)} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ node: _node, ...props }) => (
            <pre
              {...props}
              className="overflow-x-auto rounded-lg border border-border bg-background/70 p-3"
            />
          ),
          blockquote: ({ node: _node, ...props }) => (
            <blockquote
              {...props}
              className="border-l-2 border-primary/60 pl-3 text-muted-foreground"
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function ChatMessageBubble({ message }: { message: ChatMessageRow }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  if (isSystem) {
    return (
      <div className="mx-auto max-w-2xl rounded-md border border-border/60 bg-secondary/40 px-3 py-2 text-center text-xs text-muted-foreground">
        {message.content}
      </div>
    );
  }

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[85%] space-y-1", isUser && "text-right")}>
        <div
          className={cn(
            "inline-block rounded-2xl px-4 py-3 text-left",
            isUser
              ? "rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-bl-sm border border-border bg-card text-card-foreground",
          )}
        >
          <MarkdownContent content={message.content} />
        </div>
        <p className="px-1 text-[11px] text-muted-foreground">
          {isUser ? "You" : "JARVIS"} · {formatTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}

export function ThinkingBubble() {
  return (
    <div className="flex justify-start">
      <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <span className="flex gap-1">
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
        </span>
        JARVIS is thinking…
      </div>
    </div>
  );
}
