import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface SelectionItem {
  id: string;
  href: string;
  title: string;
  description?: string;
}

export function SelectionGrid({ items, emptyLabel }: { items: SelectionItem[]; emptyLabel?: string }) {
  if (items.length === 0) {
    return <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, idx) => (
        <Link href={item.href} key={item.id} className="group">
          <Card
            className={cn(
              "fade-in h-full transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-accent/50"
            )}
            style={{ animationDelay: `${idx * 40}ms` }}
          >
            <CardHeader>
              <CardTitle className="group-hover:text-accent transition-colors">{item.title}</CardTitle>
              {item.description && <CardDescription>{item.description}</CardDescription>}
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
