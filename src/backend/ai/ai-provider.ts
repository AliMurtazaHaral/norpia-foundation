/**
 * AI Layer — provider-agnostic contracts.
 *
 * The UI never imports a model SDK. It calls the API, the API calls a service,
 * the service resolves an `AiProvider` from the registry. Swapping OpenAI for
 * Anthropic (or Lovable AI Gateway) is a registry change, nothing more.
 */

export type AiCapability = "chat" | "embedding" | "image" | "speech-to-text" | "text-to-speech";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiCompletionRequest {
  model?: string;
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface AiCompletionResult {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  readonly capabilities: AiCapability[];
  /** Configured = credentials present. Week 2 providers report false. */
  isConfigured(): boolean;
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
}

export interface AiProviderDescriptor {
  id: string;
  label: string;
  capabilities: AiCapability[];
  status: "planned" | "configured" | "unavailable";
}
