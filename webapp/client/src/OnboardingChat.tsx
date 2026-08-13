/**
 * Conversational signup + plan selection + Stripe Payment Element.
 * Full-screen chat (not a small modal). Distinct from the architecture Agent chat.
 * Passwords/cards are widgets, never message text.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { supabase, getSupabaseConfigError } from "./supabaseClient";
import {
  ACCENT,
  ACCENT_WASH,
  BAD,
  CANVAS,
  FONT_BRAND,
  FONT_UI,
  GOOD,
  INK,
  LINE,
  PAPER,
  SLATE,
  WARN,
} from "./theme/tokens";

const API_BASE = "/api";

export type OnboardingPlan = "free" | "pro" | "team";

type Step =
  | "greet"
  | "intent"
  | "email"
  | "profile"
  | "password"
  | "plan"
  | "pay"
  | "repo"
  | "done";

type UserIntent = "explore" | "save" | "collaborate" | "design";

type ChatLine = { id: string; role: "bot" | "user" | "system"; text: string };

type Props = {
  onClose: () => void;
  onSignIn: () => void;
  onComplete: (args: {
    accessToken: string;
    plan: OnboardingPlan;
    continueRepo: boolean;
    startDesign?: boolean;
  }) => void;
  pendingRepoUrl?: string | null;
  intentMessage?: string | null;
};

const INTENT_COPY: Record<
  UserIntent,
  { label: string; reply: string; planHint: OnboardingPlan }
> = {
  design: {
    label: "Start designing",
    reply: "Perfect — we'll open a blank design canvas so you can chat and drag components into an architecture. Free works to explore; Pro unlocks more AI design help.",
    planHint: "free",
  },
  explore: {
    label: "Explore a codebase",
    reply: "Great — we'll get you scanning quickly. Free works for a first look; Pro unlocks more scans and the AI agent when you're ready.",
    planHint: "free",
  },
  save: {
    label: "Save and share architecture",
    reply: "Perfect — saving and sharing is where blanko shines. Most people in your shoes start on Pro.",
    planHint: "pro",
  },
  collaborate: {
    label: "Collaborate with a team",
    reply: "Welcome — shared workspaces and higher allowances fit Team best, though Pro is a solid start for smaller groups.",
    planHint: "team",
  },
};

const PLAN_COPY: Record<
  OnboardingPlan,
  { label: string; price: string; detail: string }
> = {
  free: {
    label: "Free",
    price: "$0",
    detail: "20 design-chat messages + 5 repo scans a month. Repo AI agent is Pro.",
  },
  pro: {
    label: "Pro",
    price: "$29/mo",
    detail: "100 scan credits + $20 AI credit pool. Collab + save/share.",
  },
  team: {
    label: "Team",
    price: "$79/mo",
    detail: "500 scan credits + $100 AI credit pool. Best for shared architecture work.",
  },
};

/** Transparent limits per plan — must match server entitlements defaults. */
const PRICING_ROWS: { label: string; free: string; pro: string; team: string }[] = [
  { label: "Price", free: "$0", pro: "$29/mo", team: "$79/mo" },
  { label: "Design chat", free: "20 msgs/mo", pro: "Unlimited", team: "Unlimited" },
  { label: "Repo scans", free: "5/mo", pro: "100 credits", team: "500 credits" },
  { label: "AI credit pool", free: "—", pro: "$20/mo", team: "$100/mo" },
  { label: "Repo AI agent", free: "—", pro: "Included", team: "Included" },
  { label: "Save · share · collab", free: "—", pro: "Included", team: "Included" },
];


function passwordStrengthLabel(pw: string): string {
  if (!pw) return "enter a password";
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return "weak";
  if (score <= 3) return "okay";
  return "strong";
}

