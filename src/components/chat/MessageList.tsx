"use client";

import { Message } from "ai";
import { cn } from "@/lib/utils";
import { User, Bot, Loader2, FilePlus, FilePen, Trash2, FileSymlink } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
}

type FileActivityAction = "Created" | "Modified" | "Renamed" | "Deleted";

interface FileActivity {
  action: FileActivityAction;
  filename: string;
  fullPath: string;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  str_replace_editor: "editing files",
  file_manager: "managing files",
};

function getFileActivity(parts: Message["parts"]): FileActivity[] {
  if (!parts) return [];

  const results: FileActivity[] = [];

  for (const part of parts) {
    if (part.type !== "tool-invocation") continue;
    const { toolName, args, state } = part.toolInvocation;
    if (state !== "result") continue;

    const command: string = args?.command ?? "";
    const path: string = args?.path ?? "";
    let action: FileActivityAction | null = null;

    if (toolName === "str_replace_editor") {
      if (command === "create") action = "Created";
      else if (command === "str_replace" || command === "insert") action = "Modified";
    } else if (toolName === "file_manager") {
      if (command === "rename") action = "Renamed";
      else if (command === "delete") action = "Deleted";
    }

    if (action && path) {
      results.push({
        action,
        filename: path.split("/").pop() || path,
        fullPath: path,
      });
    }
  }

  // Deduplicate by path — "Created" takes priority over a later "Modified"
  const seen = new Map<string, FileActivity>();
  for (const item of results) {
    const existing = seen.get(item.fullPath);
    if (!existing || existing.action !== "Created") {
      seen.set(item.fullPath, item);
    }
  }

  return Array.from(seen.values());
}

function getLastTextPart(parts: Message["parts"]): string | null {
  if (!parts) return null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.type === "text" && part.text.trim()) return part.text;
  }
  return null;
}

function getActiveToolName(parts: Message["parts"]): string | null {
  if (!parts) return null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.type === "tool-invocation" && part.toolInvocation.state === "call") {
      return part.toolInvocation.toolName;
    }
  }
  return null;
}

const ACTION_ICONS: Record<FileActivityAction, React.ReactNode> = {
  Created: <FilePlus className="h-3.5 w-3.5 text-emerald-500" />,
  Modified: <FilePen className="h-3.5 w-3.5 text-blue-500" />,
  Renamed: <FileSymlink className="h-3.5 w-3.5 text-amber-500" />,
  Deleted: <Trash2 className="h-3.5 w-3.5 text-red-400" />,
};

function ActivitySection({ items }: { items: FileActivity[] }) {
  return (
    <div className="mb-3 pb-3 border-b border-neutral-100">
      <p className="text-xs text-neutral-400 mb-1.5">
        Files changed ({items.length})
      </p>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <div key={item.fullPath} className="flex items-center gap-2 text-xs">
            {ACTION_ICONS[item.action]}
            <span className="w-16 text-neutral-500 shrink-0">{item.action}</span>
            <span
              className="font-mono text-neutral-700 truncate"
              title={item.fullPath}
            >
              {item.filename}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MessageList({ messages, isLoading }: MessageListProps) {
  return (
    <div className="flex flex-col h-full overflow-y-auto px-4 py-6">
      <div className="space-y-6 max-w-4xl mx-auto w-full">
        {messages.map((message, messageIndex) => {
          const isLastMessage = messageIndex === messages.length - 1;
          const isStreaming = isLoading && isLastMessage && message.role === "assistant";

          return (
            <div
              key={message.id || message.content}
              className={cn(
                "flex gap-4",
                message.role === "user" ? "justify-end" : "justify-start"
              )}
            >
              {message.role === "assistant" && (
                <div className="flex-shrink-0">
                  <div className="w-9 h-9 rounded-lg bg-white border border-neutral-200 shadow-sm flex items-center justify-center">
                    <Bot className="h-4.5 w-4.5 text-neutral-700" />
                  </div>
                </div>
              )}

              <div
                className={cn(
                  "flex flex-col gap-2 max-w-[85%]",
                  message.role === "user" ? "items-end" : "items-start"
                )}
              >
                <div
                  className={cn(
                    "rounded-xl px-4 py-3",
                    message.role === "user"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "bg-white text-neutral-900 border border-neutral-200 shadow-sm"
                  )}
                >
                  <div className="text-sm">
                    {message.role === "assistant" ? (
                      <>
                        {isStreaming ? (
                          // Streaming: show spinner with active tool label
                          <div className="flex items-center gap-2 text-neutral-500 py-1">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                            <span className="text-sm">
                              {(() => {
                                const toolName = getActiveToolName(message.parts);
                                const label = toolName ? TOOL_DISPLAY_NAMES[toolName] ?? toolName : null;
                                return label ? `Working · ${label}` : "Working...";
                              })()}
                            </span>
                          </div>
                        ) : message.parts ? (
                          // Completed: show file activity + last text part
                          <>
                            {(() => {
                              const fileActivity = getFileActivity(message.parts);
                              const lastText = getLastTextPart(message.parts) ?? message.content;
                              return (
                                <>
                                  {fileActivity.length > 0 && <ActivitySection items={fileActivity} />}
                                  {lastText && (
                                    <MarkdownRenderer content={lastText} className="prose-sm" />
                                  )}
                                </>
                              );
                            })()}
                          </>
                        ) : message.content ? (
                          <MarkdownRenderer content={message.content} className="prose-sm" />
                        ) : null}
                      </>
                    ) : (
                      // User message
                      <span className="whitespace-pre-wrap">{message.content}</span>
                    )}
                  </div>
                </div>
              </div>

              {message.role === "user" && (
                <div className="flex-shrink-0">
                  <div className="w-9 h-9 rounded-lg bg-blue-600 shadow-sm flex items-center justify-center">
                    <User className="h-4.5 w-4.5 text-white" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
