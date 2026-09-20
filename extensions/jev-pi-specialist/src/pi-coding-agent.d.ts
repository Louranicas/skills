declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionContext {
    cwd: string;
    hasUI: boolean;
    ui: {
      confirm: (title: string, message: string) => Promise<boolean>;
      notify: (message: string, level?: string) => void;
    };
    sessionManager: {
      getEntries: () => Array<unknown>;
    };
  }

  export interface ExtensionAPI {
    on(
      event: "tool_call",
      handler: (
        event: { toolName: string; input: Record<string, unknown> },
        ctx: ExtensionContext,
      ) => unknown | Promise<unknown>,
    ): void;
    on(
      event: "before_agent_start",
      handler: (
        event: {
          prompt: string;
          systemPrompt: string;
          systemPromptOptions?: { skills?: Array<{ name?: string; description?: string; content?: string }> };
        },
        ctx: ExtensionContext,
      ) => unknown | Promise<unknown>,
    ): void;
    on(event: string, handler: (...args: never[]) => unknown): void;
    appendEntry(customType: string, data?: unknown): void;
    registerTool(def: {
      name: string;
      label?: string;
      description: string;
      parameters: unknown;
      execute: (
        toolCallId: string,
        params: Record<string, unknown>,
        signal: AbortSignal,
        onUpdate: unknown,
        ctx: ExtensionContext,
      ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
    }): void;
    registerCommand(
      name: string,
      def: {
        description: string;
        handler: (args: string, ctx: ExtensionContext) => unknown | Promise<unknown>;
      },
    ): void;
  }
}
