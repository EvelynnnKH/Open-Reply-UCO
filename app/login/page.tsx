import { signIn } from "@/lib/auth";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";
import { AuthError } from "next-auth";

export const metadata = {
  title: "Login - OpenReply",
  description: "Sign in to manage Instagram comment-to-DM campaigns.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackUrl?: string;
    template?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const selectedTemplate = getCampaignTemplate(params.template);
  const templateCallbackUrl = selectedTemplate
    ? `/campaigns/new?template=${selectedTemplate.slug}`
    : null;
  const callbackUrl = params.callbackUrl ?? templateCallbackUrl ?? "/dashboard";
  const hasError = Boolean(params.error);

  async function handleCredentialsLogin(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        username: String(formData.get("username") ?? ""),
        password: String(formData.get("password") ?? ""),
        redirectTo: callbackUrl,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        // Biarkan NextAuth menangani redirect error ke callbackUrl dengan param error
        const redirectUrl = `${params.callbackUrl ? `?callbackUrl=${encodeURIComponent(params.callbackUrl)}&` : "?"}error=CredentialsSignin`;
        const { redirect } = await import("next/navigation");
        redirect(redirectUrl);
      }
      // Re-throw error selain AuthError (misalnya NEXT_REDIRECT error internal Next.js)
      throw error;
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-foreground">
            OpenReply
          </h1>
          <p className="text-muted text-sm leading-relaxed mt-2">
            {selectedTemplate
              ? `Sign in to use the ${selectedTemplate.title} template.`
              : "Sign in with your admin credentials to continue."}
          </p>
        </div>

        <div className="panel rounded p-8 shadow-black/40">
          {selectedTemplate && (
            <div className="mb-5 border border-accent/20 bg-accent/10 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                Template selected
              </p>
              <p className="mt-2 text-sm font-semibold text-foreground">
                {selectedTemplate.title}
              </p>
            </div>
          )}

          {hasError && (
            <div className="mb-5 border border-red-500/20 bg-red-500/10 p-3 text-red-500 text-xs rounded">
              Username atau Password salah! Silakan coba lagi.
            </div>
          )}

          <form action={handleCredentialsLogin} className="space-y-5">
            <div className="space-y-2">
              <label
                htmlFor="username"
                className="block text-sm font-medium text-foreground"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                autoComplete="username"
                placeholder="Enter username"
                className="w-full px-4 py-3 rounded bg-surface border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-foreground"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Enter password"
                className="w-full px-4 py-3 rounded bg-surface border border-border text-sm text-foreground placeholder:text-zinc-500 focus:border-accent/40 focus:outline-none transition-colors"
              />
            </div>

            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 rounded bg-accent px-6 py-3.5 text-sm font-semibold text-white shadow-indigo-500/25 transition-all hover:shadow-indigo-500/30"
            >
              Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}