import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ChevronRightIcon } from "lucide-react";

const features = [
  "Translate in real time",
  "Organize your inbox",
  "Answer support tickets",
  "Summarize long documents",
  "Notify before a meeting",
  "Auto-reply to messages",
  "Draft follow-up emails",
];

const featuresRow2 = [
  "Schedule across time zones",
  "Do your taxes",
  "Track expenses and receipts",
  "Compare insurance quotes",
  "Manage subscriptions",
  "Set smart reminders",
  "Automate data entry",
];

const featuresRow3 = [
  "Find discount codes",
  "Price-drop alerts",
  "Compare product specs",
  "Negotiate deals",
  "Run payroll calculations",
  "Monitor competitor pricing",
  "Track order shipments",
];

const featuresRow4 = [
  "Generate invoices",
  "Create presentations",
  "Book travel and hotels",
  "Find recipes from ingredients",
  "Write meeting agendas",
  "Summarize research papers",
  "Screen cold outreach",
];

const testimonials = [
  {
    quote:
      "Set up ZeroClaw yesterday. All I have to say is, wow. The fact that it just keeps building upon itself just by talking to it in Discord is crazy.",
    name: "Alex Chen",
    handle: "@alexchen",
    color: "bg-chart-1",
  }
];

const trustedCompanies = [
  "Google",
  "Meta",
  "OpenAI",
  "Anthropic",
  "Stripe",
  "Vercel",
];

