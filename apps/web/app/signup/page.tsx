import { SignupForm } from "@/components/SignupForm";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Create account");

export default function SignupPage() {
  return (
    <main className="mx-auto max-w-sm px-4 py-14 sm:px-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Create an account</h1>
      <SignupForm />
    </main>
  );
}
