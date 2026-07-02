import React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "success" | "ai" | "outline" }) {
  const variants: Record<string, string> = {
    default: "bg-muted text-foreground",
    success: "bg-success/15 text-success border border-success/30",
    ai: "bg-accent/15 text-accent border border-accent/30",
    outline: "border border-border text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton rounded-md", className)} {...props} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-ring/30",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-ring/30 resize-y",
        className
      )}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export function Alert({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: "default" | "destructive" | "success" | "info" }) {
  const variants: Record<string, string> = {
    default: "bg-muted text-foreground border-border",
    destructive: "bg-destructive/10 text-destructive border-destructive/30",
    success: "bg-success/10 text-success border-success/30",
    info: "bg-accent/10 text-accent border-accent/30",
  };
  return (
    <div
      role="alert"
      className={cn("rounded-md border px-4 py-3 text-sm", variants[variant], className)}
      {...props}
    />
  );
}