function passwordStrengthColor(pw: string): string {
  const label = passwordStrengthLabel(pw);
  if (label === "strong") return GOOD;
  if (label === "okay") return WARN;
  return BAD;
}

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const fieldStyle: CSSProperties = {
  padding: "15px 18px",
  background: CANVAS,
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  color: INK,
  fontFamily: FONT_UI,
  fontSize: 17,
};

const primaryBtn: CSSProperties = {
  background: INK,
  color: CANVAS,
  border: "1px solid transparent",
  borderRadius: 10,
  padding: "14px 18px",
  fontFamily: FONT_UI,
  fontWeight: 600,
  fontSize: 16,
  cursor: "pointer",
  boxShadow: "0 1px 2px rgba(18,19,26,0.08)",
};

const secondaryBtn: CSSProperties = {
  background: CANVAS,
  color: INK,
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  padding: "14px 18px",
  fontFamily: FONT_UI,
  fontWeight: 600,
  fontSize: 16,
  cursor: "pointer",
};

/* Hover lift for option chips / plan cards — inline styles cannot express :hover. */
const ONBOARDING_CSS = `
.blanko-onb-card {
  transition: transform 0.12s ease, box-shadow 0.16s ease, border-color 0.16s ease;
}
.blanko-onb-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(18,19,26,0.08);
}
`;

function PaymentForm({
  onPaid,
  onError,
}: {
  onPaid: () => void;
  onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!stripe || !elements) return;
    setBusy(true);
    try {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: window.location.origin },
      });
      if (error) {
        onError(error.message ?? "Payment failed");
        return;
      }
      if (
        paymentIntent &&
        paymentIntent.status !== "succeeded" &&
        paymentIntent.status !== "processing"
      ) {
        onError(`Payment status: ${paymentIntent.status}`);
        return;
      }
      onPaid();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="onboarding-payment-element"
      style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}
    >
      <PaymentElement />
      <button
        type="button"
        data-testid="onboarding-pay-submit"
        disabled={busy || !stripe}
        onClick={() => void submit()}
        style={{
          ...primaryBtn,
          borderRadius: 999,
          opacity: busy || !stripe ? 0.7 : 1,
          cursor: busy ? "wait" : "pointer",
        }}
      >
        {busy ? "Confirming…" : "Pay and continue"}
      </button>
    </div>
  );
}

