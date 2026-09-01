// Shared inline error banner -- most pages previously either had no visible error
// state at all (console.error only) or a bespoke red div with slightly different
// classes/wording. One component, one look, everywhere a fetch/action can fail.
export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm p-3">
      <span>{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="shrink-0 underline font-medium">
          Retry
        </button>
      )}
    </div>
  );
}