export default function Page() {
  return (
    <div className="min-h-screen bg-background">
      {/* Top Banner */}
      <div className="flex items-center justify-center border-b border-border/10 bg-card px-6 py-2.5">
        <p className="text-sm text-muted-foreground tracking-wide">
          Open Beta — Deploy your personal AI assistant in under a minute.
        </p>
      </div>

      {/* Navbar */}
      <nav className="flex items-center justify-between border-b border-border/6 px-12 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-lg font-bold text-foreground">crack402</span>
        </div>
        <div className="flex items-center gap-6">
          <Link
            href="mailto:support@crack402"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Contact Support
          </Link>
          <Link href="/signin">
            <Button size="lg">
              Get Started
            </Button>
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="flex flex-col items-center px-12 py-24 gap-8">
        <h1 className="text-6xl font-extrabold text-foreground text-center leading-tight tracking-tight">
          Deploy ZeroClaw
          <br />
          <span className="text-muted-foreground">In Under 1 Minute</span>
        </h1>
        <p className="text-lg text-muted-foreground text-center max-w-xl leading-relaxed">
          Your own 24/7 AI assistant on Telegram, Discord, or WhatsApp. Pick a
          model, choose a channel, and deploy with crack402 — no server
          setup, no code, no configuration.
        </p>

        {/* Powered By Row */}
        <div className="flex items-center gap-8 mt-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Powered by
            </span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="h-4 w-4 rounded bg-chart-1" />
                <span className="text-sm text-muted-foreground">Claude</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-4 w-4 rounded bg-chart-3" />
                <span className="text-sm text-muted-foreground">ChatGPT</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-4 w-4 rounded bg-chart-4" />
                <span className="text-sm text-muted-foreground">Gemini</span>
              </div>
            </div>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Available on
            </span>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="h-4 w-4 rounded bg-chart-1" />
                <span className="text-sm text-muted-foreground">Telegram</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-4 w-4 rounded bg-chart-5" />
                <span className="text-sm text-muted-foreground">Discord</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-4 w-4 rounded bg-chart-3" />
                <span className="text-sm text-muted-foreground">WhatsApp</span>
              </div>
            </div>
          </div>
        </div>

        {/* Hero CTA */}
        <div className="flex flex-col items-center gap-4 mt-4">
          <Link href="/signin">
            <Button size="lg">
              Get Started
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </Link>
          <p className="text-sm text-muted-foreground">
            Set up in under a minute. Cancel anytime.{" "}
            <Link
              href="/moneyback-guarantee"
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Money-Back Guarantee
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Social Proof */}
      <section className="flex flex-col items-center gap-8 border-y border-border/6 px-12 py-16">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
          Trusted by teams at
        </p>
        <div className="flex items-center justify-center gap-14">
          {trustedCompanies.map((company) => (
            <span
              key={company}
              className="text-xl font-bold text-muted-foreground/70"
            >
              {company}
            </span>
          ))}
        </div>
      </section>

      {/* Comparison Section */}
      <section className="flex flex-col items-center px-12 py-20 gap-10">
        <div className="flex flex-col items-center gap-4">
          <Badge variant="outline">Comparison</Badge>
          <h2 className="text-4xl font-extrabold text-foreground text-center tracking-tight">
            Traditional Method vs crack402
          </h2>
        </div>

        <div className="flex gap-6 w-full max-w-4xl px-8">
          {/* Traditional Card */}
          <Card className="flex-1">
            <CardHeader>
              <CardTitle className="text-muted-foreground">Traditional</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Purchasing a VM</span>
                <span className="text-sm text-muted-foreground/70">15 min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Creating SSH keys</span>
                <span className="text-sm text-muted-foreground/70">10 min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Installing dependencies</span>
                <span className="text-sm text-muted-foreground/70">10 min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Configuring environment</span>
                <span className="text-sm text-muted-foreground/70">10 min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Setting up the bot</span>
                <span className="text-sm text-muted-foreground/70">10 min</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Debugging webhooks</span>
                <span className="text-sm text-muted-foreground/70">5 min</span>
              </div>
            </CardContent>
            <CardFooter className="flex-col items-start gap-2">
              <div className="flex w-full justify-between">
                <span className="text-sm font-bold text-foreground">Total</span>
                <span className="text-sm font-bold text-foreground">60 min</span>
              </div>
              <CardDescription className="italic">
                If you&apos;re non-technical, multiply these times by 10.
              </CardDescription>
            </CardFooter>
          </Card>

          {/* ZeroClaw Card */}
          <Card className="flex-1 items-center justify-center ring-primary/30">
            <CardHeader className="items-center">
              <CardTitle>crack402</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <span className="text-8xl font-extrabold text-foreground leading-none tracking-tight">
                &lt;1
              </span>
              <span className="text-lg text-muted-foreground">minute to deploy</span>
              <CardDescription className="text-center max-w-xs">
                Choose your model, pick a channel, and deploy. We handle
                infrastructure, keys, and webhooks automatically.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="flex flex-col items-center px-12 py-20 gap-10">
        <div className="flex flex-col items-center gap-3">
          <Badge variant="outline">Shoutouts</Badge>
          <h2 className="text-4xl font-extrabold text-foreground text-center tracking-tight">
            Loved by builders everywhere
          </h2>
          <p className="text-base text-muted-foreground text-center">
            See what people are saying about ZeroClaw
          </p>
        </div>

        <div className="flex gap-5 w-full max-w-6xl px-8">
          {/* Column 1 */}
          <div className="flex flex-1 flex-col gap-5">
            {testimonials.slice(0, 3).map((t, i) => (
              <TestimonialCard key={i} testimonial={t} />
            ))}
          </div>
          {/* Column 2 */}
          <div className="flex flex-1 flex-col gap-5">
            {testimonials.slice(3, 6).map((t, i) => (
              <TestimonialCard key={i} testimonial={t} />
            ))}
          </div>
          {/* Column 3 */}
          <div className="flex flex-1 flex-col gap-5">
            {testimonials.slice(6, 9).map((t, i) => (
              <TestimonialCard key={i} testimonial={t} />
            ))}
          </div>
        </div>
      </section>

      {/* Use Cases Section */}
      <section className="flex flex-col items-center gap-10 bg-muted/20 px-12 py-20">
        <div className="flex flex-col items-center gap-3">
          <h2 className="text-4xl font-extrabold text-foreground text-center tracking-tight">
            What can ZeroClaw do for you?
          </h2>
          <p className="text-base text-muted-foreground text-center">
            One assistant, thousands of use cases
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full overflow-hidden">
          <FeatureRow features={features} />
          <FeatureRow features={featuresRow2} />
          <FeatureRow features={featuresRow3} />
          <FeatureRow features={featuresRow4} />
        </div>

        <p className="text-sm text-muted-foreground text-center">
          PS. You can add as many use cases as you want via natural language
        </p>
      </section>

      {/* Bottom CTA */}
      <section className="flex flex-col items-center gap-6 px-12 py-24">
        <h2 className="text-4xl font-extrabold text-foreground text-center tracking-tight">
          Start Deploying Now
        </h2>
        <p className="text-base text-muted-foreground text-center max-w-md">
          Pick a model, choose a channel, and have your AI assistant running in
          under a minute.
        </p>
        <Link href="/signin">
          <Button size="lg">
            Get Started
            <ChevronRightIcon data-icon="inline-end" />
          </Button>
        </Link>
        <p className="text-sm text-muted-foreground">
          Set up in under a minute. Cancel anytime.
        </p>
      </section>

      {/* Footer */}
      <footer className="flex items-center justify-between border-t border-border/8 px-12 py-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <span className="text-base font-bold text-foreground">crack402</span>
        </div>
        <div className="flex items-center gap-7">
          <Link
            href="/terms"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Terms
          </Link>
          <Link
            href="/privacy"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Privacy
          </Link>
          <Link
            href="/moneyback-guarantee"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Money-Back Guarantee
          </Link>
          <Link
            href="mailto:support@crack402"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            support@crack402
          </Link>
        </div>
      </footer>
    </div>
  );
}

function TestimonialCard({
  testimonial,
}: {
  testimonial: { quote: string; name: string; handle: string; color: string };
}) {
  return (
    <Card>
      <CardContent>
        <p className="text-sm text-muted-foreground leading-relaxed">
          &ldquo;{testimonial.quote}&rdquo;
        </p>
      </CardContent>
      <CardFooter className="gap-2.5">
        <div className={`h-9 w-9 shrink-0 rounded-full ${testimonial.color}`} />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">
            {testimonial.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {testimonial.handle}
          </span>
        </div>
      </CardFooter>
    </Card>
  );
}

function FeatureRow({ features }: { features: string[] }) {
  return (
    <div className="flex gap-3 overflow-hidden">
      <div className="flex gap-3 animate-marquee">
        {[...features, ...features].map((feature, i) => (
          <Badge key={i} variant="outline" className="whitespace-nowrap px-5 py-2.5">
            {feature}
          </Badge>
        ))}
      </div>
    </div>
  );
}
