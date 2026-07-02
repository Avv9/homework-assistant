import { Skeleton } from "@/components/ui/primitives";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Skeleton className="mb-6 h-6 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}
