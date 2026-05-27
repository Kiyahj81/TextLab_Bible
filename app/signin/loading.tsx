export default function SignInLoading() {
  return (
    <div className="mx-auto mt-16 max-w-md animate-pulse rounded-lg border border-stone-300 bg-white p-8 shadow-sm">
      <div className="h-6 w-32 rounded bg-stone-200" />
      <div className="mt-6 h-10 rounded bg-stone-100" />
      <div className="mt-3 h-10 rounded bg-stone-100" />
      <div className="mt-6 h-10 rounded bg-stone-200" />
    </div>
  );
}
