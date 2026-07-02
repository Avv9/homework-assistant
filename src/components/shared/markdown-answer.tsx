"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "next-themes";
import { Check, Copy } from "lucide-react";
import "katex/dist/katex.min.css";

function CodeBlock({ className, children }: { className?: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const { resolvedTheme } = useTheme();
  const match = /language-(\w+)/.exec(className ?? "");
  const code = String(children).replace(/\n$/, "");

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="relative my-3 overflow-hidden rounded-md border border-border">
      <button
        onClick={copy}
        className="absolute top-2 end-2 z-10 flex items-center gap-1 rounded bg-card/80 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        aria-label="copy code"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <SyntaxHighlighter
        language={match?.[1] ?? "text"}
        style={resolvedTheme === "dark" ? oneDark : oneLight}
        customStyle={{ margin: 0, fontSize: "0.85rem" }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

export function MarkdownAnswer({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-foreground prose-li:text-foreground prose-table:text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code({ className, children, ...props }) {
            const isInline = !className;
            if (isInline) {
              return (
                <code className="rounded bg-muted px-1.5 py-0.5 text-[0.85em]" {...props}>
                  {children}
                </code>
              );
            }
            return <CodeBlock className={className}>{children}</CodeBlock>;
          },
          table({ children, ...props }) {
            return (
              <div className="my-2 overflow-x-auto">
                <table className="w-full border-collapse border border-border" {...props}>
                  {children}
                </table>
              </div>
            );
          },
          th({ children, ...props }) {
            return (
              <th className="border border-border bg-muted px-2 py-1 text-start" {...props}>
                {children}
              </th>
            );
          },
          td({ children, ...props }) {
            return (
              <td className="border border-border px-2 py-1" {...props}>
                {children}
              </td>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
