import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "JARVIS Chat — NORPIA" },
      {
        name: "description",
        content: "Talk to JARVIS, the NORPIA AI assistant, with saved conversation history.",
      },
      { property: "og:title", content: "JARVIS Chat — NORPIA" },
      {
        property: "og:description",
        content: "Talk to JARVIS, the NORPIA AI assistant, with saved conversation history.",
      },
    ],
  }),
  component: () => <Outlet />,
});
