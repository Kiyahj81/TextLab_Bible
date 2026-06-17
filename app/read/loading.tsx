// app/read/loading.tsx
export default function ReadLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading passage">
      <div className="animate-pulse space-y-3">
        <div className="h-3 w-40 rounded bg-stone-200" />
        <div className="h-10 w-48 rounded bg-stone-200" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse border-l-2 border-stone-200 pl-6">
          <div className="mb-3 h-4 w-16 rounded bg-stone-200" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="h-5 w-full rounded bg-stone-100" />
              <div className="h-5 w-5/6 rounded bg-stone-100" />
            </div>
            <div className="space-y-2">
              <div className="h-5 w-full rounded bg-stone-100" />
              <div className="h-5 w-4/6 rounded bg-stone-100" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