export default function OnboardingChat({
  onClose,
  onSignIn,
  onComplete,
  pendingRepoUrl,
  intentMessage,
}: Props) {
  const [step, setStep] = useState<Step>("greet");
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [plan, setPlan] = useState<OnboardingPlan | null>(null);
  const [userIntent, setUserIntent] = useState<UserIntent | null>(null);
  const [tos, setTos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [stripePromise, setStripePromise] = useState<Promise<Stripe | null> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const greeterRan = useRef(false);

  const push = useCallback((role: ChatLine["role"], text: string) => {
    setLines((prev) => [...prev, { id: newId(), role, text }]);
  }, []);

  useEffect(() => {
    if (greeterRan.current) return;
    greeterRan.current = true;
    if (intentMessage?.trim()) {
      push("bot", intentMessage.trim());
      push(
        "bot",
        "I'm glad you're here. Tell me what you're hoping to do — then we'll create your account."
      );
    } else {
      push(
        "bot",
        "Welcome to blanko — a calm place to see how your systems fit together."
      );
      push(
        "bot",
        "I'd like to understand what you're looking for before we set up your account."
      );
    }
    setStep("intent");
    push("bot", "What brings you in today?");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, step, clientSecret]);

  useEffect(() => {
    const pk = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
    if (pk) setStripePromise(loadStripe(pk));
  }, []);

  const createAuthUser = async (): Promise<string> => {
    const cfgErr = getSupabaseConfigError();
    if (cfgErr || !supabase) throw new Error(cfgErr ?? "Supabase not configured");
    const nicknameClean = nickname.trim().replace(/^@+/, "");
    const { data, error: signErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          nickname: nicknameClean,
        },
      },
    });
    if (signErr) throw signErr;
    const session = data.session;
    const user = data.user;
    if (!user) throw new Error("Signup did not return a user");
    if (session?.access_token) {
      await supabase.from("profiles").upsert({
        id: user.id,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        nickname: nicknameClean,
      });
      return session.access_token;
    }
    const { data: signed, error: inErr } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (inErr || !signed.session) {
      throw new Error(
        "Check your email to confirm your account, then sign in to finish billing."
      );
    }
    await supabase.from("profiles").upsert({
      id: signed.user.id,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      nickname: nicknameClean,
    });
    return signed.session.access_token;
  };

  const startPaid = async (chosen: OnboardingPlan, token: string) => {
    const res = await fetch(`${API_BASE}/billing/create-subscription`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ plan: chosen }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      clientSecret?: string;
    };
    if (!res.ok) throw new Error(body.error ?? "Could not start subscription");
    if (!body.clientSecret) throw new Error("Missing payment client secret");
    setClientSecret(body.clientSecret);
    setStep("pay");
    push("bot", "Add your card below. Card details go to Stripe — we never see the number.");
  };

  const finishFree = async (token: string) => {
    await fetch(`${API_BASE}/billing/ensure-free`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (pendingRepoUrl) {
      setStep("repo");
      push("bot", `Continue with ${pendingRepoUrl}?`);
      return;
    }
    setStep("done");
    onComplete({
      accessToken: token,
      plan: "free",
      continueRepo: false,
      startDesign: userIntent === "design",
    });
  };

  const afterAuth = async (token: string, chosen: OnboardingPlan) => {
    setAccessToken(token);
    if (chosen === "free") {
      await finishFree(token);
      return;
    }
    await startPaid(chosen, token);
  };

  const submitComposer = async () => {
    setError(null);
    const raw = input.trim();
    if (step === "email") {
      if (!raw || !raw.includes("@")) {
        setError("Enter a valid email");
        return;
      }
      setEmail(raw);
      push("user", raw);
      setInput("");
      push(
        "bot",
        "Nice to meet you. What should we call you — first name, last name, and an @nickname for the workspace?"
      );
      setStep("profile");
    }
  };

  const chooseIntent = (intent: UserIntent) => {
    setError(null);
    setUserIntent(intent);
    push("user", INTENT_COPY[intent].label);
    push("bot", INTENT_COPY[intent].reply);
    push("bot", "What's the best email for your account?");
    setStep("email");
  };

  const submitProfile = () => {
    setError(null);
    if (!firstName.trim() || !lastName.trim() || !nickname.trim()) {
      setError("First name, last name, and nickname are required");
      return;
    }
    push(
      "user",
      `${firstName.trim()} ${lastName.trim()} @${nickname.trim().replace(/^@+/, "")}`
    );
    push(
      "bot",
      `Thanks, ${firstName.trim()}. Choose a password next — it stays private (never shown in this chat).`
    );
    setStep("password");
  };

  const submitPassword = async () => {
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    push("system", "Password set");
    const hint = userIntent ? INTENT_COPY[userIntent].planHint : "pro";
    if (hint === "team") {
      push(
        "bot",
        "Based on what you shared, Team ($79/mo) fits collaborative work. Pro ($29/mo) is the usual pick for individuals who save and share. Free stays capped if you only want a light start."
      );
    } else if (hint === "free") {
      push(
        "bot",
        "You're welcome to stay on Free while you explore. When you want more scans, AI help, or sharing, Pro is $29/mo — Team is $79/mo for heavier shared use."
      );
    } else {
      push(
        "bot",
        "Most people saving architecture work choose Pro — $29/mo with 100 scans and AI credits. Free stays capped. Team ($79/mo) is for heavier shared use."
      );
    }
    push(
      "bot",
      "Here's the full pricing side by side — every limit up front, no fine print. Pick whichever fits; you can change plans or cancel anytime."
    );
    setStep("plan");
  };

  const choosePlan = async (chosen: OnboardingPlan) => {
    setError(null);
    if (!tos) {
      setError("Accept Terms and Privacy to continue");
      return;
    }
    setPlan(chosen);
    push("user", `Plan: ${PLAN_COPY[chosen].label} (${PLAN_COPY[chosen].price})`);
    try {
      push("bot", "Creating your account…");
      const token = await createAuthUser();
      await afterAuth(token, chosen);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onPaid = async () => {
    if (!accessToken || !plan || plan === "free") return;
    try {
      await fetch(`${API_BASE}/billing/confirm-subscription`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan }),
      });
    } catch {
      /* webhook remains source of truth */
    }
    push("bot", "Payment submitted. Access unlocks when Stripe confirms (usually seconds).");
    if (pendingRepoUrl) {
      setStep("repo");
      push("bot", `Continue with ${pendingRepoUrl}?`);
      return;
    }
    setStep("done");
    onComplete({
      accessToken,
      plan,
      continueRepo: false,
      startDesign: userIntent === "design",
    });
  };

  const composerPlaceholder = useMemo(() => {
    if (step === "email") return "you@company.com";
    return "Chat with blanko";
  }, [step]);

  return (
    <div
      role="dialog"
      aria-label="Get started"
      data-testid="onboarding-chat"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: CANVAS,
        display: "flex",
        flexDirection: "column",
        fontFamily: FONT_UI,
      }}
    >
      <style>{ONBOARDING_CSS}</style>
      <header
        style={{
          flexShrink: 0,
          padding: "20px 28px",
          borderBottom: `1px solid ${LINE}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: CANVAS,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONT_BRAND,
              fontSize: 16,
              fontWeight: 400,
              letterSpacing: "-0.01em",
              color: ACCENT,
              textTransform: "lowercase",
            }}
          >
            blanko
          </div>
          <div
            style={{
              color: INK,
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.02em",
              marginTop: 4,
            }}
          >
            Get started
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: CANVAS,
            border: `1px solid ${LINE}`,
            borderRadius: 999,
            color: INK,
            cursor: "pointer",
            fontFamily: FONT_UI,
            fontWeight: 600,
            fontSize: 15,
            padding: "10px 18px",
          }}
        >
          Close
        </button>
      </header>

      <div
        ref={listRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "28px 24px 40px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          background: CANVAS,
        }}
      >
        <div style={{ width: "100%", maxWidth: 720 }}>
          {lines.map((l) =>
            l.role === "system" ? (
              <div
                key={l.id}
                style={{
                  marginBottom: 16,
                  color: SLATE,
                  fontSize: 15,
                  lineHeight: 1.55,
                  textAlign: "center",
                }}
              >
                {l.text}
              </div>
            ) : (
              <div
                key={l.id}
                style={{
                  marginBottom: 12,
                  display: "flex",
                  justifyContent: l.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "82%",
                    padding: "12px 16px",
                    borderRadius: 14,
                    background: l.role === "user" ? INK : PAPER,
                    border: `1px solid ${l.role === "user" ? INK : LINE}`,
                    color: l.role === "user" ? CANVAS : INK,
                    fontSize: 17,
                    lineHeight: 1.55,
                    fontWeight: l.role === "user" ? 600 : 400,
                  }}
                >
                  {l.text}
                </div>
              </div>
            )
          )}

          {step === "intent" && (
            <div
              style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}
              data-testid="onboarding-intent"
            >
              {(["design", "explore", "save", "collaborate"] as UserIntent[]).map((intent) => {
                const selected = userIntent === intent;
                return (
                <button
                  key={intent}
                  type="button"
                  className="blanko-onb-card"
                  data-testid={`onboarding-intent-${intent}`}
                  onClick={() => chooseIntent(intent)}
                  style={{
                    textAlign: "left",
                    background: selected ? ACCENT_WASH : CANVAS,
                    border: `1px solid ${selected ? ACCENT : LINE}`,
                    borderRadius: 12,
                    padding: "16px 18px",
                    color: selected ? ACCENT : INK,
                    cursor: "pointer",
                    fontFamily: FONT_UI,
                    fontSize: 17,
                    fontWeight: selected ? 600 : 500,
                  }}
                >
                  {INTENT_COPY[intent].label}
                </button>
                );
              })}
            </div>
          )}

          {step === "profile" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
              <input
                data-testid="onboarding-first-name"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                style={fieldStyle}
              />
              <input
                data-testid="onboarding-last-name"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                style={fieldStyle}
              />
              <input
                data-testid="onboarding-nickname"
                placeholder="nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value.replace(/^@+/, ""))}
                style={fieldStyle}
              />
              <button type="button" onClick={submitProfile} style={primaryBtn}>
                Continue
              </button>
            </div>
          )}

          {step === "password" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
              <input
                data-testid="onboarding-password"
                type="password"
                autoComplete="new-password"
                placeholder="Password (min 8)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={fieldStyle}
              />
              <input
                data-testid="onboarding-password-confirm"
                type="password"
                autoComplete="new-password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                style={fieldStyle}
              />
              <div
                data-testid="onboarding-password-strength"
                style={{ fontSize: 15, color: passwordStrengthColor(password) }}
              >
                Strength: {passwordStrengthLabel(password)}
                {password.length > 0 && password.length < 8 ? " — use at least 8 characters" : ""}
              </div>
              <button type="button" onClick={() => void submitPassword()} style={primaryBtn}>
                Continue
              </button>
            </div>
          )}

          {step === "plan" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
              <div
                data-testid="onboarding-pricing-table"
                style={{
                  border: `1px solid ${LINE}`,
                  borderRadius: 12,
                  overflow: "hidden",
                  background: CANVAS,
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
                    background: PAPER,
                    borderBottom: `1px solid ${LINE}`,
                    padding: "10px 14px",
                    fontSize: 13,
                    fontWeight: 700,
                    color: INK,
                  }}
                >
                  <span style={{ color: SLATE, fontWeight: 600 }}>Every plan, in full</span>
                  <span>Free</span>
                  <span style={{ color: ACCENT }}>Pro</span>
                  <span>Team</span>
                </div>
                {PRICING_ROWS.map((r) => (
                  <div
                    key={r.label}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.4fr 1fr 1fr 1fr",
                      padding: "9px 14px",
                      fontSize: 13.5,
                      borderBottom: `1px solid ${LINE}`,
                      color: INK,
                    }}
                  >
                    <span style={{ color: SLATE }}>{r.label}</span>
                    <span>{r.free}</span>
                    <span>{r.pro}</span>
                    <span>{r.team}</span>
                  </div>
                ))}
                <div
                  data-testid="onboarding-pricing-note"
                  style={{
                    padding: "10px 14px",
                    fontSize: 12.5,
                    lineHeight: 1.55,
                    color: SLATE,
                    background: PAPER,
                  }}
                >
                  Billed monthly through Stripe — no hidden fees, no card required on Free.
                  Cancel anytime from Account &amp; billing; access runs to the end of the
                  period.
                </div>
              </div>
              {(() => {
                const preferred = userIntent ? INTENT_COPY[userIntent].planHint : "pro";
                const order = (
                  ["pro", "team", "free"] as OnboardingPlan[]
                ).sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
                return order.map((p) => {
                  const highlighted = plan === p || (plan === null && p === preferred);
                  return (
                <button
                  key={p}
                  type="button"
                  className="blanko-onb-card"
                  data-testid={`onboarding-plan-${p}`}
                  onClick={() => void choosePlan(p)}
                  style={{
                    textAlign: "left",
                    background: highlighted ? ACCENT_WASH : CANVAS,
                    border: `1px solid ${highlighted ? ACCENT : LINE}`,
                    borderRadius: 12,
                    padding: "18px 20px",
                    color: INK,
                    cursor: "pointer",
                    fontFamily: FONT_UI,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 20,
                      color: highlighted ? ACCENT : INK,
                    }}
                  >
                    {PLAN_COPY[p].label} · {PLAN_COPY[p].price}
                    {p === preferred ? " · recommended for you" : ""}
                  </div>
                  <div style={{ fontSize: 15, color: SLATE, marginTop: 8, lineHeight: 1.45 }}>
                    {PLAN_COPY[p].detail}
                  </div>
                </button>
                  );
                });
              })()}
              <label
                style={{
                  fontSize: 15,
                  color: SLATE,
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  lineHeight: 1.5,
                }}
              >
                <input
                  data-testid="onboarding-tos"
                  type="checkbox"
                  checked={tos}
                  onChange={(e) => setTos(e.target.checked)}
                  style={{ marginTop: 4, width: 18, height: 18 }}
                />
                <span>
                  I agree to the{" "}
                  <a
                    href="https://blanko.ai/terms"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: ACCENT }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a
                    href="https://blanko.ai/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: ACCENT }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    Privacy Policy
                  </a>
                </span>
              </label>
            </div>
          )}

          {step === "pay" && clientSecret && stripePromise && (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: {
                  theme: "stripe",
                  variables: {
                    colorPrimary: ACCENT,
                    colorBackground: CANVAS,
                    colorText: INK,
                    colorDanger: BAD,
                    fontFamily: FONT_UI,
                    borderRadius: "10px",
                  },
                },
              }}
            >
              <PaymentForm onPaid={() => void onPaid()} onError={(m) => setError(m)} />
            </Elements>
          )}

          {step === "pay" && !stripePromise && (
            <div style={{ color: BAD, fontSize: 16 }}>
              Stripe publishable key missing. Set VITE_STRIPE_PUBLISHABLE_KEY.
            </div>
          )}

          {step === "repo" && accessToken && plan && (
            <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <button
                type="button"
                data-testid="onboarding-continue-repo"
                style={primaryBtn}
                onClick={() =>
                  onComplete({
                    accessToken,
                    plan,
                    continueRepo: true,
                    startDesign: false,
                  })
                }
              >
                Yes, continue with repo
              </button>
              <button
                type="button"
                style={secondaryBtn}
                onClick={() =>
                  onComplete({
                    accessToken,
                    plan,
                    continueRepo: false,
                    startDesign: userIntent === "design",
                  })
                }
              >
                Skip
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div
          data-testid="onboarding-error"
          style={{
            flexShrink: 0,
            padding: "12px 28px",
            color: BAD,
            fontSize: 15,
            borderTop: "1px solid #FECACA",
            background: "#FEF2F2",
          }}
        >
          {error}
        </div>
      )}

      <footer
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${LINE}`,
          padding: "16px 24px 20px",
          display: "flex",
          justifyContent: "center",
          background: CANVAS,
        }}
      >
        <div style={{ width: "100%", maxWidth: 720 }}>
          <button
            type="button"
            onClick={onSignIn}
            style={{
              background: "transparent",
              border: "none",
              color: ACCENT,
              cursor: "pointer",
              fontFamily: FONT_UI,
              fontSize: 15,
              marginBottom: 12,
              padding: 0,
            }}
          >
            Already have an account? Sign in
          </button>
          {step === "email" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitComposer();
              }}
              style={{ display: "flex", gap: 12 }}
            >
              <input
                data-testid="onboarding-email"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={composerPlaceholder}
                style={{ ...fieldStyle, flex: 1, borderRadius: 999 }}
              />
              <button
                type="submit"
                style={{ ...primaryBtn, borderRadius: 999, padding: "14px 22px" }}
              >
                Send
              </button>
            </form>
          )}
          {step !== "email" && step !== "done" && (
            <div
              style={{
                ...fieldStyle,
                borderRadius: 999,
                background: PAPER,
                color: SLATE,
              }}
            >
              Chat with blanko
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
